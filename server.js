require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const { google } = require('googleapis');
const fs = require('fs');

const nodemailer = require('nodemailer');
const https = require('https');

const app = express();
const port = process.env.PORT || 8080;

// ─── Transporter ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

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
  oauth2Client.getAccessToken().catch(() => { });
} else if (fs.existsSync(TOKEN_PATH)) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));

// ─── Conversation Cache ───────────────────────────────────────────────────────
const conversationSlots = new Map();
const agreedSlots = new Map();
setInterval(() => {
  const expiry = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < expiry) conversationSlots.delete(key);
  }
  for (const [key, val] of agreedSlots.entries()) {
    // Also expire agreed slots after 10 mins
    agreedSlots.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Global Slots Cache ───────────────────────────────────────────────────────
let globalSlotCache = null;
let globalSlotCacheUpdatedAt = 0;

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

// ─── Cached OAuth Token ───────────────────────────────────────────────────────
let cachedAccessToken = null;
let tokenExpiresAt = 0;

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
  slotLabel = slotLabel.replace(/\s*\[start:[^\]]+\]/g, '').trim();
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

  // Google Calendar URL helper
  const toGCalDate = (iso) => iso ? iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '') : '';
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Consultation+with+NeuralFlow&dates=${toGCalDate(slotStart)}/${toGCalDate(slotEnd)}&details=Strategy+session+with+Danny+Boehmer+%7C+neuralflowai.io&location=${encodeURIComponent(meetLink || '')}`;
  const calEventUrl = eventHtmlLink || 'https://calendar.google.com/calendar/r/eventedit';

  const leadNotes = notes ? notes.split('|')[0]?.trim() || '' : '';
  const leadPain = notes ? notes.split('|')[1]?.trim() || '' : '';

  // ── Google Calendar Event Insert ──────────────────────────────────────────────
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Always refresh token immediately before insert (Bug 5)
    try {
      const result = await oauth2Client.getAccessToken();
      if (result && result.token) {
        cachedAccessToken = result.token;
        tokenExpiresAt = result.res?.data?.expiry_date || (Date.now() + 3500000);
      }
    } catch (e) {
      console.error('⚠️ Token refresh before calendar insert failed:', e.message);
    }

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
        }
      }
    }
  }

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

  // Client Email
  await resend.emails.send({
    from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
    to: email,
    subject: "Your NeuralFlow Consultation is Confirmed ✅",
    html: clientHtml,
  }).catch(() => { });

  // Danny Email
  await resend.emails.send({
    from: "NeuralFlow ARIA <danny@neuralflowai.io>",
    to: process.env.GMAIL_USER,
    subject: `🔥 New Booking — ${name} (${company}) | ${dealValueStr} potential`,
    html: dannyHtml,
  }).catch(() => { });
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

app.get('/api/availability', async (req, res) => {
  res.json({ slots: await getAvailableSlots(90, req.query.date || null) });
});

app.post('/api/book', async (req, res) => {
  await bookAppointment(req.body);
  res.json({ success: true });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, scope } = req.body;
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
          'Content-Length': payload.length,
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

    // Send emails — non-blocking, don't fail if email errors
    const acceptTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    Promise.all([
      acceptTransporter.sendMail(dannyMailOptions),
      acceptTransporter.sendMail(clientMailOptions)
    ]).catch(err => console.error('Email send error:', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('Accept proposal error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error processing your request.' });
  }
});

// ─── Chat / ARIA ──────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, conversationId, clientTimezone } = req.body;
    if (!messages) return res.status(400).json({ error: 'Messages required' });
    const convId = conversationId || 'default';

    // Date Detection
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    // Fix 6: Pre-warm global cache on cold boot message
    if ((!globalSlotCache || globalSlotCache.length === 0) && messages.length <= 2) {
      await refreshGlobalSlotCache();
    }
    let searchFromDate = null;
    let daysWindow = 7;

    const wMatch = lastUserMsg.match(/in\s+(\d+)\s+weeks?/);
    const mMatch = lastUserMsg.match(/in\s+(\d+)\s+months?/);

    // Bug 6 — Flexible user detection
    let userIsFlexible = false;
    if (lastUserMsg.match(/\banytime\b|whatever works|you pick|\bflexible\b|whatever is available|doesn.t matter|what.s your availability|what.s available|when are you free|when is danny free|what times do you have|what do you have open|show me times|show me availability/)) {
      userIsFlexible = true;
    }

    if (!userIsFlexible) {
      // Bug 1 — End of month detection (before all other checks)
      if (lastUserMsg.match(/end of (the )?month/)) {
        const d = new Date();
        const target20 = new Date(d.getFullYear(), d.getMonth(), 20);
        if (d >= target20) {
          // Past the 20th — use next month's 20th
          searchFromDate = new Date(d.getFullYear(), d.getMonth() + 1, 20).toISOString().split('T')[0];
        } else {
          searchFromDate = target20.toISOString().split('T')[0];
        }
        daysWindow = 10;
      } else if (lastUserMsg.match(/couple weeks?|few weeks?/)) {
        const d = new Date(); d.setDate(d.getDate() + 14);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
      } else if (lastUserMsg.match(/next week/)) {
        const d = new Date(); d.setDate(d.getDate() + 7);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
      } else if (wMatch) {
        const d = new Date(); d.setDate(d.getDate() + parseInt(wMatch[1]) * 7);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
        // Bug 5 — Month-based phrase detection
      } else if (lastUserMsg.match(/next month/)) {
        const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
      } else if (lastUserMsg.match(/in a few months?|a couple months?|in 2 months?/)) {
        const d = new Date(); d.setDate(d.getDate() + 60);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
      } else if (lastUserMsg.match(/in 3 months?/)) {
        const d = new Date(); d.setDate(d.getDate() + 90);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
      } else if (mMatch) {
        const d = new Date(); d.setDate(d.getDate() + parseInt(mMatch[1]) * 30);
        searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
      } else {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const dateMatch = lastUserMsg.match(/(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?)|(?:\bthe\s+(\d{1,2})(?:st|nd|rd|th))|(?:\b(\d{1,2})(?:st|nd|rd|th)\b)/);
        if (dateMatch) {
          const monthStr = dateMatch[1];
          const dayNum = parseInt(dateMatch[2] || dateMatch[3] || dateMatch[4]);
          if (dayNum >= 1 && dayNum <= 31) {
            const d = new Date();
            if (monthStr) d.setMonth(monthNames.indexOf(monthStr));
            d.setDate(dayNum);
            if (d < new Date(new Date().setHours(0, 0, 0, 0))) d.setFullYear(d.getFullYear() + 1);
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 3;
          }
        } else {
          for (const [i, month] of monthNames.entries()) {
            if (lastUserMsg.includes(month)) {
              const d = new Date(); d.setMonth(i);
              if (d < new Date(new Date().setHours(0, 0, 0, 0))) d.setFullYear(d.getFullYear() + 1);
              d.setDate(1);
              searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
              break;
            }
          }
        }
      }
    }

    let pastDateNote = false;
    if (searchFromDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reqDate = new Date(searchFromDate + "T12:00:00");
      reqDate.setHours(0, 0, 0, 0);
      if (reqDate < today) {
        searchFromDate = null;
        pastDateNote = true;
      }
    }

    let weekendNote = false;
    let weekendRedirectDate = null;
    if (searchFromDate) {
      const d = new Date(searchFromDate + "T12:00:00");
      const day = d.getDay();
      if (day === 0 || day === 6) {
        const originalDate = searchFromDate;
        if (day === 0) d.setDate(d.getDate() + 1); // Sunday -> Monday
        else d.setDate(d.getDate() + 2); // Saturday -> Monday
        searchFromDate = d.toISOString().split('T')[0];
        weekendRedirectDate = { from: originalDate, to: searchFromDate };
        weekendNote = true;
      }
    }

    // Cache Logic — Bug 2: always live-fetch when a specific date was requested
    const lockedEntry = conversationSlots.get(convId);
    let slots;

    if (userIsFlexible) {
      // Bug 6: flexible user — use global cache directly
      console.log('📦 Flexible user — using global slot cache directly');
      slots = globalSlotCache && globalSlotCache.length > 0
        ? globalSlotCache.filter(s => new Date(s.start) > new Date())
        : await getAvailableSlots(7, null);
    } else if (searchFromDate) {
      // Bug 2: always live-fetch for any specific date/range
      console.log('🔍 Live fetch for specific date:', searchFromDate);
      slots = await getAvailableSlots(daysWindow, searchFromDate);

      // Fallback: If no slots on that exact date/range, widen search to 7 days
      if (!slots || slots.length === 0) {
        console.log('🔍 No slots on requested date, widening search to 7 days');
        slots = await getAvailableSlots(7, searchFromDate);
      }
    } else {
      // Default — use global cache if available
      const validCached = lockedEntry ? lockedEntry.slots.filter(s => new Date(s.start) > new Date()) : [];
      if (validCached.length > 0) {
        slots = validCached;
      } else if (globalSlotCache && globalSlotCache.length > 0) {
        console.log('📦 Using global slot cache:', globalSlotCache.length, 'slots, age:', Math.round((Date.now() - globalSlotCacheUpdatedAt) / 1000), 'sec');
        slots = globalSlotCache.filter(s => new Date(s.start) > new Date());
      } else {
        console.log('🔍 Live fallback fetch (empty global cache)');
      }
      // Specific Time Detection
      let requestedTime = null;
      const timeMatch = lastUserMsg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
      if (timeMatch) {
        let hr = parseInt(timeMatch[1]);
        const min = parseInt(timeMatch[2] || "0");
        const ampm = timeMatch[3].toLowerCase();
        if (ampm === 'pm' && hr < 12) hr += 12;
        if (ampm === 'am' && hr === 12) hr = 0;

        // Round to nearest 30 mins
        let roundedMin = min < 15 ? 0 : (min < 45 ? 30 : 60);
        if (roundedMin === 60) {
          hr = (hr + 1) % 24;
          roundedMin = 0;
        }
        requestedTime = { hr, min: roundedMin };
        console.log(`⏰ Detected time: ${hr}:${String(roundedMin).padStart(2, '0')}`);
      }

      if (slots && slots.length > 0) {
        conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      }

      // If user asked for a specific time but no date was mentioned, use the most recently discussed date from cached slots
      if (requestedTime && !searchFromDate && lockedEntry && lockedEntry.slots && lockedEntry.slots.length > 0) {
        searchFromDate = lockedEntry.slots[0].start.split('T')[0];
        console.log(`📅 No date in message — using last discussed date: ${searchFromDate}`);
      }

      // If specific time requested, fetch full day slots so Claude has all alternatives
      if (requestedTime && searchFromDate) {
        console.log(`🔄 Specific time requested — fetching full day slots for ${searchFromDate}`);
        const fullDaySlots = await getAvailableSlots(1, searchFromDate, true);
        if (fullDaySlots && fullDaySlots.length > 0) {
          slots = fullDaySlots;
          conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
        }
      }

      // Live freebusy check for the exact requested time
      if (requestedTime && searchFromDate) {
        console.log(`🔍 Checking specific time: ${requestedTime.hr}:${requestedTime.min} on ${searchFromDate}`);
        const { hours: offsetHours } = getNYOffset(new Date(searchFromDate + "T12:00:00"));
        const slotStart = new Date(`${searchFromDate}T${String(requestedTime.hr).padStart(2, '0')}:${String(requestedTime.min).padStart(2, '0')}:00.000Z`);
        slotStart.setTime(slotStart.getTime() + offsetHours * 3600000);
        const slotEnd = new Date(slotStart.getTime() + 60 * 60000); // 1 hour check

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        try {
          const fbRes = await calendar.freebusy.query({
            requestBody: {
              timeMin: slotStart.toISOString(),
              timeMax: slotEnd.toISOString(),
              items: [{ id: 'primary' }],
            },
          });
          const isBusy = fbRes.data.calendars.primary.busy.length > 0;
          if (!isBusy) {
            console.log("✅ Specific slot is FREE, adding to top of slots");
            const weekdayStr = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(searchFromDate + "T12:00:00").getDay()];
            const monthStr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(searchFromDate + "T12:00:00").getMonth()];
            const dateDayStr = new Date(searchFromDate + "T12:00:00").getDate();
            let hour12 = requestedTime.hr % 12 || 12;
            const ampm = requestedTime.hr >= 12 ? 'PM' : 'AM';
            const label = `${weekdayStr}, ${monthStr} ${dateDayStr} at ${hour12}:${String(requestedTime.min).padStart(2, '0')} ${ampm} ${getNYOffset(new Date(searchFromDate + "T12:00:00")).abbr}`;

            const newSlot = { label, start: slotStart.toISOString(), end: new Date(slotStart.getTime() + 3600000).toISOString() };
            slots = [newSlot, ...(slots || []).filter(s => s.label !== label)].slice(0, 12);
          } else {
            console.log("❌ Specific slot is BUSY");
            slotsAlert += `\nNOTE: The requested time ${requestedTime.hr % 12 || 12}:${String(requestedTime.min).padStart(2, '0')} ${requestedTime.hr >= 12 ? 'PM' : 'AM'} was just checked and is BUSY. Tell the client it's taken and offer the alternatives below.`;
          }
        } catch (e) {
          console.error("Freebusy check failed:", e.message);
        }
      }

      // Refresh for "what else/any other"
      if (lastUserMsg.match(/what else|any other|more times|other slots/)) {
        console.log("🔄 'What else' detected - fetching full day");
        const fetchDate = searchFromDate || (slots && slots[0] ? slots[0].start.split('T')[0] : null);
        if (fetchDate) {
          const moreSlots = await getAvailableSlots(1, fetchDate);
          if (moreSlots && moreSlots.length > 0) {
            slots = [...(slots || []), ...moreSlots].filter((v, i, a) => a.findIndex(t => t.start === v.start) === i).slice(0, 12);
          }
        }
      }
    }

    // System Prompt Build
    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNamesDetailed = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const todayFormatted = `${dayNames[estDate.getDay()]}, ${monthNamesDetailed[estDate.getMonth()]} ${estDate.getDate()}, ${estDate.getFullYear()}`;
    const timeFormatted = `${estDate.getHours().toString().padStart(2, '0')}:${estDate.getMinutes().toString().padStart(2, '0')}`;

    const tomorrowDate = new Date(estDate);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowFormatted = `${dayNames[tomorrowDate.getDay()]}, ${monthNamesDetailed[tomorrowDate.getMonth()]} ${tomorrowDate.getDate()}`;

    let slotsAlert = "";
    if (userIsFlexible) {
      slotsAlert = "\nUSER IS FLEXIBLE: Show the next available slots immediately without asking for a date preference.";
    } else if (pastDateNote) {
      slotsAlert = "\nNOTE: Client asked for a past date. Tell them: 'That date has already passed — here are the next available times:'";
    } else if (slotsAlert === "" && searchFromDate && (!slots || slots.length === 0)) {
      slotsAlert = `\nNOTE: No availability found on the requested timeframe. Tell the client: 'I don't have any openings on that day — here are the closest available times:' then show alternatives below.`;
    } else if (weekendNote && weekendRedirectDate) {
      slotsAlert = `\nNOTE: The client asked for a weekend (${weekendRedirectDate.from}). Tell the client: 'We don't schedule on Sundays — here are the closest times starting Monday ${weekendRedirectDate.to}:'`;
    } else if (weekendNote) {
      slotsAlert = "\nNOTE: The client asked for a Sunday. Slots below are for the nearest available weekday instead. Tell the client: 'We don't schedule on Sundays — here are the closest available times:'";
    }

    const hasEmail = messages.some(m => m.role === 'user' && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(m.content));
    let slotsText;

    if (!hasEmail) {
      slotsText = "GATE: Do not show any available times yet. You must first collect the client's Full Name, Email, and Company. You have not collected their email yet.";
    } else if (!slots) {
      slotsText = "CALENDAR OFFLINE: Tell the client warmly: 'Our scheduling system is having a brief hiccup — no worries! Can I grab your email and I'll personally send you a few available times within the hour?' Then collect their email and preferred timeframe. End with: 'Perfect, I'll have Danny reach out shortly with available times.'";
    } else if (slots.length > 0) {
      slotsText = `AVAILABLE SLOTS:${slotsAlert}\n${slots.map((s, i) => `${i + 1}. ${s.label} [start:${s.start}]`).join('\n')}`;
    } else {
      slotsText = "CALENDAR UNAVAILABLE: Do NOT invent times. Tell the client: 'Let me check Danny's calendar — can I get your email so we can confirm a time?'";
    }

    const tzNote = clientTimezone
      ? `\n- When confirming a slot, tell the client: 'I've found a time at [Time] ${clientTimezone}. Should I send the invite to [Email]?'`
      : "";

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

