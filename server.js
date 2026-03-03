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
// Clean up old conversations after 2 hours
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < twoHoursAgo) conversationSlots.delete(key);
  }
}, 30 * 60 * 1000);

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
async function getAvailableSlots(daysAhead = 30, startFromDate = null) {
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

    // Parse date preference from the LAST user message only
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';
    const allUserMsgs = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase()).join(' ');
    let searchFromDate = null;
    let daysWindow = 4; // default: show next 3 days of slots
    const today = new Date();

    // Detect timeframe from last user message
    if (lastUserMsg.match(/couple weeks?|few weeks?|2[-–]3 weeks?|a couple/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0];
      daysWindow = 5;
    } else if (lastUserMsg.match(/next week/)) {
      const d = new Date(); d.setDate(d.getDate() + 7);
      searchFromDate = d.toISOString().split('T')[0];
      daysWindow = 5;
    } else if (lastUserMsg.match(/in\s+(\d+)\s+weeks?/)) {
      const weeks = parseInt(lastUserMsg.match(/in\s+(\d+)\s+weeks?/)[1]);
      const d = new Date(); d.setDate(d.getDate() + weeks * 7);
      searchFromDate = d.toISOString().split('T')[0];
      daysWindow = 5;
    } else if (lastUserMsg.match(/next month/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0];
      daysWindow = 7;
    } else if (lastUserMsg.match(/in\s+(\d+)\s+months?/)) {
      const months = parseInt(lastUserMsg.match(/in\s+(\d+)\s+months?/)[1]);
      const d = new Date(); d.setMonth(d.getMonth() + months);
      searchFromDate = d.toISOString().split('T')[0];
      daysWindow = 7;
    } else {
      // Check for specific month names
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      for (const [i, month] of monthNames.entries()) {
        if (lastUserMsg.includes(month)) {
          const d = new Date();
          d.setMonth(i);
          if (d <= today) d.setFullYear(d.getFullYear() + 1);
          d.setDate(1);
          searchFromDate = d.toISOString().split('T')[0];
          daysWindow = 10;
          break;
        }
      }
    }

    // Slot locking logic:
    // - If user requests a NEW timeframe (couple weeks, next month etc) → fetch fresh slots for that window
    // - If slots already locked for this conversation → reuse them (guarantees booking = what was shown)
    // - First time showing slots → fetch and lock them
    const hasNewTimeframe = searchFromDate !== null; // only true when user explicitly requested different time
    const lockedEntry = conversationSlots.get(convId);
    let slots;

    if (hasNewTimeframe) {
      // User wants a different timeframe — fetch fresh and re-lock
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      console.log('📅 New timeframe slots:', slots ? slots.map(s=>s.label) : 'NULL', '| from:', searchFromDate);
      if (slots && slots.length > 0) {
        conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
        console.log('🔒 Slots locked for conversation:', convId.slice(0,30));
      }
    } else if (lockedEntry) {
      // Reuse locked slots — this is the key to consistency
      slots = lockedEntry.slots;
      console.log('🔒 Using locked slots for conversation:', slots.map(s=>s.label));
    } else {
      // First time — fetch and lock
      slots = await getAvailableSlots(daysWindow, null);
      console.log('📅 Initial slots fetched:', slots ? slots.map(s=>s.label) : 'NULL');
      if (slots && slots.length > 0) {
        conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
        console.log('🔒 Slots locked for conversation:', convId.slice(0,30));
      }
    }
    console.log('🔍 Slots count:', slots ? slots.length : 0);
    const slotsText = slots && slots.length > 0
      ? `\n\n[DANNY'S REAL AVAILABLE TIMES]\n${slots.map((s, i) => `SLOT ${i+1}: ${s.label}`).join('\n')}\n[END OF AVAILABLE TIMES]\n\nWhen showing slots to the client, copy them EXACTLY as: "SLOT 1: Wednesday, Mar 4 at 2:00 PM EST" — use the full date, never say 'tomorrow' or 'next Monday'.\n\nCRITICAL SLOT RULES:\n1. Show slot labels EXACTLY as written above — do NOT convert to relative dates like "tomorrow" or "next Monday". Show "Wednesday, Mar 4 at 2:00 PM EST" verbatim.\n2. Never invent, add, or rephrase any slot.\n3. When client picks a slot, use that EXACT slot number from the list above.\n\nWhen client picks a slot number, respond with:\nBOOK:{"slotIndex": N, "slotLabel": "EXACT label text from the slot list", "name": "Full Name", "email": "their@email.com", "company": "Company", "notes": "What they want|Pain points"}\n(N = slot number they picked, slotLabel = copied exactly from the list above)`
      : '\n\nCALENDAR UNAVAILABLE: Do NOT invent or make up any dates or times. Tell the client: "Let me check Danny\'s calendar and get back to you — can I get your email so we can confirm a time?" Then collect their contact info.';

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

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

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages,
    });

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
        // Primary: use slotIndex into locked slots (ARIA counts from 1, array is 0-based)
        const slotIdx = Math.max(0, (bookData.slotIndex || 1) - 1);
        let slot = lockedSlots[slotIdx];
        // Backup: label match if index fails
        if (!slot && bookData.slotLabel) {
          slot = lockedSlots.find(s => s.label === bookData.slotLabel) || 
                 lockedSlots.find(s => s.label.includes(bookData.slotLabel?.split(' at ')[1] || ''));
        }
        slot = slot || lockedSlots[0];
        console.log('📌 Booking slot:', slot?.label, '| ARIA said slotIndex:', bookData.slotIndex, '| Array index used:', slotIdx, '| Label ARIA gave:', bookData.slotLabel);
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
