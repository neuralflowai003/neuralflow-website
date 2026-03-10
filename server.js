require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const { google } = require('googleapis');
const fs = require('fs');

const https = require('https');

const app = express();
const port = process.env.PORT || 8080;

// ─── Clients ──────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NODE_ENV === 'production'
    ? 'https://neuralflowai.io/oauth/callback'
    : 'http://localhost:8080/oauth/callback'
);

const TOKEN_PATH = path.join(__dirname, 'google-token.json');
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  oauth2Client.getAccessToken().then(t => console.log('✅ Google auth OK')).catch(e => console.error('❌ Google auth failed:', e.message));
} else if (fs.existsSync(TOKEN_PATH)) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  console.log('✅ Google auth loaded from token file');
} else {
  console.error('❌ No Google credentials found — calendar booking will fail');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '')));

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const chatRateLimits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of chatRateLimits.entries()) {
    if (now > entry.resetAt) chatRateLimits.delete(ip);
  }
}, 5 * 60 * 1000);

function chatRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;
  const entry = chatRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    chatRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (entry.count >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment before trying again.' });
  }
  entry.count++;
  next();
}

// ─── Conversation Cache ───────────────────────────────────────────────────────
const conversationSlots = new Map();
const agreedSlots = new Map(); // { slot, storedAt }
setInterval(() => {
  const expiry = Date.now() - 30 * 60 * 1000; // 30 min expiry
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < expiry) conversationSlots.delete(key);
  }
  for (const [key, val] of agreedSlots.entries()) {
    if (val.storedAt < expiry) agreedSlots.delete(key); // expire by age, not indiscriminately
  }
}, 10 * 60 * 1000);

// ─── Telegram Alert Helper ────────────────────────────────────────────────────
function sendTelegramAlert(msg) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN || '8354160885:AAHsmTw_qDhYsEf2Htd2qotMd1kPRm-okmw';
  const tgChat = process.env.TELEGRAM_CHAT_ID || '8709413106';
  const payload = JSON.stringify({ chat_id: tgChat, text: msg });
  const req = https.request(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, () => {});
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

// ─── Global Slots Cache ───────────────────────────────────────────────────────
let globalSlotCache = null;
let globalSlotCacheUpdatedAt = 0;

// ─── Cached OAuth Token ───────────────────────────────────────────────────────
let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function refreshGlobalSlotCache() {
  try {
    const slots = await getAvailableSlots(90, null);
    if (slots && slots.length > 0) {
      globalSlotCache = slots;
      globalSlotCacheUpdatedAt = Date.now();
      console.log('🔄 Background cache refresh — slots:', slots.length);
    }
  } catch (e) {
    console.error('⚠️ Global cache refresh failed:', e.message);
  }
}
refreshGlobalSlotCache();
setInterval(refreshGlobalSlotCache, 2 * 60 * 1000);

// ─── Helper: DST-Aware NY Offset ──────────────────────────────────────────────
function getNYOffset(date) {
  const year = date.getUTCFullYear();
  const dstStart = new Date(Date.UTC(year, 2, 8));
  dstStart.setUTCDate(8 + (7 - dstStart.getUTCDay()) % 7); // 2nd Sunday March
  const dstEnd = new Date(Date.UTC(year, 10, 1));
  dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7);     // 1st Sunday November

  if (date >= dstStart && date < dstEnd) {
    return { hours: 4, abbr: 'EDT' };
  }
  return { hours: 5, abbr: 'EST' };
}

// ─── Booking Log ──────────────────────────────────────────────────────────────
const BOOKINGS_LOG = path.join(__dirname, 'bookings.json');
function logBooking(data) {
  try {
    let entries = [];
    if (fs.existsSync(BOOKINGS_LOG)) {
      try { entries = JSON.parse(fs.readFileSync(BOOKINGS_LOG, 'utf8')); } catch {}
    }
    entries.push({ ...data, bookedAt: new Date().toISOString() });
    fs.writeFileSync(BOOKINGS_LOG, JSON.stringify(entries, null, 2));
    console.log(`📝 Booking logged: ${data.name} — ${data.slotLabel}`);
  } catch (e) {
    console.error('⚠️ Failed to write booking log:', e.message);
  }
}

// ─── Timezone Slot Formatter ──────────────────────────────────────────────────
function formatSlotInClientTz(isoStr, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(new Date(isoStr));
  } catch { return null; }
}

// ─── Slot Fetching ────────────────────────────────────────────────────────────
async function getAvailableSlots(daysWindow = 14, startFromDate = null, allHours = false) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) return null;

  if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000) {
    const result = await oauth2Client.getAccessToken().catch(e => console.log('token refresh err', e.message));
    if (result && result.token) {
      cachedAccessToken = result.token;
      tokenExpiresAt = result.res?.data?.expiry_date || (Date.now() + 3500000);
    }
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Window starts from tomorrow if no specific date given (Today + 1 day)
    const windowStart = startFromDate ? new Date(startFromDate + 'T00:00:00') : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d; })();
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + daysWindow);

    let data;
    try {
      const res = await Promise.race([
        calendar.freebusy.query({
          requestBody: {
            timeMin: windowStart.toISOString(),
            timeMax: windowEnd.toISOString(),
            items: [{ id: 'primary' }],
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('freebusy timeout')), 8000))
      ]);
      data = res.data;
    } catch (e) {
      console.error('❌ freebusy failed:', e.message, e.response?.data);
      throw e;
    }

    const busy = data.calendars.primary.busy || [];
    const slots = [];
    const slotsPerDay = {}; // FIX 2: max 2 slots per date
    const now24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const d = new Date(windowStart);
    d.setHours(0, 0, 0, 0);

    for (let i = 0; i <= daysWindow && slots.length < 12; i++) {
      const currentDay = new Date(d);
      currentDay.setDate(currentDay.getDate() + i);
      const dow = currentDay.getDay();

      // Skip weekends
      const dowCheck = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 12, 0, 0);
      if (dowCheck.getDay() === 0) continue;

      const { hours: offsetHours, abbr } = getNYOffset(currentDay);
      const dateStr = `${currentDay.getFullYear()}-${String(currentDay.getMonth() + 1).padStart(2, '0')}-${String(currentDay.getDate()).padStart(2, '0')}`;

      if (!slotsPerDay[dateStr]) slotsPerDay[dateStr] = 0;

      const targetHours = [9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21];
      const hoursToCheck = allHours ? targetHours : [9, 13, 17];
      const maxPerDay = allHours ? 12 : 3;
      const maxTotal = allHours ? 24 : 9;
      for (const hr of hoursToCheck) {
        if (slotsPerDay[dateStr] >= maxPerDay) break;
        if (slots.length >= maxTotal) break;

        const slotStart = new Date(`${dateStr}T${String(hr).padStart(2, '0')}:00:00.000Z`);
        slotStart.setTime(slotStart.getTime() + offsetHours * 3600000); // NY to UTC
        const slotEnd = new Date(slotStart.getTime() + 3600000);

        // Individual slot filter (for 24h buffer)
        if (slotStart <= now24h) continue;

        const isBusy = busy.some(b => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });

        if (!isBusy) {
          const nyTime = new Date(slotStart.getTime() - offsetHours * 3600000);

          const daysInfo = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const monthsInfo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

          const noonRef = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 12, 0, 0);
          const weekdayStr = daysInfo[noonRef.getDay()];
          const monthStr = monthsInfo[nyTime.getUTCMonth()];
          const dateDayStr = nyTime.getUTCDate();
          let hour12 = nyTime.getUTCHours();
          const ampm = hour12 >= 12 ? 'PM' : 'AM';
          hour12 = hour12 % 12 || 12;
          const min = String(nyTime.getUTCMinutes()).padStart(2, '0');

          const label = `${weekdayStr}, ${monthStr} ${dateDayStr} at ${hour12}:${min} ${ampm} ${abbr}`;
          slots.push({ label, start: slotStart.toISOString(), end: slotEnd.toISOString() });
          slotsPerDay[dateStr]++;
        }
      }
    }
    return slots;
  } catch (e) {
    console.error('Calendar error:', e.message);
    return null;
  }
}