TODAY IS: ${todayFormatted} | CURRENT TIME: ${timeFormatted} Eastern
Default: show slots starting TOMORROW (${tomorrowFormatted}) through the next 2 weeks.
NEVER show slots before tomorrow. NEVER show slots more than 30 days out unless user asked for a future date.
NEVER suggest or book any time that is in the past.
When referring to dates, never include the year. Say 'Saturday, April 26' not 'Saturday, April 26 2026'. Always calculate the correct day of week based on the actual calendar date.

PRIVACY: You have no knowledge of any internal email addresses or personal contact info for Danny or NeuralFlow staff. If a user provides any email, simply ask: 'Can you confirm that email is correct and belongs to you?' Never acknowledge any email as belonging to Danny or NeuralFlow.

CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2–3 qualifying questions to understand their business needs
3. Collect in order: Full Name → Email → Company name
   EMAIL VALIDATION: When the client gives you their email address, validate it before moving on. A valid email must contain exactly one @ symbol and at least one dot after the @. If the email looks wrong or is written out in plain language (e.g. 'john at gmail dot com'), say: 'Could you double-check that email address? I want to make sure your calendar invite reaches you.' Do not proceed to show slots or book until you have a valid email.
4. ONLY after collecting all three AND understanding their pain points — present available slots
5. When they confirm a slot — output the BOOK command immediately

