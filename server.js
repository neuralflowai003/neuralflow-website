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

// ─── Conversation Slot Cache ──────────────────────────────────────────────────
// Key: conversationId, Value: { slots, fetchedAt }
// Slots are locked per conversation so the agreed time never drifts.
const conversationSlots = new Map();
setInterval(() => {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < expiry) conversationSlots.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Clients ──────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder');

// ─── Google OAuth2 ────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NODE_ENV === 'production'
    ? 'https://neuralflowai.io/oauth/callback'
    : 'http://localhost:8080/oauth/callback'
);

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  oauth2Client.getAccessToken()
    .then(() => console.log('✅ Google Calendar connected'))
    .catch(e => console.log('⚠️ Calendar pre-warm failed:', e.message));
} else if (fs.existsSync(path.join(__dirname, 'google-token.json'))) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(path.join(__dirname, 'google-token.json'))));
  console.log('✅ Google Calendar connected (local token)');
} else {
  console.log('⚠️ Google Calendar not authorized — visit /oauth/start');
}

// ─── Middleware & Static ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── OAuth Flow ───────────────────────────────────────────────────────────────
app.get('/oauth/start', (req, res) => {
  res.redirect(oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  }));
});

app.get('/oauth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(path.join(__dirname, 'google-token.json'), JSON.stringify(tokens));
    res.send('<h2>✅ Google Calendar connected! You can close this tab.</h2>');
  } catch (e) {
    res.status(500).send('Auth failed: ' + e.message);
  }
});

// ─── DST Helper ───────────────────────────────────────────────────────────────
function getNYOffset(date) {
  const year = date.getUTCFullYear();
  const dstStart = new Date(Date.UTC(year, 2, 8));
  dstStart.setUTCDate(8 + (7 - dstStart.getUTCDay()) % 7); // 2nd Sunday March
  const dstEnd = new Date(Date.UTC(year, 10, 1));
  dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7);     // 1st Sunday November
  return date >= dstStart && date < dstEnd
    ? { hours: 4, abbr: 'EDT' }
    : { hours: 5, abbr: 'EST' };
}

