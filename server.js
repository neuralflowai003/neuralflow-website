require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 8080;

// Conversation slot store — locks slots the moment they are shown to a user
// Key: conversationId (sent from frontend), Value: { slots, fetchedAt }
const conversationSlots = new Map();
// Clean up old conversations after 30 minutes
setInterval(() => {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < thirtyMinAgo) conversationSlots.delete(key);
  }
}, 10 * 60 * 1000);



// ─── Anthropic ───────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Google OAuth2 ───────────────────────────────────────────────────────────
const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uri = process.env.NODE_ENV === 'production'
  ? 'https://neuralflow-api.up.railway.app/oauth/callback'
  : 'http://localhost:3000/oauth/callback';

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

// Load credentials — from env var (production) or local file (development)
const TOKEN_PATH = path.join(__dirname, 'google-token.json');
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  // Pre-warm the access token so first calendar call doesn't block
  oauth2Client.getAccessToken().then(() => console.log('✅ Google Calendar connected + token pre-warmed')).catch(e => console.log('⚠️ Calendar pre-warm failed:', e.message));
} else if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oauth2Client.setCredentials(token);
  console.log('✅ Google Calendar connected (local file)');
} else {
  console.log('⚠️  Google Calendar not authorized yet — visit /oauth/start');
}

// ─── Resend Email ─────────────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder');
async function sendEmail({ from, to, subject, html }) {
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new Error(error.message);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── OAuth Flow ───────────────────────────────────────────────────────────────
app.get('/oauth/start', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Google Calendar authorized! Refresh token:', tokens.refresh_token);
    res.send('<h2>✅ Google Calendar connected! You can close this tab.</h2><script>setTimeout(()=>window.close(),2000)</script>');
  } catch (e) {
    res.status(500).send('Auth failed: ' + e.message);
  }
});