SCHEDULING RULES:
- Use plain text only — no asterisks, no bold, no markdown.
- Copy slot labels EXACTLY character-for-character from the list below — no changes whatsoever
- Never reformat times. "10:00 AM - 11:00 AM ET" is wrong. "tomorrow" is wrong. Copy the label verbatim.
- If the client asks for a specific time NOT in the list, tell them you'll check Danny's calendar right now instead of saying he's booked. If it remains unavailable after checking, say: "That time's taken — here are 2 alternatives on the same day:" then list the alternatives.
- NEVER say "fully booked" or "no availability" for a date unless raw data confirms zero slots for the entire window requested.
- If a client says "what else do you have" or "any other times" on a day, show them more options for that date.
- When first showing availability for a day, show exactly 3 options: one morning (9-11AM), one afternoon (1-4PM), one evening (5-9PM). This keeps it clean and easy to choose.
- After listing the 3 slots, always end with: 'If none of these work, just tell me a different time or date and I'll check Danny's calendar.'
- If the client asks for a specific time or says "what else do you have", check and offer additional times beyond the initial 3.
- NEVER tell a client you don't have a date on the calendar or that you can't check a date. If no slots are available on a requested date, say: 'I don't have any openings on that day — here are the closest available times:' and show alternatives. Always show alternatives, never leave the client without options.
- Never invent or add slots that are not in the list${tzNote}
- BOOKING BUFFER: Never offer any slot less than 24 hours from now. If client asks for very soon, say: 'I want to make sure Danny has time to prepare — here are the next available times:'
- SCHEDULE HOURS: Available Monday through Sunday, 9AM to 9PM EST.
- CRITICAL: The time you tell the client IS the time that will be booked. Never confirm a time verbally and then output a different slotStart in the BOOK command. The slotStart must always be the [start:...] value from the exact slot you told the client about.
- When outputting the BOOK command, copy the [start:...] value from the chosen slot exactly into the slotStart field.
- CONFIRMATION REQUIRED: Before outputting the BOOK command, you must first send a confirmation message in this exact format:
'Just to confirm — I'm booking [exact slot label] for [Full Name] at [email address]. Shall I go ahead?'
Only output the BOOK command after the client explicitly confirms with yes, correct, go ahead, book it, or similar. Never book on an ambiguous reply.
- After confirming a booking, always say: 'You're all set for [exact slot label]. A calendar invite will be sent to [email] shortly — see you then!'