// ─── Booking Logic ────────────────────────────────────────────────────────────
async function bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes }) {
  slotLabel = slotLabel.replace(/\s*\[start:[^\]]+\]/g, '').replace(/\s*\/\s*\d{1,2}:\d{2}\s*(AM|PM)\s+\w+\s+your time/i, '').trim();
  logBooking({ name, email, company, slotLabel, slotStart, notes });
  let meetLink = null;
  let eventHtmlLink = null;

  let pricingDetails = 'Implementation: $TBD\nMonthly: $TBD/mo\nROI: TBD';
  let objections = '';
  let salesAngles = '';
  let nextSteps = '';
  let competitorIntel = '';

  if (notes) {
    try {
      const parts = notes.split('|');
      const whatTheyWant = parts[0]?.trim() || '';
      const painPoints = parts[1]?.trim() || '';

      const pricingPrompt = `You are a B2B AI sales strategist for NeuralFlow, an AI consulting and automation company. Analyze this lead and return a structured sales brief.

Pain points: ${painPoints}
Company: ${company}
What they want: ${whatTheyWant}

Reply in EXACTLY this format with no extra text:
PRICING:
Implementation: $X,XXX
Monthly: $XXX/mo
ROI: [1-2 sentence estimate of time/money saved and break-even]

OBJECTIONS:
- Objection: "[likely objection 1]" → Rebuttal: "[sharp one-line rebuttal]"
- Objection: "[likely objection 2]" → Rebuttal: "[sharp one-line rebuttal]"
- Objection: "[likely objection 3]" → Rebuttal: "[sharp one-line rebuttal]"

SALES_ANGLES:
- [Specific talking point 1 tailored to their pain points]
- [Specific talking point 2 tailored to their situation]
- [Specific talking point 3 with a concrete ROI hook]

NEXT_STEPS:
- [Prep action 1 specific to their industry/use case]
- [Prep action 2 specific to their pain points]
- [Prep action 3]
- Suggested close: [One sentence tailored close for this exact lead]

COMPETITOR_INTEL:
Industry: [their likely industry]
- [Competitor type 1] are already automating [specific process] using [tool/approach]
- [Competitor type 2] have deployed [specific AI workflow] saving [X hours/$/mo]
- Urgency: "Companies in [industry] are already automating [X] — every month you wait is [Y] in lost efficiency."`;

      const pricingRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: pricingPrompt }]
      });
      const raw = pricingRes.content[0].text.trim();

      const pricingMatch = raw.match(/PRICING:\n([\s\S]*?)(?:\n\nOBJECTIONS:|$)/);
      const objectionsMatch = raw.match(/OBJECTIONS:\n([\s\S]*?)(?:\n\nSALES_ANGLES:|$)/);
      const salesMatch = raw.match(/SALES_ANGLES:\n([\s\S]*?)(?:\n\nNEXT_STEPS:|$)/);
      const nextMatch = raw.match(/NEXT_STEPS:\n([\s\S]*?)(?:\n\nCOMPETITOR_INTEL:|$)/);
      const compMatch = raw.match(/COMPETITOR_INTEL:\n([\s\S]*?)$/);

      if (pricingMatch) pricingDetails = pricingMatch[1].trim();
      if (objectionsMatch) objections = objectionsMatch[1].trim();
      if (salesMatch) salesAngles = salesMatch[1].trim();
      if (nextMatch) nextSteps = nextMatch[1].trim();
      if (compMatch) competitorIntel = compMatch[1].trim();
    } catch (e) {
      console.log('AI Sales Brief failed:', e.message);
    }
  }

  // Parse pricing lines for the deal value calc
  const implMatch = pricingDetails.match(/Implementation:\s*\$([0-9,]+)/);
  const monthlyMatch = pricingDetails.match(/Monthly:\s*\$([0-9,]+)/);
  const implNum = implMatch ? parseInt(implMatch[1].replace(/,/g, '')) : 0;
  const monthlyNum = monthlyMatch ? parseInt(monthlyMatch[1].replace(/,/g, '')) : 0;
  const dealValue = implNum + monthlyNum * 12;
  const dealValueStr = dealValue > 0 ? `$${dealValue.toLocaleString()}` : 'TBD';

  // Google Calendar URL helper (gcalUrl built after meetLink is set below)
  const toGCalDate = (iso) => iso ? iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '') : '';

  const leadNotes = notes ? notes.split('|')[0]?.trim() || '' : '';
  const leadPain = notes ? notes.split('|')[1]?.trim() || '' : '';

  // ── Google Calendar Event Insert ──────────────────────────────────────────────
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Always refresh token immediately before insert
    let tokenRefreshOk = true;
    try {
      const result = await oauth2Client.getAccessToken();
      if (result && result.token) {
        cachedAccessToken = result.token;
        tokenExpiresAt = result.res?.data?.expiry_date || (Date.now() + 3500000);
      }
    } catch (e) {
      console.error('⚠️ Token refresh before calendar insert failed:', e.message);
      tokenRefreshOk = false;
      if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000) {
        sendTelegramAlert(`🚨 GOOGLE TOKEN EXPIRED\nCalendar token refresh failed and no valid cached token.\nBooking: ${name} (${email}) — ${slotLabel}\nError: ${e.message}\nAction needed: Re-authorize at /oauth/start`);
      }
    }

    if (!tokenRefreshOk && (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000)) {
      console.error('⚠️ Skipping calendar insert — no valid token available');
    } else {

    const structuredDesc = `🧑 LEAD\nName: ${name}\nEmail: ${email}\nCompany: ${company}\n\n🎯 WHAT THEY WANT\n${leadNotes}\n\n⚠️ PAIN POINTS\n${leadPain}\n\n💰 RECOMMENDED PRICING\n${pricingDetails}\n\n📋 PREP NOTES\n- Review their industry and look for relevant NeuralFlow case studies\n- Come with 2-3 specific automation ideas for their use case\n- Be ready to discuss timeline and next steps\n\n🤖 Booked via ARIA | neuralflowai.io`;

    let eventData = null;
    const delays = [2000, 4000, 8000];

    for (let i = 0; i < 3; i++) {
      try {
        console.log(`📅 Creating calendar event... (attempt ${i + 1})`);

        // Refresh token immediately before insert (Fix Bug 1)
        const tokenRes = await oauth2Client.getAccessToken();
        if (tokenRes && tokenRes.token) {
          cachedAccessToken = tokenRes.token;
          tokenExpiresAt = tokenRes.res?.data?.expiry_date || (Date.now() + 3500000);
        }

        const res = await Promise.race([
          calendar.events.insert({
            calendarId: 'primary',
            sendUpdates: 'none',
            conferenceDataVersion: 1,
            requestBody: {
              summary: `Consultation: ${name} (${company}) x NeuralFlowAI`,
              description: structuredDesc,
              start: { dateTime: slotStart, timeZone: 'America/New_York' },
              end: { dateTime: slotEnd, timeZone: 'America/New_York' },
              attendees: [{ email: process.env.GMAIL_USER }],
              conferenceData: {
                createRequest: {
                  requestId: `nf-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
        ]);
        eventData = res.data;
        console.log(`✅ Event created: ${eventData.id} | ${eventData.htmlLink}`);
        break;
      } catch (err) {
        console.error(`❌ Calendar insert failed (attempt ${i + 1}):`, err);
        if (i < 2) await new Promise(r => setTimeout(r, delays[i]));
      }
    }

    if (eventData) {
      // Fix Bug 1 & 2: extract Meet link
      meetLink = eventData.conferenceData?.entryPoints?.[0]?.uri || null;
      eventHtmlLink = eventData.htmlLink || null;
      console.log('📹 Meet link:', meetLink);
      console.log('📅 Event link:', eventHtmlLink);

      // Verify event exists in calendar, retry once if not
      try {
        await calendar.events.get({ calendarId: 'primary', eventId: eventData.id });
        console.log('✅ Event verified in calendar');
      } catch (verErr) {
        console.warn('⚠️ Event verification failed — retrying insert once...');
        try {
          await new Promise(r => setTimeout(r, 2000));
          const retryRes = await calendar.events.insert({
            calendarId: 'primary',
            sendUpdates: 'none',
            conferenceDataVersion: 1,
            requestBody: {
              summary: `Consultation: ${name} (${company}) x NeuralFlowAI`,
              description: structuredDesc,
              start: { dateTime: slotStart, timeZone: 'America/New_York' },
              end: { dateTime: slotEnd, timeZone: 'America/New_York' },
              attendees: [{ email: process.env.GMAIL_USER }],
              conferenceData: {
                createRequest: {
                  requestId: `nf-retry-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
          });
          eventData = retryRes.data;
          meetLink = eventData.conferenceData?.entryPoints?.[0]?.uri || null;
          eventHtmlLink = eventData.htmlLink || eventHtmlLink;
          console.log('✅ Retry event created:', eventData.id);
        } catch (retryErr) {
          console.error('❌ Retry insert also failed:', retryErr);
          sendTelegramAlert(`🚨 ARIA CALENDAR FAILED\nCould not create Google Calendar event after all retries.\nBooking: ${name} (${email}) — ${slotLabel}\nError: ${retryErr.message}`);
        }
      }
    }
    if (!eventData) {
      sendTelegramAlert(`🚨 ARIA CALENDAR FAILED\nNo calendar event created for booking.\nClient: ${name} (${email})\nSlot: ${slotLabel}`);
    }
    } // end else (token available)
  }

  const calEventUrl = eventHtmlLink || `https://calendar.google.com/calendar/r/search?q=${encodeURIComponent(name)}`;

  // Build gcalUrl AFTER meetLink is set so location includes the Meet link
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Consultation+with+NeuralFlow&dates=${toGCalDate(slotStart)}/${toGCalDate(slotEnd)}&details=Strategy+session+with+Danny+Boehmer+%7C+neuralflowai.io&location=${encodeURIComponent(meetLink || '')}`;

  // ── Shared style tokens ──────────────────────────────────────────────────────
  const bg = '#0a0a0f';
  const bgCard = '#13131a';
  const bgCard2 = '#0f0f16';
  const accent = '#FF6B2B';
  const textMuted = '#a0a0b0';
  const ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  // ── Client Confirmation Email ────────────────────────────────────────────────
  const clientHtml = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><style>@media(prefers-color-scheme:light){body,table,td{background-color:#0a0a0f!important;color:#ffffff!important}}@media only screen and (max-width:600px){.email-container{width:100%!important}}</style><title>Consultation Confirmed</title></head>
<body style="margin:0;padding:0;background:#06060b;font-family:${ff};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060b;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">

    <!-- HEADER -->
    <tr><td style="background:${bg};padding:36px 40px 28px;position:relative;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="background:radial-gradient(circle at 90% 20%,rgba(255,107,43,0.18) 0%,transparent 60%);position:absolute;top:0;right:0;width:100%;height:100%;pointer-events:none;"></div>
      <div style="position:relative;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1;">
          <span style="color:#fff;">Neural</span><span style="color:${accent};">Flow</span>
        </div>
        <div style="margin-top:6px;padding-left:10px;border-left:2px solid ${accent};font-size:10px;font-weight:700;letter-spacing:2px;color:${accent};text-transform:uppercase;">AI Consulting &amp; Automation</div>
      </div>
    </td></tr>

    <!-- HERO -->
    <tr><td style="background:${bg};padding:48px 40px 36px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">✦ Booking Confirmed</div>
      <h1 style="margin:0 0 14px;font-size:30px;font-weight:800;color:#fff;letter-spacing:-0.5px;line-height:1.2;">Your Consultation<br>is Confirmed</h1>
      <p style="margin:0;font-size:16px;color:${textMuted};line-height:1.6;">Hi <strong style="color:#fff;">${name}</strong>, your 1-hour strategy session with Danny Boehmer is all set. Check the details below and add it to your calendar.</p>
    </td></tr>

    <!-- DETAILS CARD -->
    <tr><td style="background:${bgCard};padding:0 40px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${accent};">
        <tr><td style="padding:24px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:13px;color:${textMuted};">📅 When</span><br>
                <span style="font-size:15px;font-weight:600;color:#fff;">${slotLabel}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:13px;color:${textMuted};">⏱ Duration</span><br>
                <span style="font-size:15px;font-weight:600;color:#fff;">1 hour</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;">
                <span style="font-size:13px;color:${textMuted};">📹 Google Meet</span><br>
                ${meetLink
      ? `<a href="${meetLink}" style="font-size:15px;font-weight:600;color:${accent};text-decoration:none;">${meetLink}</a>`
      : `<span style="font-size:15px;color:${textMuted};">Google Meet link will be sent separately</span>`}
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- BUTTONS -->
    <tr><td style="background:${bgCard};padding:0 40px 48px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:12px;">
            ${meetLink
      ? `<a href="${meetLink}" style="display:inline-block;background:${accent};color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:8px;letter-spacing:0.3px;">Join Google Meet →</a>`
      : `<span style="display:inline-block;background:#333;color:#888;font-size:14px;font-weight:700;padding:13px 24px;border-radius:8px;">Meet link coming shortly</span>`}
          </td>
          <td>
            <a href="${gcalUrl}" style="display:inline-block;background:transparent;color:${accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;border:1.5px solid ${accent};letter-spacing:0.3px;">Add to Calendar</a>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:${bg};padding:28px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
      <a href="https://neuralflowai.io" style="font-size:14px;font-weight:700;color:${accent};text-decoration:none;">neuralflowai.io</a>
      <p style="margin:8px 0 4px;font-size:12px;color:${textMuted};">© 2026 NeuralFlow AI. All rights reserved.</p>
      <p style="margin:0;font-size:12px;color:rgba(160,160,176,0.5);">Questions? Reply to this email.</p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;

  // ── Danny Notification Email ──────────────────────────────────────────────────
  const pricingLines = pricingDetails.split('\n').filter(l => l.trim());
  const impl = pricingLines.find(l => l.startsWith('Implementation:')) || 'Implementation: TBD';
  const monthly = pricingLines.find(l => l.startsWith('Monthly:')) || 'Monthly: TBD';
  const roi = pricingLines.find(l => l.startsWith('ROI:')) || 'ROI: TBD';

  const sectionCard = (emoji, heading, content) => `
    <tr><td style="background:${bgCard2};padding:0 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${accent};margin-bottom:10px;">${emoji} ${heading}</div>
          <div style="font-size:14px;color:${textMuted};line-height:1.7;white-space:pre-line;">${content}</div>
        </td></tr>
      </table>
    </td></tr>`;

  const dannyHtml = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New Booking</title></head>
<body style="margin:0;padding:0;background:#06060b;font-family:${ff};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060b;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">

    <!-- HEADER -->
    <tr><td style="background:${bg};padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="background:radial-gradient(circle at 90% 20%,rgba(255,107,43,0.18) 0%,transparent 60%);position:absolute;top:0;right:0;width:100%;height:100%;pointer-events:none;"></div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:26px;font-weight:800;"><span style="color:#fff;">Neural</span><span style="color:${accent};">Flow</span></div>
            <div style="margin-top:4px;padding-left:10px;border-left:2px solid ${accent};font-size:10px;font-weight:700;letter-spacing:2px;color:${accent};text-transform:uppercase;">AI Consulting &amp; Automation</div>
          </td>
          <td align="right">
            <span style="background:${accent};color:#fff;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;padding:6px 14px;border-radius:100px;">🔥 New Booking</span>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- LEAD CARD -->
    <tr><td style="background:${bgCard2};padding:28px 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${accent};overflow:hidden;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">🧑 Lead Details</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:6px 0;font-size:13px;color:${textMuted};width:90px;">Name</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#fff;">${name}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:${textMuted};">Email</td><td style="padding:6px 0;font-size:14px;color:${accent};"><a href="mailto:${email}" style="color:${accent};text-decoration:none;">${email}</a></td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:${textMuted};">Company</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#fff;">${company}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- SESSION DETAILS -->
    <tr><td style="background:${bgCard2};padding:0 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">📅 Session Details</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};width:90px;">When</td><td style="padding:5px 0;font-size:14px;font-weight:600;color:#fff;">${slotLabel}</td></tr>
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};">Duration</td><td style="padding:5px 0;font-size:14px;color:#fff;">1 hour</td></tr>
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};">Meet Link</td><td style="padding:5px 0;font-size:14px;"><a href="${meetLink || '#'}" style="color:${accent};text-decoration:none;">${meetLink || 'TBD'}</a></td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    ${sectionCard('🎯', 'What They Want', leadNotes || 'Not specified')}
    ${sectionCard('⚠️', 'Pain Points', leadPain || 'Not specified')}
    ${objections ? sectionCard('⚡', 'Likely Objections & Rebuttals', objections) : ''}
    ${salesAngles ? sectionCard('🎯', 'Sales Angles', salesAngles) : ''}
    ${nextSteps ? sectionCard('📋', 'Recommended Next Steps', nextSteps) : ''}
    ${competitorIntel ? sectionCard('🕵️', 'Competitive Context', competitorIntel) : ''}

    <!-- PRICING SUMMARY -->
    <tr><td style="background:${bgCard2};padding:0 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;border:1.5px solid ${accent};overflow:hidden;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">💰 Pricing Summary</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};width:160px;">${impl.split(':')[0]}</td><td style="padding:5px 0;font-size:14px;font-weight:600;color:#fff;">${impl.split(':')[1] || ''}</td></tr>
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};">${monthly.split(':')[0]}</td><td style="padding:5px 0;font-size:14px;font-weight:600;color:#fff;">${monthly.split(':').slice(1).join(':') || ''}</td></tr>
            <tr><td style="padding:5px 0;font-size:13px;color:${textMuted};">Estimated ROI</td><td style="padding:5px 0;font-size:14px;color:${textMuted};">${roi.replace('ROI:', '').trim()}</td></tr>
            <tr><td style="padding:10px 0 0;font-size:13px;color:${textMuted};border-top:1px solid rgba(255,255,255,0.06);">Deal Value (12mo)</td><td style="padding:10px 0 0;font-size:16px;font-weight:800;color:${accent};border-top:1px solid rgba(255,255,255,0.06);">${dealValueStr}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- BUTTONS -->
    <tr><td style="background:${bgCard2};padding:0 40px 20px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:12px;">
            <a href="${calEventUrl}" style="display:inline-block;background:${accent};color:#fff;font-size:13px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;">View Calendar Event</a>
          </td>
          <td>
            <a href="mailto:${email}" style="display:inline-block;background:transparent;color:${accent};font-size:13px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:8px;border:1.5px solid ${accent};">Reply to Lead</a>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:${bg};padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
      <a href="https://neuralflowai.io" style="font-size:13px;font-weight:700;color:${accent};text-decoration:none;">neuralflowai.io</a>
      <p style="margin:6px 0 0;font-size:11px;color:rgba(160,160,176,0.5);">🤖 Booked via ARIA</p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;

  // Send emails via Resend API (HTTP/443 — works on Railway, no SMTP needed)
  async function sendWithResend(to, subject, html, label) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'NeuralFlow AI <danny@neuralflowai.io>', to, subject, html })
        });
        const data = await res.json();
        if (res.ok) { console.log(`✅ ${label} sent (Resend id: ${data.id})`); return; }
        throw new Error(data.message || JSON.stringify(data));
      } catch (e) {
        console.error(`❌ ${label} attempt ${i + 1} failed:`, e.message);
        if (i < 2) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
      }
    }
    sendTelegramAlert(`🚨 ARIA EMAIL FAILED\n${label} failed after 3 attempts.\nBooking: ${name} (${email}) — ${slotLabel}`);
  }

  sendWithResend(email, "Your NeuralFlow Consultation is Confirmed ✅", clientHtml, `Client email to ${email}`);
  sendWithResend(process.env.GMAIL_USER, `🔥 New Booking — ${name} (${company}) | ${dealValueStr} potential`, dannyHtml, `Danny notification email`);
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/oauth/start', (req, res) => {
  res.redirect(oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar'] }));
});

app.get('/oauth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send('✅ Google Calendar connected!');
  } catch (e) {
    res.status(500).send('Auth failed');
  }
});

app.get('/accept', (req, res) => res.sendFile(path.join(__dirname, 'accept.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/test-email', async (req, res) => {
  const results = { RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET' : 'MISSING' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'NeuralFlow AI <danny@neuralflowai.io>', to: process.env.GMAIL_USER, subject: '✅ ARIA Resend Test', html: '<p>Resend is working on Railway!</p>' })
    });
    const data = await r.json();
    if (r.ok) { results.send = 'OK'; results.resend_id = data.id; }
    else { results.error = data.message || JSON.stringify(data); }
  } catch (e) { results.error = e.message; }
  res.json(results);
});

app.get('/api/availability', async (req, res) => {
  res.json({ slots: await getAvailableSlots(90, req.query.date || null) });
});

app.post('/api/book', chatRateLimit, async (req, res) => {
  try {
    await bookAppointment(req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('Book endpoint error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/contact', async (req, res) => {
  const { name, email, scope } = req.body;
  let sent = false;

  if (resend) {
    try {
      await resend.emails.send({
        from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
        to: process.env.GMAIL_USER,
        subject: `🔥 New Contact Form — ${name}`,
        html: `<p>Name: ${name}<br/>Email: ${email}<br/>Scope: ${scope}</p>`,
      });
      await resend.emails.send({
        from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
        to: email,
        subject: `Thanks for reaching out, ${name.split(' ')[0]}! 🚀`,
        html: `<p>Hi ${name.split(' ')[0]}, I'll get back to you within 24 hours! - Danny</p>`,
      });
      sent = true;
    } catch (e) {
      console.error('Resend contact form failed:', e.message);
    }
  }

  if (!sent) {
    sendTelegramAlert(`🚨 CONTACT FORM — Resend failed\nName: ${name}\nEmail: ${email}\nScope: ${scope}`);
  }

  res.json({ success: true });
});