// ─── Slot Fetching ────────────────────────────────────────────────────────────
async function getAvailableSlots(daysWindow = 7, startFromDate = null) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(path.join(__dirname, 'google-token.json'))) return null;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const windowStart = startFromDate ? new Date(startFromDate) : new Date();
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + daysWindow);

    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        items: [{ id: 'primary' }],
      },
    });
    const busy = data.calendars.primary.busy || [];

    const slots = [];
    const cursor = startFromDate ? new Date(startFromDate) : new Date();
    cursor.setHours(0, 0, 0, 0);

    const SLOT_HOURS = [9, 10, 11, 13, 14, 15, 16];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = startFromDate ? 0 : 1; i <= daysWindow && slots.length < 6; i++) {
      const day = new Date(cursor);
      day.setDate(day.getDate() + i);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      const tz = getNYOffset(day);
      const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

      for (const h of SLOT_HOURS) {
        const slotStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:00:00.000Z`);
        slotStart.setTime(slotStart.getTime() + tz.hours * 3600000);
        const slotEnd = new Date(slotStart.getTime() + 3600000);

        const isBusy = busy.some(b => slotStart < new Date(b.end) && slotEnd > new Date(b.start));
        if (isBusy || slotStart <= new Date()) continue;

        const t = new Date(slotStart.getTime() - tz.hours * 3600000);
        const hr = t.getUTCHours() % 12 || 12;
        const ampm = t.getUTCHours() >= 12 ? 'PM' : 'AM';
        const label = `${DAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()} at ${hr}:${String(t.getUTCMinutes()).padStart(2, '0')} ${ampm} ${tz.abbr}`;

        slots.push({ label, start: slotStart.toISOString(), end: slotEnd.toISOString() });
        if (slots.length >= 6) break;
      }
    }
    return slots;
  } catch (e) {
    console.error('Calendar error:', e.message);
    return null;
  }
}

// ─── Book Appointment ─────────────────────────────────────────────────────────
async function bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes }) {
  const results = { calendar: false, emailLead: false, emailDanny: false };
  let meetLink = null;

  // 1. Google Calendar event
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await oauth2Client.getAccessToken();

    let eventData = null;
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
              end:   { dateTime: slotEnd,   timeZone: 'America/New_York' },
              attendees: [{ email: process.env.GMAIL_USER || 'danny@neuralflowai.io' }],
              conferenceData: {
                createRequest: {
                  requestId: `nf-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Calendar timeout')), 5000)),
        ]);
        eventData = res.data;
        break;
      } catch (err) {
        console.log(`⚠️ Calendar attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, [2000, 4000][attempt]));
      }
    }

    if (eventData) {
      meetLink = eventData.hangoutLink || null;
      results.calendar = true;
      console.log(`✅ Calendar event created — Meet: ${meetLink || 'pending'}`);
    } else {
      console.error('❌ Calendar failed after 3 attempts — proceeding with emails');
    }
  } catch (e) {
    console.error('Calendar setup error:', e.message);
  }

  // 2. Client confirmation email (clean — no pain points)
  try {
    await resend.emails.send({
      from: 'Danny @ NeuralFlow <danny@neuralflowai.io>',
      to: email,
      subject: 'Your NeuralFlow Consultation is Confirmed ✅',
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:48px 40px;border-radius:12px;">
          <h1 style="margin:0 0 32px;font-size:28px;font-weight:800;color:#fff;">Neural<span style="color:#FF6B1A;">Flow</span></h1>
          <h2 style="margin:0 0 20px;font-size:22px;font-weight:700;">Your Consultation is Confirmed</h2>
          <p style="margin:0 0 24px;color:#a0a0b0;">Hi ${name},</p>
          <p style="margin:0 0 28px;color:#a0a0b0;">Your 1-hour consultation with Danny Boehmer is booked. Looking forward to speaking with you.</p>
          <div style="background:#16161a;border:1px solid #2a2a35;border-radius:10px;padding:24px;margin:0 0 32px;">
            <p style="margin:0 0 14px;color:#fff;"><strong>When</strong><br/><span style="color:#a0a0b0;">${slotLabel}</span></p>
            <p style="margin:0 0 14px;color:#fff;"><strong>Duration</strong><br/><span style="color:#a0a0b0;">1 hour</span></p>
            <p style="margin:0;color:#fff;"><strong>Google Meet</strong><br/>
              ${meetLink
                ? `<a href="${meetLink}" style="color:#FF6B1A;text-decoration:none;">${meetLink}</a>`
                : '<span style="color:#a0a0b0;">Link coming shortly</span>'}
            </p>
          </div>
          <p style="margin:0;color:#a0a0b0;">Talk soon,<br/><strong style="color:#fff;">Danny Boehmer</strong><br/>Founder, NeuralFlow</p>
        </div>`,
    });
    results.emailLead = true;
  } catch (e) {
    console.error('Lead email error:', e.message);
  }

  // 3. Danny notification email (full details including pain points)
  try {
    const [wants, pain] = (notes || '').split('|').map(s => s?.trim() || '—');
    await resend.emails.send({
      from: 'NeuralFlow ARIA <danny@neuralflowai.io>',
      to: process.env.GMAIL_USER || 'danny@neuralflowai.io',
      subject: `🔥 New Booking — ${name} (${company})`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;">
          <h2>🤖 New Consultation Booked via ARIA</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Company:</strong> ${company}</p>
          <p><strong>Time:</strong> ${slotLabel}</p>
          <p><strong>What they want:</strong> ${wants}</p>
          <p><strong>Pain points:</strong> ${pain}</p>
          ${meetLink ? `<p><strong>Meet:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ''}
        </div>`,
    });
    results.emailDanny = true;
  } catch (e) {
    console.error('Danny email error:', e.message);
  }

  return results;
}

// ─── Availability API ─────────────────────────────────────────────────────────
app.get('/api/availability', async (req, res) => {
  const slots = await getAvailableSlots(90, req.query.date || null);
  res.json({ slots });
});

// ─── Book API ─────────────────────────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  const { name, email, company, slotStart, slotEnd, slotLabel, notes } = req.body;
  if (!name || !email || !slotStart) return res.status(400).json({ error: 'Missing fields' });
  const results = await bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes });
  res.json({ success: true, results });
});

