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
async function getAvailableSlots(daysAhead = 90, startFromDate = null) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) return null;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = startFromDate ? new Date(startFromDate) : new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + daysAhead); // 90 days out

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
        // Determine NY UTC offset: EDT (-4) or EST (-5)
        // DST: 2nd Sunday in March → 1st Sunday in November
        const year = day.getUTCFullYear();
        const dstStart = new Date(Date.UTC(year, 2, 8));
        dstStart.setUTCDate(8 + (7 - dstStart.getUTCDay()) % 7);
        const dstEnd = new Date(Date.UTC(year, 10, 1));
        dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7);
        const isDST = day >= dstStart && day < dstEnd;
        const nyOffsetHours = isDST ? 4 : 5; // hours behind UTC
        const dateStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
        const slotStart = new Date(`${dateStr}T${String(h).padStart(2,'0')}:00:00.000Z`);
        slotStart.setTime(slotStart.getTime() + nyOffsetHours * 3600000); // convert NY→UTC
        const slotEnd = new Date(slotStart.getTime() + 3600000);

        // Check if slot overlaps with busy time
        const isBusy = busy.some(b => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });

        if (!isBusy && slotStart > now) {
          const tzAbbr = isDST ? 'EDT' : 'EST';
          const label = slotStart.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
            + ' at ' + slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ' + tzAbbr;
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

  // 1. Create Google Calendar event with 5s timeout, grab Meet link if available
  let meetLink = null;
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    try {
      console.log(`📅 Creating calendar event for ${name}`);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await oauth2Client.getAccessToken();
      const event = await Promise.race([
        calendar.events.insert({
          calendarId: 'primary',
          sendUpdates: 'none',
          conferenceDataVersion: 1,
          requestBody: {
            summary: `NeuralFlow Consultation — ${name} (${company})`,
            description: `🤖 Booked via ARIA\n\n👤 CLIENT\nName: ${name}\nEmail: ${email}\nCompany: ${company}\n\n📋 WHAT THEY WANT\n${notes ? notes.split('|')[0] : 'See chat'}\n\n🔥 PAIN POINTS\n${notes ? (notes.split('|')[1] || 'See chat') : 'See chat'}\n\n⚡ PREP\n- Pricing starts at $2,500`,
            start: { dateTime: slotStart, timeZone: 'America/New_York' },
            end: { dateTime: slotEnd, timeZone: 'America/New_York' },
            attendees: [
              { email: process.env.GMAIL_USER || 'danny@neuralflowai.io', displayName: 'Danny Boehmer' },
            ],
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
      meetLink = event.data?.hangoutLink || null;
      results.calendar = true;
      console.log(`✅ Calendar event created for ${name} — Meet: ${meetLink || 'pending'}`);
    } catch (e) {
      console.error(`❌ Calendar failed: ${e.message} — emails will still send`);
    }
  }

  // 2. Email confirmation to lead
  try {
    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: email,
      subject: `✅ Your NeuralFlow Consultation is Confirmed!`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#ffffff;padding:48px 40px;border-radius:12px;">
          <h1 style="margin:0 0 32px;font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Neural<span style="color:#FF6B1A;">Flow</span></h1>
          <h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#ffffff;">Your Consultation is Confirmed</h2>
          <p style="margin:0 0 24px;color:#a0a0b0;">Hi ${name},</p>
          <p style="margin:0 0 28px;color:#a0a0b0;">Your 1-hour consultation with Danny Boehmer is booked. We look forward to speaking with you.</p>
          <div style="background:#16161a;border:1px solid #2a2a35;border-radius:10px;padding:24px;margin:0 0 32px;">
            <p style="margin:0 0 14px;color:#ffffff;"><strong>When</strong><br/><span style="color:#a0a0b0;">${slotLabel.includes('EST') ? slotLabel : slotLabel + ' EST'}</span></p>
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
    const { messages, conversationId } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required' });
    const convId = conversationId || messages[0]?.content?.slice(0, 60) || 'default';

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    // ── Slot fetch strategy ──────────────────────────────────────────────────
    // Simple rule: lock slots once fetched. Only re-fetch if user explicitly
    // wants a DIFFERENT timeframe (different month, week, etc.) that falls
    // outside what we already have. Let Claude handle ALL natural language
    // understanding of dates/times — never try to parse intent with regex.

    const lockedEntry = conversationSlots.get(convId);
    const wantsDifferentTime = lastUserMsg.match(/different|another time|another date|instead|rather|change|reschedule|not work|how about|what about/);

    // Detect if user is requesting a timeframe that's clearly outside locked range
    // Only re-fetch for broad timeframe shifts (weeks/months out), not slot picks
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    let searchFromDate = null;
    let daysWindow = 7;

    // Only parse timeframe for RE-FETCH decisions — not for slot selection (Claude handles that)
    if (!lockedEntry || wantsDifferentTime) {
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
        // Check for month name (e.g. "sometime in April", "April works")
        for (const [i, month] of monthNames.entries()) {
          if (lastUserMsg.includes(month)) {
            const d = new Date(); d.setMonth(i);
            if (d <= new Date()) d.setFullYear(d.getFullYear() + 1);
            d.setDate(1);
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
            break;
          }
        }
        // Check for specific date like "March 10", "the 10th", "March 10th"
        // Only for re-fetch — if they say "march 10 at 2" we fetch around march 10
        const dateMatch = lastUserMsg.match(/(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}))|(?:\bthe\s+(\d{1,2})(?:st|nd|rd|th))|(?:\b(\d{1,2})(?:st|nd|rd|th)\b)/);
        if (dateMatch && !lockedEntry) {
          const today2 = new Date();
          const monthStr = dateMatch[1];
          const dayNum = parseInt(dateMatch[2] || dateMatch[3] || dateMatch[4]);
          if (dayNum >= 1 && dayNum <= 31) {
            const d = new Date();
            if (monthStr) d.setMonth(monthNames.indexOf(monthStr));
            d.setDate(Math.max(1, dayNum - 1));
            if (d < today2) { d.setMonth(d.getMonth() + 1); }
            searchFromDate = d.toISOString().split('T')[0]; daysWindow = 5;
          }
        }
      }
    }

    let slots;
    const now = new Date();

    if (lockedEntry && !wantsDifferentTime && !searchFromDate) {
      // Use locked slots, filter out expired
      slots = lockedEntry.slots.filter(s => s.start && new Date(s.start) > now);
      if (slots.length === 0) {
        console.log('⚠️ All locked slots expired — fetching fresh');
        slots = await getAvailableSlots(7, null);
        if (slots?.length > 0) conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
      } else {
        console.log('🔒 Reusing locked slots:', slots.map(s => s.label));
      }
    } else if (searchFromDate || wantsDifferentTime || !lockedEntry) {
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      console.log('📅 Fetching slots from:', searchFromDate || 'now', '| window:', daysWindow);
      if (slots?.length > 0) {
        conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
        console.log('🔒 Slots locked');
      }
    }

    console.log('🔍 Slots count:', slots?.length || 0);
    const slotsText = slots && slots.length > 0
      ? `\n\n[DANNY'S REAL AVAILABLE TIMES]\n${slots.map((s, i) => `SLOT ${i+1}: ${s.label}`).join('\n')}\n[END OF AVAILABLE TIMES]\n\nWhen showing slots to the client, copy them EXACTLY as: "SLOT 1: Wednesday, Mar 4 at 2:00 PM EST" — use the full date, never say 'tomorrow' or 'next Monday'.\n\nCRITICAL SLOT RULES:\n1. Show slot labels EXACTLY as written above — do NOT convert to relative dates like "tomorrow" or "next Monday". Show "Wednesday, Mar 4 at 2:00 PM EST" verbatim.\n2. Never invent, add, or rephrase any slot.\n3. When client picks a slot, use that EXACT slot number from the list above.\n\nWhen client picks a slot number, respond with:\nBOOK:{"slotIndex": N, "slotLabel": "EXACT label text from the slot list", "name": "Full Name", "email": "their@email.com", "company": "Company", "notes": "What they want|Pain points"}\n(N = slot number they picked, slotLabel = copied exactly from the list above)`
      : '\n\nCALENDAR UNAVAILABLE: Do NOT invent or make up any dates or times. Tell the client: "Let me check Danny\'s calendar and get back to you — can I get your email so we can confirm a time?" Then collect their contact info.';

    const nowEastern = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: ${nowEastern} Eastern Time
CRITICAL: NEVER suggest, offer, or book any time slot that is in the past. If a client asks for a time that has already passed, politely let them know and offer future availability instead.

Your goal: qualify leads and book 1-hour consultations directly in this chat.

STRICT CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2-3 qualifying questions to understand their business (pick the most relevant):
   - "What does your team spend the most time on manually?"
   - "What's your biggest bottleneck right now?"
   - "What would make the biggest impact if it were automated?"
   - "How big is your team and what industry are you in?"
3. Once you understand their challenges, collect in order: Full name → Email address → Company name
4. ONLY AFTER collecting all three AND understanding their pain points — present the available time slots
5. When they pick a slot — immediately output the BOOK command

IMPORTANT: Always capture their pain points and what they want to automate in the BOOK notes field. This is critical for Danny to prepare for the call.

SCHEDULING RULES:
- Show ONLY the slots listed below, copied exactly word for word
- Default slots are the next 3 days. If the client says "couple weeks", "few weeks", "next month", or a specific month — the slots below are ALREADY filtered for that timeframe. Say "No problem! Here are times around then:" and list them
- NEVER show near-term slots again after a client requests a later date
- NEVER invent dates. NEVER use "tomorrow" or "next Monday" — always use the exact label text from the list

BOOKING — the moment client confirms a slot:
BOOK:{"slotIndex": N, "slotLabel": "EXACT label from slot list", "name": "Full Name", "email": "email@example.com", "company": "Company", "notes": "What they want|Pain points"}
Then say: "Perfect! Booking that now — you will get a calendar invite at [email] shortly!"

NEVER skip the BOOK command. NEVER ask for extra confirmation after they say yes.
Keep responses to 2-3 sentences. Pricing starts at $2,500. Be warm and professional.${slotsText}`;

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
          console.log(`⚠️ Anthropic attempt ${attempt} failed: ${err?.status} ${err?.message?.slice(0,60)}`);
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

    // Only enforce slot labels if ARIA is actually presenting a full numbered slot list
    // Must have at least 2 numbered time entries to qualify as a slot presentation
    const looksLikeSlotList = slots && slots.length > 0 &&
      /\n\s*1\..*?(AM|PM)/i.test(reply) &&
      /\n\s*2\..*?(AM|PM)/i.test(reply);

    if (looksLikeSlotList) {
      slots.forEach((slot, i) => {
        const num = i + 1;
        reply = reply.replace(
          new RegExp('(\\n\\s*)' + num + '\\.[^\\n]*(AM|PM)[^\\n]*', 'g'),
          '$1' + num + '. ' + slot.label
        );
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
            const timePart = bookData.slotLabel.split(' at ')[1]?.replace(/\s+(EDT|EST)$/i,'').trim();
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
        const slotNY = slot?.start ? new Date(slot.start).toLocaleString('en-US', { timeZone: 'America/New_York', weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true }) : 'unknown';
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
