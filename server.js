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
async function getAvailableSlots(daysAhead = 90, startFromDate = null) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) return null;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = startFromDate ? new Date(startFromDate) : new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + daysAhead);

    // Get busy times
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: 'primary' }],
      },
    });

    const busy = freeBusy.data.calendars.primary.busy || [];

    // Generate available 1-hour slots Mon-Fri 9am-5pm EST
    const slots = [];
    const d = startFromDate ? new Date(startFromDate) : new Date();
    d.setHours(0, 0, 0, 0);

    for (let i = startFromDate ? 0 : 1; i <= daysAhead && slots.length < 6; i++) {
      const day = new Date(d);
      day.setDate(day.getDate() + i);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      const hours = [9, 10, 11, 13, 14, 15, 16];
      for (const h of hours) {
        const slotStart = new Date(day);
          slotStart.setUTCHours(h + 5, 0, 0, 0); // EST = UTC-5
        const slotEnd = new Date(slotStart);
          slotEnd.setUTCHours(h + 6, 0, 0, 0); // EST = UTC-5

        // Check if slot overlaps with busy time
        const isBusy = busy.some(b => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });

        if (!isBusy && slotStart > now) {
          const label = slotStart.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
            + ' at ' + slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' EST';
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

  // 1. Create Google Calendar event
  // Create calendar event in background (non-blocking)
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    const calendarPromise = (async () => {
      try {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        await calendar.events.insert({
          calendarId: 'primary',
          sendUpdates: 'all',
          requestBody: {
            summary: `NeuralFlow Consultation — ${name} (${company})`,
            description: `🤖 Booked via ARIA\n\n👤 CLIENT\nName: ${name}\nEmail: ${email}\nCompany: ${company}\n\n📋 WHAT THEY WANT\n${notes ? notes.split('|')[0] : 'See chat'}\n\n🔥 PAIN POINTS\n${notes ? (notes.split('|')[1] || 'See chat') : 'See chat'}\n\n⚡ PREP\n- Pricing starts at $2,500`,
            start: { dateTime: slotStart, timeZone: 'America/New_York' },
            end: { dateTime: slotEnd, timeZone: 'America/New_York' },
            attendees: [
              { email, displayName: name },
              { email: process.env.GMAIL_USER || 'danny@neuralflowai.io', displayName: 'Danny Boehmer' },
            ],
          },
        });
        results.calendar = true;
        console.log(`✅ Calendar event created for ${name}`);
      } catch (e) {
        console.error('Calendar booking error:', e.message);
      }
    })();
    // Don't await — fire and forget, emails send immediately
    calendarPromise.catch(e => console.error('Calendar bg error:', e.message));
  }

  // 2. Email confirmation to lead
  try {
    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: email,
      subject: `✅ Your NeuralFlow Consultation is Confirmed!`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#e8e8f0;padding:40px;border-radius:12px;">
          <h1 style="color:#FF6B1A;">NeuralFlow</h1>
          <h2>Your Consultation is Confirmed! 🎉</h2>
          <p>Hi ${name},</p>
          <p>Your free 1-hour consultation with Danny Boehmer is booked. A Google Meet link has been sent to your calendar.</p>
          <div style="background:#16161a;border:1px solid #2a2a35;border-radius:8px;padding:20px;margin:20px 0;">
            <p style="margin:0 0 8px;"><strong>📅 When:</strong> ${slotLabel}</p>
            <p style="margin:0 0 8px;"><strong>🏢 Company:</strong> ${company}</p>
            <p style="margin:0;"><strong>⏱️ Duration:</strong> 1 hour</p>
          </div>
          <p>Talk soon,</p>
          <p><strong>Danny Boehmer</strong><br/>Founder, NeuralFlow<br/><a href="https://neuralflowai.io" style="color:#FF6B1A;">neuralflowai.io</a></p>
        </div>
      `,
    });
    results.emailLead = true;
  } catch (e) { console.error('Lead email error:', e.message); }

  // 3. Notify Danny
  try {
    const gcalStart = new Date(slotStart).toISOString().replace(/[-:]/g,'').replace('.000','');
    const gcalEnd = new Date(slotEnd).toISOString().replace(/[-:]/g,'').replace('.000','');
    const gcalLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('NeuralFlow Consultation — ' + name)}&dates=${gcalStart}Z/${gcalEnd}Z&details=${encodeURIComponent('Client: ' + name + '\nEmail: ' + email + '\nCompany: ' + company + '\n\nWhat they want: ' + (notes ? notes.split('|')[0] : '') + '\nPain points: ' + (notes ? notes.split('|')[1] || '' : ''))}&add=${encodeURIComponent(email)}`;
    await sendEmail({
      from: "NeuralFlow ARIA <danny@neuralflowai.io>",
      to: process.env.GMAIL_USER,
      subject: `🔥 New Consultation — ${name} from ${company} — ${slotLabel}`,
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
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required' });

    // Parse any date hint from the conversation
    // Only look at the LAST user message to avoid picking up ARIA's previous date mentions
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';
    let searchFromDate = null;
    const today = new Date();

    if (lastUserMsg.match(/few weeks|couple weeks|2-3 weeks|a few weeks/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0];
    } else if (lastUserMsg.match(/in\s+(\d+)\s+weeks?/)) {
      const weeks = parseInt(lastUserMsg.match(/in\s+(\d+)\s+weeks?/)[1]);
      const d = new Date(); d.setDate(d.getDate() + weeks * 7);
      searchFromDate = d.toISOString().split('T')[0];
    } else if (lastUserMsg.match(/next month/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0];
    } else if (lastUserMsg.match(/in\s+(\d+)\s+months?/)) {
      const months = parseInt(lastUserMsg.match(/in\s+(\d+)\s+months?/)[1]);
      const d = new Date(); d.setMonth(d.getMonth() + months);
      searchFromDate = d.toISOString().split('T')[0];
    } else {
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      for (const [i, month] of monthNames.entries()) {
        if (lastUserMsg.includes(month)) {
          const d = new Date();
          d.setMonth(i);
          if (d <= today) d.setFullYear(d.getFullYear() + 1);
          d.setDate(1);
          searchFromDate = d.toISOString().split('T')[0];
          break;
        }
      }
    }


    // Fetch live availability searching up to 365 days out from detected date
    console.log('🗓️ Date search:', { lastUserMsg: lastUserMsg.slice(0,100), searchFromDate });
    const slots = await getAvailableSlots(365, searchFromDate);
    console.log('📅 Slots returned:', slots ? slots.map(s=>s.label) : 'NULL');
    const slotsText = slots && slots.length > 0
      ? `\n\n===REAL CALENDAR SLOTS - USE ONLY THESE EXACT DATES AND TIMES===\n${slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n')}\n===END OF SLOTS===\n\nCRITICAL: You MUST ONLY present the exact slots listed above. NEVER invent, modify, or suggest any other dates or times. These are the ONLY real available times from Danny's live calendar today (${new Date().toDateString()}).\n\nWhen client confirms a slot, respond with:\nBOOK:{"slotIndex": N, "name": "Full Name", "email": "email@example.com", "company": "Company", "notes": "What they want|Pain points"}\n(N = 0-based index)`
      : '\n\nCALENDAR UNAVAILABLE: Do NOT invent or make up any dates or times. Tell the client: "Let me check Danny\'s calendar and get back to you — can I get your email so we can confirm a time?" Then collect their contact info.';

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

Your goal: qualify leads and book free 1-hour consultations directly in this chat. No links, no redirects — book it right here.

CONVERSATION FLOW:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask about their business and challenges
3. Explain relevant services (AI Consulting, Workflow Automation, Custom Apps, AI Receptionists, Lead Gen, Dashboards)
4. When they are interested, collect: Full name, Email address, Company name
5. Show available slots and ask which works best
6. The moment they pick a slot — IMMEDIATELY output the BOOK command. No extra confirmation needed.

CRITICAL BOOKING RULE: When a client selects or confirms any time slot, you MUST output this FIRST before any other text:
BOOK:{"slotIndex": N, "name": "Their Full Name", "email": "their@email.com", "company": "Their Company", "notes": "What they want to build|Their pain points"}
Then say: "Perfect! Booking that now — you will get a calendar invite at [email] shortly! 🎉"


SCHEDULING FLEXIBILITY: Danny's calendar is open up to a full year out. If a client mentions they are busy, on vacation, or wants a specific week or month — always say "No problem! Here are slots around that time:" and show ONLY the numbered slots listed below. NEVER invent or make up dates. ONLY use the exact slot labels provided in the AVAILABLE SLOTS list. The slots are already filtered to match their timeframe.

NEVER skip the BOOK command when a slot is chosen. NEVER ask for extra confirmation after they have already said yes to a slot. Act immediately and book it.

Keep responses concise (2-3 sentences). Pricing starts at $2,500 — always offer free consultation for exact quote. Be warm and professional.\${slotsText}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages,
    });

    let reply = response.content[0].text;

    // Check if ARIA wants to book
    const bookMatch = reply.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch && slots) {
      try {
        const bookData = JSON.parse(bookMatch[1]);
        const slot = slots[bookData.slotIndex] || slots[0];
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