// ─── ARIA Chat ────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, conversationId, clientTimezone } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required' });

    const convId = conversationId || messages[0]?.content?.slice(0, 60) || 'default';
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    // ── Determine what date range to fetch ───────────────────────────────────
    const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
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
      // Specific date: "March 10", "March 10th", "the 10th", "10th"
      // Requires month name OR ordinal suffix — bare numbers like "at 2" or "10am" are ignored
      const dateMatch = lastUserMsg.match(
        /(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?)|(?:\bthe\s+(\d{1,2})(?:st|nd|rd|th))|(?:\b(\d{1,2})(?:st|nd|rd|th)\b)/
      );
      if (dateMatch) {
        const monthStr = dateMatch[1];
        const dayNum = parseInt(dateMatch[2] || dateMatch[3] || dateMatch[4]);
        if (dayNum >= 1 && dayNum <= 31) {
          const d = new Date();
          if (monthStr) d.setMonth(MONTH_NAMES.indexOf(monthStr));
          d.setDate(dayNum);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          if (d < today) d.setFullYear(d.getFullYear() + 1);
          searchFromDate = d.toISOString().split('T')[0];
          daysWindow = 1; // fetch only that specific day
        }
      }
      // Vague month only (no specific day)
      if (!searchFromDate) {
        for (const [i, month] of MONTH_NAMES.entries()) {
          if (lastUserMsg.includes(month)) {
            const d = new Date(); d.setMonth(i); d.setDate(1);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (d < today) d.setFullYear(d.getFullYear() + 1);
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
            break;
          }
        }
      }
    }

    // ── Slot cache logic ─────────────────────────────────────────────────────
    let slots;
    const cached = conversationSlots.get(convId);

    if (cached) {
      const valid = cached.slots.filter(s => new Date(s.start) > new Date());
      // Check if cache covers the requested date
      const coversDate = !searchFromDate || valid.some(s => s.start.startsWith(searchFromDate));

      if (valid.length > 0 && coversDate) {
        slots = valid;
        console.log('🔒 Reusing cached slots:', slots.map(s => s.label));
      } else {
        slots = await getAvailableSlots(daysWindow, searchFromDate);
        console.log('📅 Re-fetching:', searchFromDate || 'now', '| window:', daysWindow);
        if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      }
    } else {
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      console.log('📅 Fresh fetch:', searchFromDate || 'now', '| window:', daysWindow, '| count:', slots?.length || 0);
      if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    }

    // ── Build system prompt ──────────────────────────────────────────────────
    const nowEastern = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York', weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const slotsText = slots?.length > 0
      ? `\n\nAVAILABLE SLOTS:\n${slots.map((s, i) => `SLOT ${i + 1}: ${s.label}`).join('\n')}`
      : `\n\nCALENDAR UNAVAILABLE: Do NOT invent times. Tell the client: "Let me check Danny's calendar — can I get your email so we can confirm a time?"`;

    const tzNote = clientTimezone
      ? `\n- When confirming a slot, tell the client: "I've found a time at [Time] ${clientTimezone}. Should I send the invite to [Email]?"`
      : '';

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: ${nowEastern} Eastern Time
NEVER suggest or book any time that is in the past.

CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2–3 qualifying questions to understand their business needs
3. Collect in order: Full Name → Email → Company name
4. ONLY after collecting all three AND understanding their pain points — present available slots
5. When they confirm a slot — output the BOOK command immediately

SLOT RULES:
- Copy slot labels EXACTLY character-for-character from the list below
- Never reformat (not "10:00 AM - 11:00 AM ET", not "tomorrow", not "next Monday")
- If the client asks for a time NOT in the list, say: "That time's taken — here's what's still open:" and list available slots
- Never say a whole day is unavailable if slots exist for that day${tzNote}

ON CONFIRMATION — output immediately:
BOOK:{"slotLabel":"EXACT label from slot list","slotIndex":N,"name":"Full Name","email":"email@example.com","company":"Company Name","notes":"what they want | pain points"}
Then say: "Perfect! Booking that now — you'll get a calendar invite at [email] shortly!"