app.post('/api/accept-proposal', async (req, res) => {
  const { name, businessName, email, phone, amount, fee } = req.body;

  if (!name || !businessName || !email) {
    return res.status(400).json({ ok: false, error: 'Name, Business Name, and Email are required.' });
  }

  try {
    // 1. Telegram Notification
    {
      const tgToken = process.env.TELEGRAM_BOT_TOKEN || '8354160885:AAHsmTw_qDhYsEf2Htd2qotMd1kPRm-okmw';
      const tgChat = process.env.TELEGRAM_CHAT_ID || '8709413106';
      const message = `🎉 NEW CLIENT ACCEPTED\n\nBusiness: ${businessName}\nContact: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nDeposit: $${amount}\nMonthly: $${fee}/mo`;
      const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      const payload = JSON.stringify({ chat_id: tgChat, text: message });

      const reqTg = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (resTg) => {
        let response = '';
        resTg.on('data', (chunk) => { response += chunk; });
        resTg.on('end', () => {
          if (resTg.statusCode !== 200) {
            console.error('Telegram notification failed:', response);
          }
        });
      });

      reqTg.on('error', (err) => console.error('Telegram request error:', err.message));
      reqTg.write(payload);
      reqTg.end();
    }

    // Shared styles for Emails
    const emailStyles = `
      background-color: #0a0a0f;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 40px;
      line-height: 1.6;
    `;
    const accentColor = '#FF6B2B';

    // 2. Email to Danny
    const dannyMailOptions = {
      from: `"NeuralFlow AI" <${process.env.GMAIL_USER}>`,
      to: 'danny@neuralflowai.io',
      subject: `🎉 NEW CLIENT — ${businessName} accepted their proposal`,
      html: `
        <div style="${emailStyles}">
          <h1 style="color: ${accentColor};">New Proposal Accepted!</h1>
          <p><strong>Business:</strong> ${businessName}</p>
          <p><strong>Contact:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
          <p><strong>Deposit:</strong> $${amount}</p>
          <p><strong>Monthly Fee:</strong> $${fee}/mo</p>
          <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;">
          <p><em>Action required: Send DocuSign agreement and Stripe invoice now.</em></p>
        </div>
      `,
    };

    // 3. Email to Client
    const clientMailOptions = {
      from: `"Danny @ NeuralFlow" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Welcome to NeuralFlow AI — Here's What Happens Next`,
      html: `
        <div style="${emailStyles}">
          <h2 style="color: ${accentColor};">Welcome to NeuralFlow AI, ${name.split(' ')[0]}!</h2>
          <p>Your proposal has been accepted. We're excited to start this journey with <strong>${businessName}</strong>.</p>
          <p>Here's what happens next:</p>
          <ol>
            <li>We'll send your consulting agreement via <strong>DocuSign</strong> within 24 hours.</li>
            <li>A deposit invoice will follow for <strong>$${amount}</strong> to begin work.</li>
            <li>Onboarding starts immediately after the agreement is signed.</li>
          </ol>
          <p><strong>Expected go-live:</strong> 10–14 days from today.</p>
          <p>If you have any questions, simply reply to this email.</p>
          <br>
          <p>— Danny Boehmer<br>Founder, NeuralFlow AI</p>
        </div>
      `,
    };

    // Send emails via Resend API — non-blocking
    async function sendAcceptWithResend(to, subject, html, label) {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'NeuralFlow AI <danny@neuralflowai.io>', to, subject, html })
          });
          const data = await r.json();
          if (r.ok) { console.log(`✅ ${label} sent (Resend id: ${data.id})`); return; }
          throw new Error(data.message || JSON.stringify(data));
        } catch (e) {
          console.error(`❌ ${label} attempt ${i + 1} failed:`, e.message);
          if (i < 2) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
        }
      }
      sendTelegramAlert(`🚨 ACCEPT-PROPOSAL EMAIL FAILED\n${label} failed after 3 attempts.\nClient: ${name} (${email})\nBusiness: ${businessName}`);
    }

    sendAcceptWithResend('danny@neuralflowai.io', dannyMailOptions.subject, dannyMailOptions.html, `Accept-proposal Danny email`);
    sendAcceptWithResend(email, clientMailOptions.subject, clientMailOptions.html, `Accept-proposal client email to ${email}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('Accept proposal error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error processing your request.' });
  }
});

// ─── Chat / ARIA ──────────────────────────────────────────────────────────────
app.post('/api/chat', chatRateLimit, async (req, res) => {
  try {
    const { messages, conversationId, clientTimezone } = req.body;
    if (!messages) return res.status(400).json({ error: 'Messages required' });
    const convId = conversationId || 'default';

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    // Pre-warm global cache on first message
    if ((!globalSlotCache || globalSlotCache.length === 0) && messages.length <= 2) {
      await refreshGlobalSlotCache();
    }

    // ── 1. Specific time detection ────────────────────────────────────────────
    let requestedTime = null;
    const timeMatch = lastUserMsg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (timeMatch) {
      let hr = parseInt(timeMatch[1]);
      const min = parseInt(timeMatch[2] || '0');
      const ampm = timeMatch[3].toLowerCase();
      if (ampm === 'pm' && hr < 12) hr += 12;
      if (ampm === 'am' && hr === 12) hr = 0;
      let roundedMin = min < 15 ? 0 : min < 45 ? 30 : 60;
      if (roundedMin === 60) { hr = (hr + 1) % 24; roundedMin = 0; }
      requestedTime = { hr, min: roundedMin };
      console.log(`⏰ Detected time: ${hr}:${String(roundedMin).padStart(2, '0')}`);
    }

    // ── 2. Date phrase detection (runs FIRST, before flexible check) ──────────
    let searchFromDate = null;
    let daysWindow = 7;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const wMatch = lastUserMsg.match(/\bin\s+(\d+)\s+weeks?\b/);
    const mMatch = lastUserMsg.match(/\bin\s+(\d+)\s+months?\b/);

    if (lastUserMsg.match(/\bend of (the )?month\b/)) {
      const d = new Date();
      const target = new Date(d.getFullYear(), d.getMonth(), 20);
      if (d.getDate() >= 20) target.setMonth(target.getMonth() + 1);
      searchFromDate = target.toISOString().split('T')[0]; daysWindow = 10;
    } else if (lastUserMsg.match(/\bnext week\b|\bfollowing week\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/\bcouple weeks?\b|\bfew weeks?\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (wMatch) {
      const d = new Date(); d.setDate(d.getDate() + parseInt(wMatch[1]) * 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/\bnext month\b/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else if (lastUserMsg.match(/\bin a few months?\b|\ba couple months?\b|\bin 2 months?\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 60);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else if (lastUserMsg.match(/\bin 3 months?\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 90);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else if (mMatch) {
      const d = new Date(); d.setDate(d.getDate() + parseInt(mMatch[1]) * 30);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else {
      // Specific date: "March 15", "the 15th", "15th"
      const dateMatch = lastUserMsg.match(/(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?)|(?:\bthe\s+(\d{1,2})(?:st|nd|rd|th))|(?:\b(\d{1,2})(?:st|nd|rd|th)\b)/);
      if (dateMatch) {
        const monthStr = dateMatch[1];
        const dayNum = parseInt(dateMatch[2] || dateMatch[3] || dateMatch[4]);
        if (dayNum >= 1 && dayNum <= 31) {
          const d = new Date();
          if (monthStr) {
            d.setMonth(monthNames.indexOf(monthStr));
          } else {
            const prior = conversationSlots.get(convId);
            if (prior?.slots?.length > 0) {
              const ref = new Date(prior.slots[0].start);
              const candidate = new Date(ref.getUTCFullYear(), ref.getUTCMonth(), dayNum, 12);
              if (candidate > new Date()) { d.setFullYear(ref.getUTCFullYear()); d.setMonth(ref.getUTCMonth()); }
            }
          }
          d.setDate(dayNum);
          if (d < new Date(new Date().setHours(0,0,0,0))) d.setFullYear(d.getFullYear() + 1);
          searchFromDate = d.toISOString().split('T')[0]; daysWindow = 3;
        }
      } else {
        // Month only: "in March", "March"
        for (const [i, month] of monthNames.entries()) {
          if (lastUserMsg.includes(month)) {
            const d = new Date(); d.setMonth(i);
            if (d < new Date(new Date().setHours(0,0,0,0))) d.setFullYear(d.getFullYear() + 1);
            d.setDate(1);
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
            break;
          }
        }
      }
    }

    // ── 3. Flexible detection — ONLY if no specific date/time was found ────────
    const userIsFlexible = !searchFromDate && !requestedTime &&
      !!(lastUserMsg.match(/\banytime\b|whatever works|you pick|\bflexible\b|whatever is available|doesn.t matter|what.s your availability|what.s available|when are you free|when is danny free|what times do you have|what do you have open|show me times|show me availability/));

    // ── 4. Validate date — reject past, redirect Sundays ─────────────────────
    let pastDateNote = false;
    let weekendNote = false;
    if (searchFromDate) {
      const today = new Date(); today.setHours(0,0,0,0);
      const reqD = new Date(searchFromDate + 'T12:00:00'); reqD.setHours(0,0,0,0);
      if (reqD < today) {
        searchFromDate = null;
        pastDateNote = true;
      } else if (new Date(searchFromDate + 'T12:00:00').getDay() === 0) {
        const d = new Date(searchFromDate + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        searchFromDate = d.toISOString().split('T')[0];
        weekendNote = true;
      }
    }

    // ── 5. Fetch slots ────────────────────────────────────────────────────────
    let slots;
    if (searchFromDate) {
      // Specific date requested — always live fetch
      console.log('🔍 Live fetch:', searchFromDate, 'window:', daysWindow);
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      if (!slots || slots.length === 0) {
        console.log('🔍 No slots found, widening to 7 days from', searchFromDate);
        slots = await getAvailableSlots(7, searchFromDate);
      }
      if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    } else if (requestedTime) {
      // Time-only request — use last discussed date or default
      const prior = conversationSlots.get(convId);
      const fallbackDate = prior?.slots?.[0]?.start.split('T')[0] || null;
      if (fallbackDate) {
        searchFromDate = fallbackDate;
        console.log('⏰ Time-only request — fetching full day for', searchFromDate);
        slots = await getAvailableSlots(1, searchFromDate, true);
        if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      } else {
        slots = globalSlotCache?.filter(s => new Date(s.start) > new Date()) || await getAvailableSlots(14, null);
      }
    } else if (userIsFlexible) {
      console.log('📦 Flexible user — using global cache');
      slots = globalSlotCache?.filter(s => new Date(s.start) > new Date()) || await getAvailableSlots(14, null);
      if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    } else {
      // Default — use conversation cache if fresh, else global cache
      const cached = conversationSlots.get(convId);
      const validCached = cached?.slots?.filter(s => new Date(s.start) > new Date()) || [];
      if (validCached.length > 0) {
        slots = validCached;
        console.log('📦 Using conversation cache:', slots.length, 'slots');
      } else {
        slots = globalSlotCache?.filter(s => new Date(s.start) > new Date()) || await getAvailableSlots(14, null);
        if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      }
    }

    // Expand to full-day slots when user asks for more options
    if (lastUserMsg.match(/\bwhat else\b|\bany other\b|\bmore times\b|\bother slots\b/)) {
      const fetchDate = searchFromDate || slots?.[0]?.start.split('T')[0];
      if (fetchDate) {
        const more = await getAvailableSlots(1, fetchDate, true);
        if (more?.length > 0) {
          slots = [...(slots||[]), ...more].filter((v,i,a) => a.findIndex(t => t.start === v.start) === i).slice(0, 12);
          conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
        }
      }
    }

    // ── 6. Live freebusy check for exact time request ─────────────────────────
    let freebusyNote = '';
    if (requestedTime && searchFromDate) {
      const { hours: offsetHours, abbr } = getNYOffset(new Date(searchFromDate + 'T12:00:00'));
      const utcHr = requestedTime.hr + offsetHours;
      const slotStart = new Date(`${searchFromDate}T${String(utcHr).padStart(2,'0')}:${String(requestedTime.min).padStart(2,'0')}:00.000Z`);
      const slotEnd = new Date(slotStart.getTime() + 3600000);
      try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const fbRes = await calendar.freebusy.query({
          requestBody: { timeMin: slotStart.toISOString(), timeMax: slotEnd.toISOString(), items: [{ id: 'primary' }] }
        });
        const isBusy = fbRes.data.calendars.primary.busy.length > 0;
        if (!isBusy) {
          const d = new Date(searchFromDate + 'T12:00:00');
          const weekdayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
          const monthStr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          const hour12 = requestedTime.hr % 12 || 12;
          const ampm = requestedTime.hr >= 12 ? 'PM' : 'AM';
          const label = `${weekdayStr}, ${monthStr} ${d.getDate()} at ${hour12}:${String(requestedTime.min).padStart(2,'0')} ${ampm} ${abbr}`;
          const newSlot = { label, start: slotStart.toISOString(), end: slotEnd.toISOString() };
          slots = [newSlot, ...(slots||[]).filter(s => s.label !== label)].slice(0, 12);
          conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
          console.log('✅ Requested time is free, added to slots');
        } else {
          freebusyNote = `\nNOTE: ${requestedTime.hr % 12 || 12}:${String(requestedTime.min).padStart(2,'0')} ${requestedTime.hr >= 12 ? 'PM' : 'AM'} is BUSY — tell the client it's taken and offer the alternatives below.`;
          console.log('❌ Requested time is busy');
        }
      } catch (e) { console.error('Freebusy check failed:', e.message); }
    }

    // ── 7. Build system prompt ────────────────────────────────────────────────
    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const todayFormatted = `${DAY_NAMES[estDate.getDay()]}, ${MONTH_NAMES[estDate.getMonth()]} ${estDate.getDate()}, ${estDate.getFullYear()}`;
    const timeFormatted = `${String(estDate.getHours()).padStart(2,'0')}:${String(estDate.getMinutes()).padStart(2,'0')}`;
    const tomorrow = new Date(estDate); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowFormatted = `${DAY_NAMES[tomorrow.getDay()]}, ${MONTH_NAMES[tomorrow.getMonth()]} ${tomorrow.getDate()}`;

    // Context note for Claude about the date/time situation
    let slotsAlert = '';
    if (pastDateNote) {
      slotsAlert = "\nNOTE: Client requested a past date. Say: 'That date has already passed — here are the next available times:'";
    } else if (weekendNote) {
      slotsAlert = "\nNOTE: Client asked for a Sunday. Redirected to Monday. Say: 'We don't schedule on Sundays — here are the nearest times starting Monday:'";
    } else if (searchFromDate) {
      const dayName = DAY_NAMES[new Date(searchFromDate + 'T12:00:00').getDay()];
      slotsAlert = `\nDATE CONTEXT: Showing slots from ${searchFromDate} (${dayName}). Use this exact day name.`;
      if (slots && slots.length === 0) {
        slotsAlert += `\nNO SLOTS on ${searchFromDate}. Say: 'I don't have any openings on that day — here are the closest available times:' then show the alternatives below.`;
      }
    }
    if (freebusyNote) slotsAlert += freebusyNote;

    const hasEmail = messages.some(m => m.role === 'user' && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(m.content));
    const isETTimezone = !clientTimezone || /^America\/(New_York|Indiana|Detroit|Kentucky|Louisville|Toronto|Montreal|Ottawa)/.test(clientTimezone);

    // Sort slots chronologically and group by day
    let slotsText;
    if (!hasEmail) {
      slotsText = "GATE: Do not show available times yet. Collect Full Name, Email, and Company first.";
    } else if (!slots || slots.length === 0) {
      slotsText = slots === null
        ? "CALENDAR OFFLINE: Say: 'Our scheduling system has a brief hiccup — can I grab your email and I'll personally send you a few available times within the hour?'"
        : `NO SLOTS FOUND.${slotsAlert ? slotsAlert : " Ask the client for a different date."}`;
    } else {
      // Always sort chronologically before displaying
      const sorted = [...slots].sort((a, b) => new Date(a.start) - new Date(b.start));

      // Group by day so Claude can see which slots belong to the same day
      const byDay = {};
      for (const s of sorted) {
        const dayKey = s.start.split('T')[0];
        if (!byDay[dayKey]) byDay[dayKey] = [];
        byDay[dayKey].push(s);
      }

      let idx = 1;
      const lines = [];
      for (const [dayKey, daySlots] of Object.entries(byDay)) {
        const d = new Date(dayKey + 'T12:00:00');
        lines.push(`--- ${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()} ---`);
        for (const s of daySlots) {
          let label = s.label;
          if (clientTimezone && !isETTimezone) {
            const localTime = formatSlotInClientTz(s.start, clientTimezone);
            if (localTime) label += ` / ${localTime} your time`;
          }
          lines.push(`${idx}. ${label} [start:${s.start}]`);
          idx++;
        }
      }
      slotsText = `AVAILABLE SLOTS:${slotsAlert}\n${lines.join('\n')}`;
    }

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company. Danny Boehmer is the founder. Website: neuralflowai.io.