ON CONFIRMATION — output this immediately, no delays:
BOOK:{"slotStart":"ISO_FROM_SLOT_LIST","slotLabel":"EXACT label","name":"Full Name","email":"email@example.com","company":"Company Name","notes":"what they want | pain points"}
Then say: "Perfect! Booking that now — you'll get a calendar invite at [email] shortly!"

Keep replies to 2–3 sentences. Be warm and professional.
NEVER mention pricing, costs, or rates under any circumstances.

${slotsText}`;

    // AI Calls
    let aiReplyText = "";
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

    aiReplyText = aiReplyText.replace(/\*\*(.*?)\*\*/g, '$1');
    aiReplyText = aiReplyText.replace(/\*(.*?)\*/g, '$1');
    aiReplyText = aiReplyText.replace(/^#{1,6}\s+/gm, '');
    aiReplyText = aiReplyText.replace(/^\*\s+/gm, '- ');

    // Confirmation phrase tracking (FIX 1)
    const lowerReply = aiReplyText.toLowerCase();
    if (lowerReply.includes("just to confirm") || lowerReply.includes("i'm booking")) {
      const activeSlots = conversationSlots.get(convId)?.slots || slots || [];
      const matchedSlot = activeSlots.find(s => {
        const core = s.label.replace(/\s*\[start:[^\]]+\]/g, '').trim();
        return aiReplyText.includes(core);
      });
      if (matchedSlot) {
        agreedSlots.set(convId, matchedSlot);
        console.log(`📌 Agreed slot stored for ${convId}: ${matchedSlot.label}`);
      }
    }

    // Book command parser
    const bookMatch = aiReplyText.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch) {
      let bookData;
      try {
        bookData = JSON.parse(bookMatch[1]);
      } catch (e) {
        console.error('Failed to parse BOOK JSON:', e.message);
        return res.json({ reply: 'Sorry, I had trouble parsing that. Could you confirm the email again?', booked: false });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!bookData.email || !emailRegex.test(bookData.email)) {
        console.log('⚠️ Invalid email provided during booking:', bookData.email);
        const reply = "Could you double-check that email address? I want to make sure your calendar invite reaches you.";
        return res.json({ reply, booked: false });
      }

      const activeSlots = conversationSlots.get(convId)?.slots || slots || [];
      let slot = null;
      let matchMethod = '';

      // FIX 1: retrieve from agreedSlots map
      const agreedSlot = agreedSlots.get(convId);
      if (agreedSlot) {
        slot = agreedSlot;
        matchMethod = 'Agreed Slot Map';
        console.log(`📌 agreedSlot: ${slot.label} ${slot.start}`);
      } else {
        // Fallback for edge cases where confirmation wasn't caught
        slot = activeSlots.find(s => s.start === bookData.slotStart);
        if (slot) matchMethod = 'Exact ISO Fallback';
        if (!slot) {
          slot = activeSlots.find(s => s.label === bookData.slotLabel);
          if (slot) matchMethod = 'Exact Label Fallback';
        }
      }

      if (slot) {
        // Fresh fetch at booking
        const exactDate = slot.start.split('T')[0];
        const freshSlots = await getAvailableSlots(1, exactDate);
        const freshSlot = freshSlots ? freshSlots.find(s => s.label === slot.label) : null;

        if (!freshSlot) {
          conversationSlots.delete(convId);
          agreedSlots.delete(convId);
          const reply = "I apologize, but it looks like that specific time was just booked by someone else! Let me check what else is available around then.";
          aiReplyText = aiReplyText.replace(/BOOK:\{.*?\}/s, '').replace(/\[start:[^\]]+\]/g, '').trim();
          return res.json({ reply: reply + "\n" + aiReplyText, booked: false });
        }

        slot = freshSlot;

        console.log(`📌 Booking confirmed: ${slot.label} | method: ${matchMethod} (Fresh Confirmed)`);
        await bookAppointment({
          name: bookData.name, email: bookData.email, company: bookData.company,
          notes: bookData.notes, slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label
        });
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

app.listen(port, () => console.log(`Server running on ${port}`));