// ─── Get Availability ────────────────────────────────────────────────────────
async function getAvailableSlots(daysWindow = 7, startFromDate = null) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) return null;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = startFromDate ? new Date(startFromDate) : new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + daysWindow);

    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: 'primary' }],
      },
    });

    const busy = freeBusy.data.calendars.primary.busy || [];

    const slots = [];
    const d = startFromDate ? new Date(startFromDate) : new Date();
    d.setHours(0, 0, 0, 0);

    for (let i = startFromDate ? 0 : 1; i <= daysWindow && slots.length < 6; i++) {
      const day = new Date(d);
      day.setDate(day.getDate() + i);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue;

      const hours = [9, 10, 11, 13, 14, 15, 16];
      for (const h of hours) {
        const year = day.getFullYear();
        const dstStart = new Date(Date.UTC(year, 2, 8));
        dstStart.setUTCDate(8 + (7 - dstStart.getUTCDay()) % 7);
        const dstEnd = new Date(Date.UTC(year, 10, 1));
        dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7);
        const isDST = day >= dstStart && day < dstEnd;
        const nyOffsetHours = isDST ? 4 : 5;

        const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const slotStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:00:00.000Z`);
        slotStart.setTime(slotStart.getTime() + nyOffsetHours * 3600000);
        const slotEnd = new Date(slotStart.getTime() + 3600000);

        const isBusy = busy.some(b => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });

        if (!isBusy && slotStart > new Date()) {
          const tzAbbr = isDST ? 'EDT' : 'EST';
          const nyTime = new Date(slotStart.getTime() - nyOffsetHours * 3600000);
          const daysInfo = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const monthsInfo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

          const weekdayStr = daysInfo[nyTime.getUTCDay()];
          const monthStr = monthsInfo[nyTime.getUTCMonth()];
          const dateDayStr = nyTime.getUTCDate();
          let hr = nyTime.getUTCHours();
          const ampm = hr >= 12 ? 'PM' : 'AM';
          hr = hr % 12 || 12;
          const min = String(nyTime.getUTCMinutes()).padStart(2, '0');
          const label = `${weekdayStr}, ${monthStr} ${dateDayStr} at ${hr}:${min} ${ampm} ${tzAbbr}`;

          slots.push({ label, start: slotStart.toISOString(), end: slotEnd.toISOString() });
          if (slots.length >= 6) break;
        }
      }
    }
    return slots;
  } catch (e) {
    console.error('Calendar availability error:', e.message);
    return null;
  }
}

// ─── Book Appointment ────────────────────────────────────────────────────────
async function bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes }) {
  const results = { calendar: false, emailLead: false, emailDanny: false };

  // 1. Create Google Calendar event with robust retry logic
  let meetLink = null;
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    console.log(`📅 Creating calendar event for ${name}`);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await oauth2Client.getAccessToken();

    let eventData = null;
    let lastErr = null;
    const retryDelays = [2000, 4000, 8000];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await Promise.race([
          calendar.events.insert({
            calendarId: 'primary',
            sendUpdates: 'none',
            conferenceDataVersion: 1,
            requestBody: {
              summary: `Consultation: ${name} (${company}) x NeuralFlowAI`,
              description: `Company: ${company}\nPain Points: ${notes}\nBooked via ARIA.`,
              start: { dateTime: slotStart, timeZone: 'America/New_York' },
              end: { dateTime: slotEnd, timeZone: 'America/New_York' },
              attendees: [{ email: process.env.GMAIL_USER || 'danny@neuralflowai.io' }],
              conferenceData: {
                createRequest: {
                  requestId: `nf-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Calendar timeout')), 5000))
        ]);
        eventData = res.data;
        break; // Success
      } catch (err) {
        lastErr = err;
        console.log(`⚠️ Calendar attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, retryDelays[attempt]));
      }
    }

    if (eventData) {
      meetLink = eventData.hangoutLink || null;
      results.calendar = true;
      console.log(`✅ Calendar event created for ${name} — Meet: ${meetLink || 'pending'}`);
    } else {
      console.error(`❌ Calendar failed after 3 attempts: ${lastErr?.message} — emails will still send`);
    }
  }

  // 2. Email confirmation to lead
  try {
    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: email,
      subject: `Your NeuralFlow Consultation is Confirmed ✅`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#ffffff;padding:48px 40px;border-radius:12px;">
          <h1 style="margin:0 0 32px;font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Neural<span style="color:#FF6B1A;">Flow</span></h1>
          <h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#ffffff;">Your Consultation is Confirmed</h2>
          <p style="margin:0 0 24px;color:#a0a0b0;">Hi ${name},</p>
          <p style="margin:0 0 28px;color:#a0a0b0;">Your 1-hour consultation with Danny Boehmer is booked. We look forward to speaking with you.</p>
          <div style="background:#16161a;border:1px solid #2a2a35;border-radius:10px;padding:24px;margin:0 0 32px;">
            <p style="margin:0 0 14px;color:#ffffff;"><strong>When</strong><br/><span style="color:#a0a0b0;">${slotLabel.includes('EST') || slotLabel.includes('EDT') ? slotLabel : slotLabel + ' EST'}</span></p>
            <p style="margin:0 0 14px;color:#ffffff;"><strong>Duration</strong><br/><span style="color:#a0a0b0;">1 hour</span></p>
            <p style="margin:0;color:#ffffff;"><strong>Google Meet</strong><br/><a href="${meetLink || '#'}" style="color:#FF6B1A;text-decoration:none;">${meetLink || 'Link coming shortly'}</a></p>
          </div>
          <p style="margin:0;color:#a0a0b0;">Talk soon,<br/><strong style="color:#ffffff;">Danny Boehmer</strong><br/>Founder, NeuralFlow</p>
        </div>
      `,
    });
    results.emailLead = true;
  } catch (e) { console.error('Lead email error:', e.message); }

  // 3. Notify Danny
  try {
    const gcalStart = new Date(slotStart).toISOString().replace(/[-:]/g, '').replace('.000', '');
    const gcalEnd = new Date(slotEnd).toISOString().replace(/[-:]/g, '').replace('.000', '');
    const gcalLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('NeuralFlow Consultation — ' + name)}&dates=${gcalStart}Z/${gcalEnd}Z&details=${encodeURIComponent('Client: ' + name + '\nEmail: ' + email + '\nCompany: ' + company + '\n\nWhat they want: ' + (notes ? notes.split('|')[0] : '') + '\nPain points: ' + (notes ? notes.split('|')[1] || '' : ''))}&add=${encodeURIComponent(email)}`;
    await sendEmail({
      from: "NeuralFlow ARIA <danny@neuralflowai.io>",
      to: process.env.GMAIL_USER,
      subject: `🔥 New Booking — ${name} (${company})`,
      html: `<div style="font-family:sans-serif;max-width:600px;">
        <h2>🤖 New Consultation Booked via ARIA!</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Time:</strong> ${slotLabel}</p>
        <p><strong>What they want:</strong> ${notes ? notes.split('|')[0] : 'See chat'}</p>
        <p><strong>Pain points:</strong> ${notes ? (notes.split('|')[1] || 'See chat') : 'See chat'}</p>
        <p style="margin-top:24px;"><a href="${gcalLink}" style="background:#FF6B1A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">➕ Add to Google Calendar</a></p>
        </div>`,
    });
    results.emailDanny = true;
  } catch (e) { console.error('Danny email error:', e.message); }

  return results;
}

// ─── Get Availability API ─────────────────────────────────────────────────────
app.get('/api/availability', async (req, res) => {
  const { date } = req.query; // optional: ?date=2026-03-20
  const slots = await getAvailableSlots(90, date || null);
  res.json({ slots });
});

// ─── Book API ─────────────────────────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  const { name, email, company, slotStart, slotEnd, slotLabel, notes } = req.body;
  if (!name || !email || !slotStart) return res.status(400).json({ error: 'Missing fields' });
  const results = await bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes });
  res.json({ success: true, results });
});

// ─── ARIA Chat ───────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, conversationId, clientTimezone } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required' });
    const convId = conversationId || messages[0]?.content?.slice(0, 60) || 'default';

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    // ── Slot fetch strategy ──────────────────────────────────────────────────
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    let searchFromDate = null;
    let daysWindow = 7;

    if (lastUserMsg.match(/couple weeks?|few weeks?|2[-–]3 weeks?/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/next week/)) {
      const d = new Date(); d.setDate(d.getDate() + 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/in\s+(\d+)\s+weeks?/)) {
      const w = parseInt(lastUserMsg.match(/in\s+(\d+)\s+weeks?/)[1]);
      const d = new Date(); d.setDate(d.getDate() + w * 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/next month/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else if (lastUserMsg.match(/in\s+(\d+)\s+months?/)) {
      const m = parseInt(lastUserMsg.match(/in\s+(\d+)\s+months?/)[1]);
      const d = new Date(); d.setMonth(d.getMonth() + m);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else {
      const dateMatch = lastUserMsg.match(/(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?)|(?:\bthe\s+(\d{1,2})(?:st|nd|rd|th))|(?:\b(\d{1,2})(?:st|nd|rd|th)\b)/);
      if (dateMatch) {
        const monthStr = dateMatch[1];
        const dayNum = parseInt(dateMatch[2] || dateMatch[3] || dateMatch[4]);
        if (dayNum >= 1 && dayNum <= 31) {
          const d = new Date();
          if (monthStr) d.setMonth(monthNames.indexOf(monthStr));
          d.setDate(dayNum);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          if (d < today) d.setFullYear(d.getFullYear() + 1);
          searchFromDate = d.toISOString().split('T')[0]; daysWindow = 1;
        }
      }
      if (!searchFromDate) {
        for (const [i, month] of monthNames.entries()) {
          if (lastUserMsg.includes(month)) {
            const d = new Date(); d.setMonth(i);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (d < today) d.setFullYear(d.getFullYear() + 1);
            d.setDate(1);
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
            break;
          }
        }
      }
    }

    const lockedEntry = conversationSlots.get(convId);
    let slots;

    if (lockedEntry) {
      const validCached = lockedEntry.slots.filter(s => s.start && new Date(s.start) > new Date());
      let cachedCoversDate = true;
      if (searchFromDate && validCached.length > 0) {
        const targetStr = new Date(searchFromDate + 'T12:00:00Z').toISOString().split('T')[0];
        cachedCoversDate = validCached.some(s => s.start.startsWith(targetStr));
      }

      if (validCached.length > 0 && cachedCoversDate) {
        slots = validCached;
        console.log('🔒 Reusing cached slots:', slots.map(s => s.label));
      } else {
        slots = await getAvailableSlots(daysWindow, searchFromDate);
        console.log('📅 Re-fetching slots from:', searchFromDate || 'now', '| window:', daysWindow);
        if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      }
    } else {
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      console.log('📅 Fresh slots from:', searchFromDate || 'now', '| window:', daysWindow, '| count:', slots?.length || 0);
      if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    }

    console.log('🔍 Slots count:', slots?.length || 0);
    const slotsText = slots && slots.length > 0
      ? `\n${slots.map((s, i) => `SLOT ${i + 1}: ${s.label}`).join('\n')}`
      : "\nCALENDAR UNAVAILABLE: Do NOT invent times. Tell client: 'Let me check Danny's calendar — can I get your email so we can confirm a time?'";

    const timezoneContext = clientTimezone ? `\n- When confirming a slot, state it in the user's timezone. Format exactly: "I've found a time at [Time] ${clientTimezone}. Should I send the invite to [Email]?"` : '';

    const nowEastern = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: ${nowEastern} Eastern Time