Keep replies to 2–3 sentences. Be warm and professional. Do not mention pricing.${slotsText}`;

    // ── Call AI (Anthropic with OpenRouter fallback) ──────────────────────────
    let response;

    const tryAnthropic = async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 600,
            system: systemPrompt,
            messages,
          });
        } catch (err) {
          console.log(`⚠️ Anthropic attempt ${attempt}: ${err?.status} ${err?.message?.slice(0, 60)}`);
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
          else throw err;
        }
      }
    };

    const tryOpenRouter = async () => {
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
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)}`);
      return { content: [{ text: data.choices[0].message.content }] };
    };

    try {
      response = await tryAnthropic();
    } catch (err) {
      try {
        response = await tryOpenRouter();
        console.log('✅ OpenRouter fallback succeeded');
      } catch (err2) {
        console.error('❌ Both AI providers failed:', err2.message);
        throw err;
      }
    }

    let reply = response.content[0].text;

    // ── Enforce exact slot labels ─────────────────────────────────────────────
    // Prevents ARIA from reformatting times in its own style
    if (slots?.length > 0 && /(AM|PM)/i.test(reply)) {
      slots.forEach((slot, i) => {
        const n = i + 1;
        reply = reply.replace(
          new RegExp(`(\\n|^)(\\s*${n}\\.[^\\n]*(AM|PM)[^\\n]*)`, 'gm'),
          `$1${n}. ${slot.label}`
        );
      });
      let bi = 0;
      reply = reply.replace(/(\n|^)(\s*[-•]\s*)([^\n]*(AM|PM)[^\n]*)/gm, (_, nl, bullet) => {
        if (bi < slots.length) return `${nl}${bullet}${slots[bi++].label}`;
        return _;
      });
    }

    // ── Parse BOOK command ────────────────────────────────────────────────────
    const bookMatch = reply.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch && slots) {
      try {
        const { slotLabel, slotIndex, name, email, company, notes } = JSON.parse(bookMatch[1]);
        const lockedSlots = conversationSlots.get(convId)?.slots || slots;

        // Match slot: exact label → fuzzy (strip timezone) → fuzzy (date+time parts) → index → first
        let slot =
          lockedSlots.find(s => s.label === slotLabel) ||
          lockedSlots.find(s => s.label.replace(/\s+(EDT|EST)$/i, '') === slotLabel?.replace(/\s+(EDT|EST)$/i, '')) ||
          (slotLabel?.includes(' at ') && lockedSlots.find(s =>
            s.label.includes(slotLabel.split(' at ')[0]) &&
            s.label.includes(slotLabel.split(' at ')[1]?.replace(/\s+(EDT|EST)$/i, '').trim())
          )) ||
          (slotIndex && lockedSlots[Math.max(0, slotIndex - 1)]) ||
          lockedSlots[0];

        console.log('📌 Booking:', slot?.label, '| UTC:', slot?.start);

        await bookAppointment({
          name, email, company, notes: notes || '',
          slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label,
        });

        reply = reply.replace(/BOOK:\{.*?\}/s, '').trim();
        return res.json({ reply, booked: true });
      } catch (e) {
        console.error('Booking error:', e);
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ error: 'AI error' });
  }
});

// ─── Contact Form ─────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, scope } = req.body;
    if (!name || !email || !scope) return res.status(400).json({ error: 'Missing fields' });

    await Promise.all([
      resend.emails.send({
        from: 'Danny @ NeuralFlow <danny@neuralflowai.io>',
        to: process.env.GMAIL_USER || 'danny@neuralflowai.io',
        subject: `🔥 New Contact Form — ${name}`,
        html: `<h2>New Contact Form</h2><p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Scope:</strong> ${scope}</p>`,
      }),
      resend.emails.send({
        from: 'Danny @ NeuralFlow <danny@neuralflowai.io>',
        to: email,
        subject: `Thanks for reaching out, ${name.split(' ')[0]}! 🚀`,
        html: `<div style="font-family:sans-serif;max-width:600px;background:#0a0a0f;color:#e8e8f0;padding:40px;border-radius:12px;">
          <h1 style="color:#FF6B1A;">NeuralFlow</h1>
          <p>Hi ${name.split(' ')[0]}, thanks for reaching out — I'll get back to you within 24 hours!</p>
          <p><strong>Danny Boehmer</strong><br/>Founder, NeuralFlow</p>
        </div>`,
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error.message);
    res.status(500).json({ error: 'Failed to send' });
  }
});

app.listen(port, () => console.log(`NeuralFlow running on port ${port}`));