RIGHT NOW: ${todayFormatted}, ${timeFormatted} Eastern Time
You must always use this date and time when reasoning about scheduling. Never guess or assume what day or month it is — it is ${todayFormatted}. Tomorrow is ${tomorrowFormatted}.

CONVERSATION FLOW — follow this exact order:
1. Greet warmly, ask what brings them to NeuralFlow today
2. Ask 2-3 questions to understand their business needs and pain points (what they want automated, what's slowing them down, what's their biggest time sink)
3. Collect in this order: Full Name → Email → Company name
   EMAIL VALIDATION: A valid email has exactly one @ and a dot after it. If the format looks wrong, say: "Could you double-check that email? I want to make sure your invite reaches you." Do not proceed until you have a valid email.
4. Once you have name, email, company, and understand their needs — present available slots
5. When they confirm a slot — output the BOOK command

HOW TO PRESENT SLOTS:
The slot list below is grouped by day in chronological order. Always work forward in time — never offer a slot on an earlier date after offering a later one.

When showing slots for the first time (or when a client hasn't specified a date):
- Show exactly 3 times from the FIRST day listed — one morning, one afternoon, one evening
- All 3 must be from the same day
- End with: "If none of these work, just tell me a different date or time and I'll check Danny's calendar."

When the client asks for a specific date or time range (e.g. "next week", "March 20th", "how about Tuesday"):
- Show 3 times from the earliest available day within that range (one morning, one afternoon, one evening from the same day)

When the client asks for more options on the same day:
- Show the remaining times available for that day from the list

SCHEDULING RULES:
- Plain text only — no asterisks, no bold, no markdown, no bullet symbols
- Copy slot labels EXACTLY character-for-character from the list — never reformat or paraphrase
- Never offer a slot less than 24 hours from now (today is ${todayFormatted})
- Never invent slots that aren't in the list
- Never include the year when stating dates (say "Tuesday, April 15" not "Tuesday, April 15, 2026")
- The slotStart in the BOOK command must always match the [start:ISO] from the exact slot you confirmed

CONFIRMATION FLOW:
Before booking, send exactly:
"Just to confirm — I'm booking [exact slot label] for [Full Name] at [email]. Shall I go ahead?"
Accept any clear yes: yes, correct, go ahead, book it, sounds good, perfect, that works, great, sure, absolutely, confirmed, do it, let's do it, looks good, yep, yup.
Never book on an ambiguous reply.

ON CONFIRMATION — output immediately:
BOOK:{"slotStart":"ISO_FROM_SLOT_LIST","slotLabel":"EXACT label","name":"Full Name","email":"email@example.com","company":"Company","notes":"what they want automated | pain points and challenges"}
Then say: "You're all set! A calendar invite will be sent to [email] shortly."

Keep replies to 2-3 sentences. Be warm, conversational, and professional. Never mention pricing.

${slotsText}`;

    // ── 8. Call Claude (with OpenRouter fallback) ─────────────────────────────
    let aiReplyText = '';
    try {
      let resAnthropic;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          resAnthropic = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: systemPrompt,
            messages
          });
          break;
        } catch (e) {
          if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
          else throw e;
        }
      }
      aiReplyText = resAnthropic.content[0].text;
    } catch (e) {
      console.log('Anthropic failed, falling back to OpenRouter');
      const resOpenRouter = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neuralflowai.io',
          'X-Title': 'NeuralFlow ARIA'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4-5:beta',
          max_tokens: 600,
          messages: [{ role: 'system', content: systemPrompt }, ...messages]
        })
      });
      if (!resOpenRouter.ok) throw new Error('OpenRouter failed');
      const data = await resOpenRouter.json();
      aiReplyText = data.choices[0].message.content;
    }

    // Strip markdown formatting
    aiReplyText = aiReplyText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/^\*\s+/gm, '- ');

    // Track confirmation phrase — store the agreed slot so booking uses the right time
    const lowerReply = aiReplyText.toLowerCase();
    if (lowerReply.includes('just to confirm') || lowerReply.includes("i'm booking")) {
      const activeSlots = conversationSlots.get(convId)?.slots || slots || [];
      const matchedSlot = activeSlots.find(s => {
        const core = s.label.replace(/\s*\[start:[^\]]+\]/g, '').replace(/\s*\/\s*\d{1,2}:\d{2}\s*(AM|PM)\s+\w+\s+your time/i, '').trim();
        return aiReplyText.includes(core);
      });
      if (matchedSlot) {
        agreedSlots.set(convId, { slot: matchedSlot, storedAt: Date.now() });
        console.log(`📌 Agreed slot stored for ${convId}: ${matchedSlot.label}`);
      }
    }

    // ── 9. BOOK command parser ────────────────────────────────────────────────
    const bookMatch = aiReplyText.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch) {
      let bookData;
      try {
        bookData = JSON.parse(bookMatch[1]);
      } catch (e) {
        console.error('Failed to parse BOOK JSON:', e.message);
        return res.json({ reply: 'Sorry, I had trouble with that. Could you confirm the email address again?', booked: false });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!bookData.email || !emailRegex.test(bookData.email)) {
        console.log('⚠️ Invalid email in BOOK command:', bookData.email);
        return res.json({ reply: "Could you double-check that email address? I want to make sure your calendar invite reaches you.", booked: false });
      }

      const activeSlots = conversationSlots.get(convId)?.slots || slots || [];
      let slot = null;
      let matchMethod = '';

      // Priority 1: agreed slot stored at confirmation step
      const agreedEntry = agreedSlots.get(convId);
      if (agreedEntry?.slot) {
        slot = agreedEntry.slot;
        matchMethod = 'Agreed Slot Map';
        console.log(`📌 Using agreedSlot: ${slot.label}`);
      }

      // Priority 2: exact ISO match from active slots
      if (!slot) {
        slot = activeSlots.find(s => s.start === bookData.slotStart);
        if (slot) matchMethod = 'Exact ISO Match';
      }

      // Priority 3: label match
      if (!slot) {
        slot = activeSlots.find(s => s.label === bookData.slotLabel);
        if (slot) matchMethod = 'Label Match';
      }

      // Priority 4: use BOOK data directly (last resort)
      if (!slot && bookData.slotStart) {
        const end = bookData.slotEnd || new Date(new Date(bookData.slotStart).getTime() + 3600000).toISOString();
        slot = { start: bookData.slotStart, end, label: bookData.slotLabel || bookData.slotStart };
        matchMethod = 'Direct BOOK Fallback';
        console.log(`⚠️ No cache match — using BOOK data directly: ${slot.label}`);
      }

      if (!slot) {
        console.error(`❌ No slot matched for convId: ${convId}`, bookData);
        sendTelegramAlert(`🚨 ARIA BOOKING MISSED\nNo slot matched.\nClient: ${bookData.name} (${bookData.email})\nRequested: ${bookData.slotLabel}`);
      }

      if (slot) {
        // Fresh fetch to verify slot is still available (skip for direct fallback to avoid blocking)
        const exactDate = slot.start.split('T')[0];
        const freshSlots = await getAvailableSlots(1, exactDate);
        const normalizeLabel = l => l.replace(/\b(EDT|EST)\b/, 'ET');
        const freshSlot = freshSlots ? freshSlots.find(s => normalizeLabel(s.label) === normalizeLabel(slot.label)) : null;

        // Only block if we have fresh data AND it's explicitly unavailable
        if (freshSlots && freshSlots.length > 0 && !freshSlot && matchMethod !== 'Direct BOOK Fallback') {
          conversationSlots.delete(convId);
          agreedSlots.delete(convId);
          const reply = "I apologize, but it looks like that specific time was just booked by someone else! Let me check what else is available around then.";
          aiReplyText = aiReplyText.replace(/BOOK:\{.*?\}/s, '').replace(/\[start:[^\]]+\]/g, '').trim();
          return res.json({ reply: reply + "\n" + aiReplyText, booked: false });
        }

        if (freshSlot) slot = freshSlot;

        console.log(`📌 Booking confirmed: ${slot.label} | method: ${matchMethod} (Fresh Confirmed)`);
        // Fire booking in background — don't block the response
        bookAppointment({
          name: bookData.name, email: bookData.email, company: bookData.company,
          notes: bookData.notes, slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label
        }).catch(err => console.error('Background booking error:', err.message));
        conversationSlots.delete(convId);
        agreedSlots.delete(convId);
      }

      aiReplyText = aiReplyText.replace(/BOOK:\{.*?\}/s, '').replace(/\[start:[^\]]+\]/g, '').trim();
      return res.json({ reply: aiReplyText, booked: true });
    }

    aiReplyText = aiReplyText.replace(/\[start:[^\]]+\]/g, '').trim();
    res.json({ reply: aiReplyText });
  } catch (e) {
    console.error('AI Error:', e.message);
    res.status(500).json({ error: 'AI error' });
  }
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message, err.stack);
  sendTelegramAlert('🚨 SERVER CRASH\nuncaughtException: ' + err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  sendTelegramAlert('🚨 SERVER ERROR\nunhandledRejection: ' + String(reason));
});

app.listen(port, () => {
  console.log(`Server running on ${port}`);
  // Self-ping every 4 minutes to prevent Railway cold starts
  setInterval(() => {
    const pingReq = https.get('https://neuralflowai.io/api/availability', { timeout: 8000 }, (res) => {
      console.log('🏓 Keep-alive ping:', res.statusCode);
      res.resume();
    });
    pingReq.on('timeout', () => { pingReq.destroy(); });
    pingReq.on('error', (e) => console.log('Keep-alive error:', e.message));
  }, 4 * 60 * 1000);
});