STRICT CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2–3 qualifying questions to understand their business needs
3. Collect in order: Full Name → Email → Company
4. ONLY AFTER collecting all three AND understanding their pain points — show available slots
5. When they confirm a slot — immediately output the BOOK command

SCHEDULING RULES:
- Show slots EXACTLY as listed below — copy each label character-for-character
- Never reformat times (not "10:00 AM - 11:00 AM ET", not "tomorrow", not "next Monday")
- If the client asks for a time NOT in the list, it means that time is taken. Say: "That time's taken — here's what's still open:" and list available slots from the list
- Never say a whole day is unavailable if there are slots listed for that day
- Never invent slots${timezoneContext}

WHEN CLIENT CONFIRMS A SLOT — output this immediately:
BOOK:{"slotLabel": "EXACT label copied from slot list", "slotIndex": N, "name": "Full Name", "email": "email@example.com", "company": "Company Name", "notes": "What they want | Pain points"}

Then say: "Perfect! Booking that now — you'll get a calendar invite at [email] shortly!"

Keep responses to 2–3 sentences. Be warm and professional. Do NOT mention any pricing.
${slotsText}`;

    let response;
    let usedFallback = false;

    // Try Anthropic first (3 attempts), then fall back to OpenRouter
    const callAnthropic = async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: systemPrompt,
            messages,
          });
        } catch (err) {
          console.log(`⚠️ Anthropic attempt ${attempt} failed: ${err?.status} ${err?.message?.slice(0, 60)}`);
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
          else throw err;
        }
      }
    };

    const callOpenRouter = async () => {
      if (!process.env.OPENROUTER_API_KEY) throw new Error('No OpenRouter key');
      console.log('🔀 Falling back to OpenRouter...');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neuralflowai.io',
          'X-Title': 'NeuralFlow ARIA',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4-5:beta',
          max_tokens: 600,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`OpenRouter error: ${res.status} - ${JSON.stringify(data)}`);
      // Normalize to Anthropic SDK format
      return { content: [{ text: data.choices[0].message.content }] };
    };

    try {
      response = await callAnthropic();
    } catch (err) {
      console.log('⚠️ Anthropic failed, trying OpenRouter...', err.message);
      try {
        response = await callOpenRouter();
        usedFallback = true;
        console.log('✅ OpenRouter fallback succeeded');
      } catch (err2) {
        console.error('❌ Both Anthropic and OpenRouter failed:', err2.message);
        throw err;
      }
    }

    let reply = response.content[0].text;

    // Enforce exact slot labels any time ARIA lists times
    // Catches numbered lists (1. ...) and bullet lists (- ...)
    if (slots && slots.length > 0 && /(AM|PM)/i.test(reply)) {
      slots.forEach((slot, i) => {
        const num = i + 1;
        // Replace numbered: "1. <anything with AM/PM>"
        reply = reply.replace(
          new RegExp('(\\n|^)(\\s*' + num + '\\.[^\\n]*(AM|PM)[^\\n]*)', 'gm'),
          '$1' + num + '. ' + slot.label
        );
        // Replace bullets: "- <anything with AM/PM>" (only first N bullets)
      });
      // Also replace any bullet lines containing times with correct labels
      let bulletIdx = 0;
      reply = reply.replace(/(\n|^)(\s*[-•]\s*)([^\n]*(AM|PM)[^\n]*)/gm, (match, nl, bullet, content) => {
        if (bulletIdx < slots.length) {
          const label = slots[bulletIdx].label;
          bulletIdx++;
          return nl + bullet + label;
        }
        return match;
      });
    }

    // Check if ARIA wants to book
    const bookMatch = reply.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch && slots) {
      try {
        const bookData = JSON.parse(bookMatch[1]);
        // Always use locked conversation slots — this guarantees we book exactly what was shown
        const lockedSlots = conversationSlots.get(convId)?.slots || slots;
        let slot = null;

        // PRIMARY: exact label match — ARIA copies the label verbatim from the system prompt
        if (bookData.slotLabel) {
          slot = lockedSlots.find(s => s.label === bookData.slotLabel);
          // Fuzzy: match on the "date at time" portion (strips EDT/EST variance)
          if (!slot) {
            const labelCore = bookData.slotLabel.replace(/\s+(EDT|EST)$/i, '').trim();
            slot = lockedSlots.find(s => s.label.replace(/\s+(EDT|EST)$/i, '').trim() === labelCore);
          }
          // Fuzzy: match on just the time + date portion
          if (!slot && bookData.slotLabel.includes(' at ')) {
            const timePart = bookData.slotLabel.split(' at ')[1]?.replace(/\s+(EDT|EST)$/i, '').trim();
            const datePart = bookData.slotLabel.split(' at ')[0]?.trim();
            slot = lockedSlots.find(s => s.label.includes(datePart) && s.label.includes(timePart));
          }
        }

        // FALLBACK: slotIndex (ARIA counts from 1, array is 0-based)
        if (!slot && bookData.slotIndex) {
          const slotIdx = Math.max(0, bookData.slotIndex - 1);
          slot = lockedSlots[slotIdx];
          console.log('⚠️ Label match failed — using index', slotIdx, '→', slot?.label);
        }

        if (!slot) slot = lockedSlots[0]; // last resort
        const slotNY = slot?.start ? new Date(slot.start).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'unknown';
        console.log('📌 Booking slot:', slot?.label, '| NY time:', slotNY, '| UTC:', slot?.start, '| ARIA index:', bookData.slotIndex, '| Label:', bookData.slotLabel);
        await bookAppointment({
          name: bookData.name,
          email: bookData.email,
          company: bookData.company,
          notes: bookData.notes || '',
          slotStart: slot.start,
          slotEnd: slot.end,
          slotLabel: slot.label,
        });

        reply = reply.replace(/BOOK:\{.*?\}/s, '').trim();
        return res.json({ reply, booked: true });
      } catch (e) {
        console.error('Booking parse error:', e);
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error('Anthropic error:', error.message);
    res.status(500).json({ error: 'AI error' });
  }
});

// ─── Contact Form ─────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, scope } = req.body;
    if (!name || !email || !scope) return res.status(400).json({ error: 'Missing fields' });

    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: process.env.GMAIL_USER,
      subject: `🔥 New Contact Form — ${name}`,
      html: `<h2>New Contact Form 📬</h2><p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Scope:</strong> ${scope}</p>`,
    });

    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: email,
      subject: `Thanks for reaching out, ${name.split(' ')[0]}! 🚀`,
      html: `<div style="font-family:sans-serif;max-width:600px;background:#0a0a0f;color:#e8e8f0;padding:40px;border-radius:12px;">
        <h1 style="color:#FF6B1A;">NeuralFlow</h1>
        <p>Hi ${name.split(' ')[0]}, thanks for reaching out — I'll get back to you within 24 hours!</p>
        <p><strong>Danny Boehmer</strong><br/>Founder, NeuralFlow</p></div>`,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error.message);
    res.status(500).json({ error: 'Failed to send' });
  }
});

app.listen(port, () => console.log(`NeuralFlow server running at http://localhost:${port}`));
// redeploy Tue Mar  3 12:18:11 EST 2026
