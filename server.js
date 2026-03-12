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
const allowedOrigins = ['https://neuralflowai.io', 'https://www.neuralflowai.io'];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, Postman in dev)
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.get('/bookings', (req, res) => {
  const pass = process.env.BOOKINGS_PASSWORD || 'neuralflow2026';
  if (req.query.p !== pass) {
    return res.send(`<!DOCTYPE html><html><head><title>NeuralFlow Bookings</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#06060b;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}form{background:#13131a;padding:40px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);text-align:center}h2{color:#fff;margin:0 0 20px;font-size:20px}input{width:100%;padding:12px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#0a0a0f;color:#fff;font-size:14px;margin-bottom:12px}button{width:100%;padding:12px;background:#FF6B2B;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}</style></head><body><form method="GET"><h2>NeuralFlow Bookings</h2><input type="password" name="p" placeholder="Password" autofocus><button type="submit">View Bookings</button></form></body></html>`);
  }
  let bookings = [];
  try { bookings = JSON.parse(fs.readFileSync(BOOKINGS_LOG, 'utf8')); } catch {}
  bookings = bookings.slice().reverse(); // newest first
  const rows = bookings.map((b, i) => {
    const dt = b.slotLabel || b.slotStart || 'Unknown';
    const booked = b.bookedAt ? new Date(b.bookedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
      <td style="padding:14px 12px;color:#fff;font-weight:600">${b.name || '—'}</td>
      <td style="padding:14px 12px;color:#a0a0b0">${b.company || '—'}</td>
      <td style="padding:14px 12px"><a href="mailto:${b.email}" style="color:#FF6B2B;text-decoration:none">${b.email || '—'}</a></td>
      <td style="padding:14px 12px;color:#fff">${dt}</td>
      <td style="padding:14px 12px;color:#a0a0b0;font-size:12px">${booked}</td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html><html><head><title>NeuralFlow Bookings</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#06060b;font-family:-apple-system,sans-serif;color:#fff;padding:24px}h1{margin:0 0 4px;font-size:22px}p{margin:0 0 24px;color:#a0a0b0;font-size:14px}.card{background:#13131a;border-radius:12px;border:1px solid rgba(255,255,255,0.07);overflow:hidden}table{width:100%;border-collapse:collapse}th{padding:12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#FF6B2B;border-bottom:1px solid rgba(255,255,255,0.08)}td{font-size:13px}.empty{padding:40px;text-align:center;color:#a0a0b0}</style></head><body>
    <h1><span style="color:#fff">Neural</span><span style="color:#FF6B2B">Flow</span> Bookings</h1>
    <p>${bookings.length} booking${bookings.length !== 1 ? 's' : ''} total</p>
    <div class="card"><table>
      <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Session Time</th><th>Booked At</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">No bookings yet</td></tr>'}</tbody>
    </table></div>
    </body></html>`);
});

app.get('/api/test', async (req, res) => {
  const pass = process.env.BOOKINGS_PASSWORD || 'neuralflow2026';
  if (req.query.p !== pass) return res.status(401).json({ error: 'Unauthorized' });

  const results = {};

  // Test 1: Resend API
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'NeuralFlow AI <danny@neuralflowai.io>', to: process.env.GMAIL_USER, subject: '✅ ARIA E2E Test — Email Working', html: '<p>ARIA end-to-end test passed. Email delivery is working.</p>' })
    });
    results.email = r.ok ? '✅ OK' : `❌ Failed (${r.status})`;
  } catch (e) { results.email = `❌ Error: ${e.message}`; }

  // Test 2: Google Calendar (read-only — list next event)
  try {
    if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) {
      results.calendar = '⚠️ No Google token configured';
    } else {
      await oauth2Client.getAccessToken();
      const cal = google.calendar({ version: 'v3', auth: oauth2Client });
      await cal.events.list({ calendarId: 'primary', maxResults: 1, singleEvents: true, orderBy: 'startTime', timeMin: new Date().toISOString() });
      results.calendar = '✅ OK';
    }
  } catch (e) { results.calendar = `❌ Error: ${e.message}`; }

  // Test 3: Telegram
  try {
    const tgToken = process.env.TELEGRAM_BOT_TOKEN || '8354160885:AAHsmTw_qDhYsEf2Htd2qotMd1kPRm-okmw';
    const tgChat = process.env.TELEGRAM_CHAT_ID || '8709413106';
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChat, text: '✅ ARIA E2E test — Telegram working' })
    });
    results.telegram = r.ok ? '✅ OK' : `❌ Failed (${r.status})`;
  } catch (e) { results.telegram = `❌ Error: ${e.message}`; }

  // Test 4: Anthropic API
  try {
    const ping = await anthropic.messages.create({ model: 'claude-haiku-4-5', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] });
    results.anthropic = ping.content?.[0]?.text ? '✅ OK' : '❌ No response';
  } catch (e) { results.anthropic = `❌ Error: ${e.message}`; }

  const allOk = Object.values(results).every(v => v.startsWith('✅'));
  res.json({ status: allOk ? 'all systems go' : 'issues detected', results });
});

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
    if (val.storedAt < expiry) agreedSlots.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Pending Leads (abandoned chat follow-up) ────────────────────────────────
// Tracks conversations that collected an email but never booked
const pendingLeads = new Map(); // convId -> { email, name, lastSeen, followedUp }

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

// ─── Label from ISO — always derive display label from the actual booked time ──
// Never trust the slotLabel text ARIA writes; regenerate it from the ISO timestamp.
function labelFromSlotStart(isoStr) {
  const d = new Date(isoStr);
  const { hours: offsetHours, abbr } = getNYOffset(d);
  const nyTime = new Date(d.getTime() - offsetHours * 3600000);
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Use noon reference for correct day-of-week (matches getAvailableSlots logic)
  const noonRef = new Date(nyTime.getUTCFullYear(), nyTime.getUTCMonth(), nyTime.getUTCDate(), 12);
  let hr = nyTime.getUTCHours();
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  const min = String(nyTime.getUTCMinutes()).padStart(2, '0');
  return `${DAY_NAMES[noonRef.getDay()]}, ${MONTH_NAMES[nyTime.getUTCMonth()]} ${nyTime.getUTCDate()} at ${hr}:${min} ${ampm} ${abbr}`;
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

// ─── Pick one morning / afternoon / evening slot per day ─────────────────────
// Parses the hour from the slot label ("at 9:00 AM ET") so we don't fight UTC offsets
function pickDaySlots(allSlots) {
  if (!allSlots || allSlots.length === 0) return allSlots;
  const byDay = {};
  for (const s of allSlots) {
    const day = s.start.split('T')[0];
    if (!byDay[day]) byDay[day] = { morning: null, afternoon: null, evening: null };
    const m = s.label.match(/at (\d+):(\d+) (AM|PM)/i);
    if (!m) continue;
    let hr = parseInt(m[1]);
    if (m[3].toUpperCase() === 'PM' && hr < 12) hr += 12;
    if (m[3].toUpperCase() === 'AM' && hr === 12) hr = 0;
    if (hr >= 7  && hr < 12 && !byDay[day].morning)   byDay[day].morning   = s;
    if (hr >= 12 && hr < 17 && !byDay[day].afternoon) byDay[day].afternoon = s;
    if (hr >= 17            && !byDay[day].evening)   byDay[day].evening   = s;
  }
  return Object.values(byDay).flatMap(d => [d.morning, d.afternoon, d.evening].filter(Boolean));
}

// ─── Slot Fetching ────────────────────────────────────────────────────────────
async function getAvailableSlots(daysWindow = 14, startFromDate = null, allHours = false, maxSlots = null) {
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
    const now24h = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h buffer — system prompt enforces 24h rule

    const d = new Date(windowStart);
    d.setHours(0, 0, 0, 0);

    for (let i = 0; i <= daysWindow && slots.length < (maxSlots || 12); i++) {
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
      const maxTotal = maxSlots || (allHours ? 24 : 9);
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
async function bookAppointment({ name, email, company, phone, slotStart, slotEnd, slotLabel, notes }) {
  // Always regenerate the label from the ISO timestamp — ARIA's slotLabel text can be wrong
  slotLabel = labelFromSlotStart(slotStart);
  logBooking({ name, email, phone: phone || '', company, slotLabel, slotStart, notes });
  let meetLink = null;
  let eventHtmlLink = null;

  let summary = '';
  let painSummary = '';
  let teamTools = '';
  let pricingDetails = 'Implementation: $3,500\nMonthly: $750/mo\nROI: Estimated 8-12 hours/week saved — break even in ~3 months';
  let objections = '';
  let salesAngles = '';
  let nextSteps = '';
  let competitorIntel = '';

  if (notes) {
    try {
      const briefPrompt = `You are a B2B AI sales strategist for NeuralFlow, an AI consulting and automation company. Analyze this conversation between ARIA (our AI receptionist) and a prospective client. Write a complete sales brief Danny will read before the call.

CONVERSATION:
${notes}

Company: ${company || 'Unknown'}

Important: Make confident, specific estimates. Never write TBD. If info is missing, make reasonable B2B assumptions. Be direct and opinionated.

Reply in EXACTLY this format with no extra text:

SUMMARY:
[2-3 sentence polished summary of what this lead wants automated or improved. Be specific. Start with "They're looking to..."]

PAIN_POINTS:
[2-3 sentences on their biggest pain points and time sinks. Be specific to what they said. Start with "Their main challenge is..."]

TEAM_TOOLS:
Team: [size mentioned, or estimate based on company type — e.g. "5-15 person team (SMB)"]
Tools: [tools mentioned, or reasonable assumption — e.g. "Likely using Google Workspace, some CRM"]

PRICING:
Implementation: $X,XXX
Monthly: $XXX/mo
ROI: [Specific estimate: X hours/week saved × $Y/hr = $Z/mo — break even in N months]

OBJECTIONS:
- "[likely objection]" → "[sharp one-line rebuttal]"
- "[likely objection]" → "[sharp one-line rebuttal]"
- "[likely objection]" → "[sharp one-line rebuttal]"

SALES_ANGLES:
- [Specific hook tied to their pain point]
- [Concrete ROI example for their situation]
- [Urgency or competitive angle]

NEXT_STEPS:
- [Specific prep action for this lead's industry/use case]
- [Specific demo or talking point to prepare]
- Suggested close: [One tailored sentence to close this specific lead]

COMPETITOR_INTEL:
Industry: [their likely industry]
- [Relevant automation trend in their space]
- [What competitors are already doing]
- Urgency: "[Specific urgency statement for their industry]"`;

      const briefRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: briefPrompt }]
      });
      const raw = briefRes.content[0].text.trim();

      const summaryMatch    = raw.match(/SUMMARY:\n([\s\S]*?)(?:\n\nPAIN_POINTS:|$)/);
      const painMatch       = raw.match(/PAIN_POINTS:\n([\s\S]*?)(?:\n\nTEAM_TOOLS:|$)/);
      const teamMatch       = raw.match(/TEAM_TOOLS:\n([\s\S]*?)(?:\n\nPRICING:|$)/);
      const pricingMatch    = raw.match(/PRICING:\n([\s\S]*?)(?:\n\nOBJECTIONS:|$)/);
      const objectionsMatch = raw.match(/OBJECTIONS:\n([\s\S]*?)(?:\n\nSALES_ANGLES:|$)/);
      const salesMatch      = raw.match(/SALES_ANGLES:\n([\s\S]*?)(?:\n\nNEXT_STEPS:|$)/);
      const nextMatch       = raw.match(/NEXT_STEPS:\n([\s\S]*?)(?:\n\nCOMPETITOR_INTEL:|$)/);
      const compMatch       = raw.match(/COMPETITOR_INTEL:\n([\s\S]*?)$/);

      if (summaryMatch)    summary         = summaryMatch[1].trim();
      if (painMatch)       painSummary     = painMatch[1].trim();
      if (teamMatch)       teamTools       = teamMatch[1].trim();
      if (pricingMatch)    pricingDetails  = pricingMatch[1].trim();
      if (objectionsMatch) objections      = objectionsMatch[1].trim();
      if (salesMatch)      salesAngles     = salesMatch[1].trim();
      if (nextMatch)       nextSteps       = nextMatch[1].trim();
      if (compMatch)       competitorIntel = compMatch[1].trim();
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

  const leadNotes = summary || (notes ? notes.split('|')[0]?.trim() : '') || 'See conversation';
  const leadPain  = painSummary || (notes ? notes.split('|')[1]?.trim() : '') || 'See conversation';

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

    const structuredDesc = [
      `🧑 LEAD`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      `Company: ${company || 'Unknown'}`,
      ``,
      `🎯 WHAT THEY WANT`,
      leadNotes || 'Not captured',
      ``,
      `⚠️ PAIN POINTS`,
      leadPain || 'Not captured',
      teamTools ? `\n👥 TEAM & TOOLS\n${teamTools}` : '',
      ``,
      `💰 PRICING ESTIMATE`,
      pricingDetails,
      ``,
      salesAngles ? `🎯 SALES ANGLES\n${salesAngles}\n` : '',
      nextSteps ? `📋 PREP & NEXT STEPS\n${nextSteps}\n` : '',
      objections ? `⚡ LIKELY OBJECTIONS\n${objections}\n` : '',
      competitorIntel ? `🕵️ COMPETITIVE CONTEXT\n${competitorIntel}\n` : '',
      `🤖 Booked via ARIA | neuralflowai.io`
    ].filter(l => l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

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
            ${phone ? `<tr><td style="padding:6px 0;font-size:13px;color:${textMuted};">Phone</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#fff;">${phone}</td></tr>` : ''}
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

    ${sectionCard('🎯', 'What They Want', leadNotes || 'Not captured')}
    ${sectionCard('⚠️', 'Pain Points', leadPain || 'Not captured')}
    ${teamTools ? sectionCard('👥', 'Team & Current Tools', teamTools) : ''}
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

  // ── 24-Hour Follow-Up Email (scheduled) ──────────────────────────────────────
  try {
    const firstName = name.split(' ')[0];
    const followUpHtml = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><style>@media(prefers-color-scheme:light){body,table,td{background-color:#0a0a0f!important;color:#ffffff!important}}@media only screen and (max-width:600px){.email-container{width:100%!important}}</style><title>See you tomorrow</title></head>
<body style="margin:0;padding:0;background:#06060b;font-family:${ff};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060b;padding:32px 16px;">
  <tr><td align="center">
  <table class="email-container" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">

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

    <!-- BODY -->
    <tr><td style="background:${bg};padding:48px 40px 36px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">✦ See You Tomorrow</div>
      <h1 style="margin:0 0 20px;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;line-height:1.2;">Quick note ahead<br>of our call, ${firstName}.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#a0a0b0;line-height:1.7;">Hey ${firstName}, just a quick note ahead of our call tomorrow. Danny is looking forward to it and wanted to share what he'll be covering.</p>

      <!-- AGENDA CARD -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${accent};margin-bottom:28px;">
        <tr><td style="background:${bgCard};padding:24px 28px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">Here's what Danny will cover:</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:7px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:${accent};margin-right:10px;">→</span>Your specific automation opportunities
            </td></tr>
            <tr><td style="padding:7px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:${accent};margin-right:10px;">→</span>A custom implementation roadmap for your business
            </td></tr>
            <tr><td style="padding:7px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:${accent};margin-right:10px;">→</span>ROI projections and timeline
            </td></tr>
            <tr><td style="padding:7px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:${accent};margin-right:10px;">→</span>Any questions you have about NeuralFlow's process
            </td></tr>
          </table>
        </td></tr>
      </table>

      <!-- PREP NOTE -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);margin-bottom:32px;">
        <tr><td style="background:${bgCard};padding:24px 28px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#a0a0b0;margin-bottom:12px;">A few things that would help Danny prepare</div>
          <p style="margin:0 0 10px;font-size:14px;color:#a0a0b0;line-height:1.7;">Feel free to reply with any context on:</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:5px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:#a0a0b0;margin-right:8px;">•</span>Your current tools / software stack
            </td></tr>
            <tr><td style="padding:5px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:#a0a0b0;margin-right:8px;">•</span>Your team size
            </td></tr>
            <tr><td style="padding:5px 0;font-size:14px;color:#ffffff;line-height:1.5;">
              <span style="color:#a0a0b0;margin-right:8px;">•</span>Your biggest operational bottleneck
            </td></tr>
          </table>
        </td></tr>
      </table>

      <!-- CTA -->
      <table cellpadding="0" cellspacing="0">
        <tr><td>
          <a href="https://neuralflowai.io" style="display:inline-block;background:${accent};color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;letter-spacing:0.3px;">View Your Booking Confirmation →</a>
        </td></tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:${bg};padding:28px 40px;border-top:1px solid rgba(255,255,255,0.06);">
      <p style="margin:0 0 8px;font-size:14px;color:#a0a0b0;line-height:1.6;">See you tomorrow,<br><strong style="color:#fff;">— ARIA, NeuralFlow AI Receptionist</strong></p>
      <a href="https://neuralflowai.io" style="font-size:12px;font-weight:700;color:${accent};text-decoration:none;">neuralflowai.io</a>
      <p style="margin:8px 0 0;font-size:11px;color:rgba(160,160,176,0.4);">© 2026 NeuralFlow AI. All rights reserved.</p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;

    const followUpRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ARIA <aria@neuralflowai.io>',
        to: email,
        subject: `Looking forward to our call tomorrow, ${firstName}!`,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        html: followUpHtml
      })
    });
    const followUpData = await followUpRes.json();
    if (followUpRes.ok) {
      console.log(`✅ 24h follow-up email scheduled (Resend id: ${followUpData.id})`);
    } else {
      console.error('⚠️ 24h follow-up email scheduling failed:', followUpData.message || JSON.stringify(followUpData));
    }
  } catch (e) {
    console.error('⚠️ 24h follow-up email error (non-fatal):', e.message);
  }
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
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });
    if (messages.length > 60) return res.status(400).json({ error: 'Conversation too long' });
    for (const m of messages) {
      if (!m || typeof m.content !== 'string' || m.content.length > 4000) {
        return res.status(400).json({ error: 'Invalid message format' });
      }
    }
    const convId = (typeof conversationId === 'string' ? conversationId : 'default').slice(0, 100);

    const lastUserMsgRaw = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const lastUserMsg = lastUserMsgRaw.toLowerCase();

    // ── DIRECT BOOKING: detect user confirming a stored booking ──────────────
    // This runs before Claude — so if the user says any form of "yes", we book
    // immediately without depending on Claude outputting a BOOK command.
    const YES_REGEX = /^\s*(yes|yep|yup|yeah|sure|ok|okay|correct|perfect|great|absolutely|definitely|for sure|sounds good|that works|looks good|go ahead|book it|do it|lock it in|lock that in|confirmed|please|yes please|please do|please book|book that|let'?s do it|make it happen|i confirm|confirmed|book me in|set it up|done|go for it|100|👍)\s*[.!]*\s*$/i;
    const agreedEntry = agreedSlots.get(convId);
    if (agreedEntry?.slot && agreedEntry?.email && YES_REGEX.test(lastUserMsgRaw.trim()) && Date.now() - agreedEntry.storedAt < 15 * 60 * 1000) {
      const { slot, name, email, company, notes } = agreedEntry;
      console.log(`🔒 Direct booking — bypassing Claude for ${convId}: ${slot.label} | ${name} | ${email}`);
      bookAppointment({ name, email, phone: agreedEntry.phone || '', company: company || '', notes: notes || '', slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label })
        .catch(err => console.error('Direct booking error:', err.message));
      conversationSlots.delete(convId);
      agreedSlots.delete(convId);
      pendingLeads.delete(convId);
      const confirmLabel = labelFromSlotStart(slot.start);
      return res.json({ reply: `You're all set! A calendar invite will be sent to ${email} shortly. We're looking forward to speaking with you on ${confirmLabel}. See you then!`, booked: true });
    }

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
    let isNextWeek = false;
    let isMonthRange = false;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const wMatch = lastUserMsg.match(/\bin\s+(\d+)\s+weeks?\b/);
    const mMatch = lastUserMsg.match(/\bin\s+(\d+)\s+months?\b/);

    if (lastUserMsg.match(/\btomorrow\b|\bnext day\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 1);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 1;
    } else if (lastUserMsg.match(/\bend of (the )?month\b/)) {
      const d = new Date();
      const target = new Date(d.getFullYear(), d.getMonth(), 20);
      if (d.getDate() >= 20) target.setMonth(target.getMonth() + 1);
      searchFromDate = target.toISOString().split('T')[0]; daysWindow = 10;
    } else if (lastUserMsg.match(/\bnext week\b|\bfollowing week\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7; isNextWeek = true;
    } else if (lastUserMsg.match(/\bcouple weeks?\b|\bfew weeks?\b/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (wMatch) {
      const d = new Date(); d.setDate(d.getDate() + parseInt(wMatch[1]) * 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/\bnext month\b/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14; isMonthRange = true;
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
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14; isMonthRange = true;
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
      if (isNextWeek) {
        console.log('🔍 Live fetch next week:', searchFromDate);
        slots = await getAvailableSlots(7, searchFromDate, false, 18);
      } else if (isMonthRange) {
        console.log('🔍 Live fetch month range:', searchFromDate);
        slots = await getAvailableSlots(14, searchFromDate, false, 42);
      } else {
        // Fetch ALL available hours for exactly that one day (daysWindow=0 = single iteration)
        console.log('🔍 Live fetch single day (allHours):', searchFromDate);
        slots = await getAvailableSlots(0, searchFromDate, true);
        if (!slots || slots.length === 0) {
          // Nothing on that exact day — widen search across multiple days
          console.log('🔍 No slots on', searchFromDate, '— widening to 7 days');
          slots = await getAvailableSlots(7, searchFromDate);
        }
      }
      if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    } else if (requestedTime) {
      // Time-only: reuse stored slots for the established date — no re-fetch needed
      // We already fetched all available hours for that date
      const prior = conversationSlots.get(convId);
      const validStored = prior?.slots?.filter(s => new Date(s.start) > new Date()) || [];
      if (validStored.length > 0) {
        slots = validStored;
        searchFromDate = slots[0].start.split('T')[0];
        console.log('⏰ Time-only — reusing stored slots for', searchFromDate);
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

    // ── 6. Specific time check — always freebusy, token-refreshed ───────────────
    let freebusyNote = '';
    let confirmedFreeSlot = null;
    if (requestedTime) {
      // Get best available date context
      const dateToCheck = searchFromDate
        || conversationSlots.get(convId)?.slots?.find(s => new Date(s.start) > new Date())?.start.split('T')[0];

      const hour12 = requestedTime.hr % 12 || 12;
      const ampm   = requestedTime.hr >= 12 ? 'PM' : 'AM';
      const minStr = String(requestedTime.min).padStart(2, '0');

      if (dateToCheck) {
        try {
          // Always refresh token before freebusy — stored-slot path skips getAvailableSlots
          if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000) {
            const r = await oauth2Client.getAccessToken().catch(() => null);
            if (r?.token) { cachedAccessToken = r.token; tokenExpiresAt = r.res?.data?.expiry_date || (Date.now() + 3500000); }
          }

          const { hours: offsetHours, abbr } = getNYOffset(new Date(dateToCheck + 'T12:00:00'));
          const utcHr = requestedTime.hr + offsetHours;
          const slotStart = new Date(`${dateToCheck}T${String(utcHr % 24).padStart(2,'0')}:${minStr}:00.000Z`);
          const slotEnd   = new Date(slotStart.getTime() + 3600000);

          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          const fbRes = await calendar.freebusy.query({
            requestBody: { timeMin: slotStart.toISOString(), timeMax: slotEnd.toISOString(), items: [{ id: 'primary' }] }
          });
          const isBusy = fbRes.data.calendars.primary.busy.length > 0;

          if (!isBusy) {
            const d = new Date(dateToCheck + 'T12:00:00');
            const weekdayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
            const monthStr   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            const label = `${weekdayStr}, ${monthStr} ${d.getDate()} at ${hour12}:${minStr} ${ampm} ${abbr}`;
            const newSlot = { label, start: slotStart.toISOString(), end: slotEnd.toISOString() };
            slots = [newSlot, ...(slots||[]).filter(s => s.label !== label)].slice(0, 12);
            conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
            confirmedFreeSlot = newSlot;
            freebusyNote = `The client asked for ${hour12}:${minStr} ${ampm}. Just checked Google Calendar — it IS available. Your ENTIRE response must be exactly: "I just checked — ${hour12}:${minStr} ${ampm} is available on ${label.split(' at ')[0]}! Want me to lock that in?" Nothing else. No other slots.`;
            console.log('✅ Freebusy: free —', label);
          } else {
            freebusyNote = `CLIENT REQUESTED: ${hour12}:${minStr} ${ampm} — Google Calendar shows this time is TAKEN. Tell the client that time is not available and offer 2-3 alternatives from the same day listed below.`;
            console.log('❌ Freebusy: busy —', dateToCheck, hour12, ampm);
          }
        } catch (e) {
          console.error('Freebusy check failed:', e.message);
          // Don't let ARIA say "not available" on an API error — stay neutral
          freebusyNote = `The client requested ${hour12}:${minStr} ${ampm}. The calendar check had a momentary issue. Tell them: "I want to make sure that time works — could you also confirm which date you had in mind so I can lock it in?" Do NOT say the time is unavailable.`;
        }
      }
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
      if (isNextWeek && slots && slots.length > 0) {
        slotsAlert += `\nNEXT WEEK VIEW: Show ALL available days from the list below, each on its own line grouped by date with all available times. Do NOT limit to 3 slots or a single day.`;
      }
      if (isMonthRange && slots && slots.length > 0) {
        slotsAlert += `\nMONTH VIEW: Show ALL available days from the list below, each on its own line grouped by date with all available times. Do NOT ask the client to specify a date — just show them what is available.`;
      }
    }
    // freebusyNote is injected as a top-level override in the system prompt (see below)

    const hasEmail = messages.some(m => m.role === 'user' && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(m.content));
    const isETTimezone = !clientTimezone || /^America\/(New_York|Indiana|Detroit|Kentucky|Louisville|Toronto|Montreal|Ottawa)/.test(clientTimezone);

    // Track pending leads for abandoned chat follow-up + Telegram alert on first email capture
    if (hasEmail) {
      const emailMatch = [...messages].reverse()
        .find(m => m.role === 'user' && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(m.content));
      const detectedEmail = emailMatch?.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0];
      if (detectedEmail) {
        const existing = pendingLeads.get(convId) || {};
        // Fire Telegram alert the first time we see an email for this conversation
        if (!existing.email) {
          sendTelegramAlert(`👀 ARIA LEAD\n${detectedEmail} is talking to ARIA right now`);
        }
        pendingLeads.set(convId, { ...existing, email: detectedEmail, lastSeen: Date.now(), followedUp: existing.followedUp || false });
      }
    }

    // Determine which slots to show Claude
    // For specific date requests, limit to one morning/afternoon/evening per day
    // so Claude always gets exactly 3 options (not a wall of 12 times)
    const wantsMoreOptions = lastUserMsg.match(/\bwhat else\b|\bany other\b|\bmore times\b|\bother slots\b/);
    const slotsForDisplay = (searchFromDate && !wantsMoreOptions && !confirmedFreeSlot && !isNextWeek && !isMonthRange)
      ? pickDaySlots(slots)
      : slots;

    // Sort slots chronologically and group by day
    let slotsText;
    if (!hasEmail) {
      slotsText = "GATE: Do not show available times yet. Collect Full Name, Email, and Company first.";
    } else if (!slotsForDisplay || slotsForDisplay.length === 0) {
      slotsText = slots === null
        ? "CALENDAR OFFLINE: Say: 'Our scheduling system has a brief hiccup — can I grab your email and I'll personally send you a few available times within the hour?'"
        : `NO SLOTS FOUND.${slotsAlert ? slotsAlert : " Ask the client for a different date."}`;
    } else {
      // Always sort chronologically before displaying
      const sorted = [...slotsForDisplay].sort((a, b) => new Date(a.start) - new Date(b.start));

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

    // When a specific time is confirmed free, replace slot list with ONLY that slot
    // so Claude cannot fall back to showing the general list
    if (confirmedFreeSlot) {
      slotsText = `CONFIRMED AVAILABLE:\n1. ${confirmedFreeSlot.label} [start:${confirmedFreeSlot.start}]`;
    }

    const timeOverride = freebusyNote
      ? `\n⚠️ PRIORITY OVERRIDE — SPECIFIC TIME REQUESTED:\n${freebusyNote}\nThis overrides all other slot display rules for this response. Do NOT show 3 slots. Respond ONLY to the requested time as instructed above.\n`
      : '';

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company. Website: neuralflowai.io.
${timeOverride}
RIGHT NOW: ${todayFormatted}, ${timeFormatted} Eastern Time
You must always use this date and time when reasoning about scheduling. Never guess or assume what day or month it is — it is ${todayFormatted}. Tomorrow is ${tomorrowFormatted}.

PRIVACY RULE — CRITICAL: You have no knowledge of who works at NeuralFlow, who the founder is, or what any internal email addresses are. When a user provides an email, you know nothing about whose email it is — it is simply the user's email for their calendar invite. Never say "that might be [anyone's] email", never suggest an email belongs to a specific person, never connect an email to a name you might know. Just validate format only.

CONVERSATION FLOW — follow this exact order:
1. Greet warmly, ask what brings them to NeuralFlow today
2. Ask qualifying questions naturally across the conversation to understand:
   - What they want automated or improved
   - What's their biggest time sink or pain point
   - How big is their team (just a rough sense — "a few people", "10-person team", etc.)
   - What tools or software they currently use (CRM, booking system, etc.)
   Weave these into the conversation naturally — don't fire them all at once.
3. Collect in this order: Full Name → Email → Company name → Phone number
   EMAIL VALIDATION: A valid email has exactly one @ and a dot after it. If the format looks wrong, say: "Could you double-check that email? I want to make sure your invite reaches you." Do not proceed until you have a valid email.
   PHONE: After getting a valid email, ask: "And what's the best phone number to reach you?" Accept any format. It's optional — if they say they'd rather not, move on.
4. Once you have name, email, company, and a good understanding of their needs — present available slots
5. When they confirm a slot — output the BOOK command

HOW TO PRESENT SLOTS:
The slot list below is grouped by day in chronological order. Always work forward in time — never offer a slot on an earlier date after offering a later one.

When showing slots for the first time (or when a client picks a day but hasn't chosen a time):
- Show exactly 3 times from that day — one morning, one afternoon, one evening
- All 3 must be from the same day
- End with: "If none of these work, just tell me any time that works and I'll check Danny's calendar."

When the client asks for a SPECIFIC TIME (e.g. "how about 3pm", "can we do 2:30", "what about 4pm"):
- The server has already checked Google Calendar for that exact time. Read the CLIENT REQUESTED TIME note in the slot data carefully.
- If the note says the time IS available: respond immediately with "I just checked — [time] is available! Want me to lock that in?" Use the exact slot label from the list. Do NOT show other slots.
- If the note says the time is BUSY: tell the client that time is taken and offer 2-3 alternatives from the same day.
- Never ignore a specific time request and fall back to showing the original 3 options.

When the client asks for a specific date or time range (e.g. "next week", "March 20th", "how about Tuesday"):
- Show 3 times from the earliest available day within that range (one morning, one afternoon, one evening from the same day)

When the client asks for more options on the same day ("what else do you have", "any other times"):
- Show the remaining available times for that day from the list

SCHEDULING RULES:
- Plain text only — no asterisks, no bold, no markdown, no bullet symbols
- Copy slot labels EXACTLY character-for-character from the list — never reformat or paraphrase
- Never offer a slot less than 24 hours from now (today is ${todayFormatted})
- Never invent slots that aren't in the list
- Never include the year when stating dates (say "Tuesday, April 15" not "Tuesday, April 15, 2026")
- The slotStart in the BOOK command must always match the [start:ISO] from the exact slot you confirmed

AVAILABILITY: You MUST ONLY tell a client a time/date is unavailable if the server has explicitly told you it is BUSY in the slot data. If you have no data for a requested time, do NOT assume it is unavailable — say you will check and ask the client to confirm the date so the server can verify. Never make up availability.
NEXT WEEK: When a client asks for "next week", show ALL available days that week grouped by date. List each day on its own line with all available times. Do not limit to 3 slots or a single day.

CONFIRMATION FLOW:
Before booking, send exactly:
"Just to confirm — I'm booking [exact slot label] for [Full Name] at [email]. Shall I go ahead?"
Accept any clear yes: yes, correct, go ahead, book it, sounds good, perfect, that works, great, sure, absolutely, confirmed, do it, let's do it, looks good, yep, yup.
Never book on an ambiguous reply.

ON CONFIRMATION — output immediately:
BOOK:{"slotStart":"ISO_FROM_SLOT_LIST","slotLabel":"EXACT label","name":"Full Name","email":"email@example.com","company":"Company","phone":"phone number or empty string","notes":"what they want automated | pain points | team size | current tools"}
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

    // Track confirmation phrase — store slot + full booking data so server can book directly on yes
    const lowerReply = aiReplyText.toLowerCase();
    if (lowerReply.includes('just to confirm') || lowerReply.includes("i'm booking")) {
      const activeSlots = conversationSlots.get(convId)?.slots || slots || [];
      const matchedSlot = activeSlots.find(s => {
        const core = s.label.replace(/\s*\[start:[^\]]+\]/g, '').replace(/\s*\/\s*\d{1,2}:\d{2}\s*(AM|PM)\s+\w+\s+your time/i, '').trim();
        return aiReplyText.includes(core);
      });
      if (matchedSlot) {
        // Extract name + email from "I'm booking [slot] for [Name] at [email]"
        const nameEmailMatch = aiReplyText.match(/for\s+([A-Za-z][A-Za-z '\-]{1,40}?)\s+at\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
        let confirmedName = nameEmailMatch?.[1]?.trim() || '';
        let confirmedEmail = nameEmailMatch?.[2]?.trim() || '';

        // Fallback: scan conversation for email if not found in confirmation message
        if (!confirmedEmail) {
          for (const m of [...messages].reverse()) {
            const em = m.content.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
            if (em) { confirmedEmail = em[0]; break; }
          }
        }
        // Fallback: scan user messages for name patterns
        if (!confirmedName) {
          for (const m of messages) {
            if (m.role === 'user') {
              const nm = m.content.match(/(?:i'?m|my name is|this is|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
              if (nm) { confirmedName = nm[1]; break; }
            }
          }
        }

        // Extract company — scan all assistant messages for it
        let confirmedCompany = '';
        for (const m of [...messages].reverse()) {
          if (m.role === 'assistant') {
            const compMatch = m.content.match(/(?:from|at|with|company[:\s]+)([A-Z][A-Za-z0-9 &,.\-]{1,40}?)(?:\s*[,!?\n]|$)/);
            if (compMatch && !compMatch[1].match(/^(NeuralFlow|ARIA|our|the|your|my)\b/i)) {
              confirmedCompany = compMatch[1].trim();
              break;
            }
          }
        }

        // Build full conversation transcript for the AI sales brief
        const userMsgs = messages.slice(-30).map(m => `${m.role === 'user' ? 'CLIENT' : 'ARIA'}: ${m.content}`).join('\n').slice(0, 2000);

        // Extract phone from conversation
        let confirmedPhone = '';
        for (const m of [...messages].reverse()) {
          if (m.role === 'user') {
            const ph = m.content.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
            if (ph) { confirmedPhone = ph[0]; break; }
          }
        }
        agreedSlots.set(convId, { slot: matchedSlot, storedAt: Date.now(), name: confirmedName, email: confirmedEmail, phone: confirmedPhone, company: confirmedCompany, notes: userMsgs });
        console.log(`📌 Agreed slot stored: ${matchedSlot.label} | name="${confirmedName}" email="${confirmedEmail}" company="${confirmedCompany}"`);
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
        // Skip for Agreed Slot Map — user confirmed it and we already did freebusy check
        if (freshSlots && freshSlots.length > 0 && !freshSlot && matchMethod !== 'Direct BOOK Fallback' && matchMethod !== 'Agreed Slot Map') {
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
          phone: bookData.phone || '', notes: bookData.notes, slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label
        }).catch(err => console.error('Background booking error:', err.message));
        conversationSlots.delete(convId);
        agreedSlots.delete(convId);
        pendingLeads.delete(convId); // booked — no follow-up needed
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

// ─── Reminder Email Sender ────────────────────────────────────────────────────
async function sendReminderEmail(booking, type) {
  const { name, email, slotLabel, slotStart } = booking;
  const firstName = name.split(' ')[0];
  const isOneHour = type === '1h';
  const subject = isOneHour
    ? `Your NeuralFlow call starts in 1 hour — ${slotLabel}`
    : `Reminder: Your NeuralFlow consultation is tomorrow — ${slotLabel}`;

  const bg = '#0a0a0f', bgCard = '#13131a', accent = '#FF6B2B', textMuted = '#a0a0b0';
  const ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reminder</title></head>
<body style="margin:0;padding:0;background:#06060b;font-family:${ff};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060b;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
    <tr><td style="background:${bg};padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;">
        <span style="color:#fff;">Neural</span><span style="color:${accent};">Flow</span>
      </div>
      <div style="margin-top:6px;padding-left:10px;border-left:2px solid ${accent};font-size:10px;font-weight:700;letter-spacing:2px;color:${accent};text-transform:uppercase;">AI Consulting &amp; Automation</div>
    </td></tr>
    <tr><td style="background:${bg};padding:40px 40px 32px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${accent};margin-bottom:14px;">
        ${isOneHour ? '⏰ Starting Soon' : '📅 Tomorrow'}
      </div>
      <h1 style="margin:0 0 14px;font-size:26px;font-weight:800;color:#fff;line-height:1.2;">
        ${isOneHour ? 'Your call starts in 1 hour' : 'Your consultation is tomorrow'}
      </h1>
      <p style="margin:0;font-size:16px;color:${textMuted};line-height:1.6;">
        Hi <strong style="color:#fff;">${firstName}</strong>, just a heads-up — your strategy session with Danny Boehmer is coming up ${isOneHour ? 'very soon' : 'tomorrow'}.
      </p>
    </td></tr>
    <tr><td style="background:${bgCard};padding:0 40px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${accent};">
        <tr><td style="padding:20px 24px;">
          <span style="font-size:13px;color:${textMuted};">📅 When</span><br>
          <span style="font-size:16px;font-weight:700;color:#fff;">${slotLabel}</span>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="background:${bgCard};padding:0 40px 40px;">
      <p style="margin:0;font-size:14px;color:${textMuted};">Check your original confirmation email for the Google Meet link. See you ${isOneHour ? 'soon' : 'tomorrow'}!</p>
      <br>
      <p style="margin:0;font-size:13px;color:${textMuted};">— Danny Boehmer<br>Founder, NeuralFlow AI</p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;

  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'NeuralFlow AI <danny@neuralflowai.io>', to: email, subject, html })
      });
      if (r.ok) { console.log(`✅ ${type} reminder sent to ${email}`); return; }
      throw new Error((await r.json()).message);
    } catch (e) {
      console.error(`❌ ${type} reminder attempt ${i + 1} failed:`, e.message);
      if (i < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  sendTelegramAlert(`🚨 REMINDER EMAIL FAILED\n${type} reminder to ${email} (${name}) for ${slotLabel}`);
}

// ─── Reminder Scheduler (runs every 5 min) ────────────────────────────────────
setInterval(async () => { try {
  if (!fs.existsSync(BOOKINGS_LOG)) return;
  let bookings;
  try { bookings = JSON.parse(fs.readFileSync(BOOKINGS_LOG, 'utf8')); } catch { return; }

  const now = Date.now();
  const WINDOW = 6 * 60 * 1000; // ±6 min window
  let updated = false;

  for (const booking of bookings) {
    if (!booking.email || !booking.slotStart) continue;
    const timeUntil = new Date(booking.slotStart).getTime() - now;
    if (timeUntil < 0) continue; // past

    if (!booking.reminded24h && Math.abs(timeUntil - 24 * 3600000) < WINDOW) {
      await sendReminderEmail(booking, '24h');
      booking.reminded24h = true; updated = true;
    }
    if (!booking.reminded1h && Math.abs(timeUntil - 3600000) < WINDOW) {
      await sendReminderEmail(booking, '1h');
      booking.reminded1h = true; updated = true;
    }
  }
  if (updated) {
    try { fs.writeFileSync(BOOKINGS_LOG, JSON.stringify(bookings, null, 2)); } catch (e) {
      console.error('⚠️ Failed to update bookings log after reminder:', e.message);
    }
  }
} catch (e) { console.error('⚠️ Reminder scheduler error:', e.message); }
}, 5 * 60 * 1000);

// ─── Abandoned Chat Follow-up (runs every 15 min) ─────────────────────────────
setInterval(async () => { try {
  const now = Date.now();
  for (const [convId, lead] of pendingLeads.entries()) {
    const idle = now - lead.lastSeen;
    // Clean up very stale entries (> 7 days)
    if (idle > 7 * 24 * 3600000) { pendingLeads.delete(convId); continue; }
    // Follow up if idle > 1 hour, < 48 hours, not yet followed up, has email
    if (!lead.followedUp && lead.email && idle > 3600000 && idle < 48 * 3600000) {
      const firstName = (lead.name || '').split(' ')[0] || 'there';
      const subject = `Still looking for a time, ${firstName}?`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#06060b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060b;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
    <tr><td style="background:#0a0a0f;padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:28px;font-weight:800;"><span style="color:#fff;">Neural</span><span style="color:#FF6B2B;">Flow</span></div>
      <div style="margin-top:6px;padding-left:10px;border-left:2px solid #FF6B2B;font-size:10px;font-weight:700;letter-spacing:2px;color:#FF6B2B;text-transform:uppercase;">AI Consulting &amp; Automation</div>
    </td></tr>
    <tr><td style="background:#0a0a0f;padding:40px;">
      <p style="margin:0 0 16px;font-size:16px;color:#fff;">Hey ${firstName},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#a0a0b0;line-height:1.6;">I noticed you were checking out our consultation booking but didn't get a time locked in — totally fine, life gets busy!</p>
      <p style="margin:0 0 24px;font-size:15px;color:#a0a0b0;line-height:1.6;">If you're still interested in exploring how NeuralFlow can automate the repetitive parts of your business, I'd love to find a time that works for you.</p>
      <a href="https://neuralflowai.io" style="display:inline-block;background:#FF6B2B;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Book a Free Consultation →</a>
      <p style="margin:24px 0 0;font-size:13px;color:#a0a0b0;">— Danny Boehmer<br>Founder, NeuralFlow AI</p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Danny @ NeuralFlow <danny@neuralflowai.io>', to: lead.email, subject, html })
        });
        if (r.ok) {
          console.log(`📧 Abandoned chat follow-up sent to ${lead.email}`);
          lead.followedUp = true;
        } else {
          console.error('❌ Follow-up email failed:', (await r.json()).message);
        }
      } catch (e) { console.error('❌ Follow-up email error:', e.message); }
    }
  }
} catch (e) { console.error('⚠️ Follow-up scheduler error:', e.message); }
}, 15 * 60 * 1000);

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
