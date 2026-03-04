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

// ─── Clients ──────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

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
setInterval(() => {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of conversationSlots.entries()) {
    if (val.fetchedAt < expiry) conversationSlots.delete(key);
  }
}, 30 * 60 * 1000);

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
async function getAvailableSlots(daysWindow = 7, startFromDate = null) {
  if (!process.env.GOOGLE_REFRESH_TOKEN && !fs.existsSync(TOKEN_PATH)) return null;

  // Bug 2 - Force Token Refresh on API call
  await oauth2Client.getAccessToken().catch(e => console.log('token refresh err', e.message));

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Determine bounds for freebusy
    const windowStart = startFromDate ? new Date(startFromDate) : new Date();
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

    const d = startFromDate ? new Date(startFromDate) : new Date();
    d.setHours(0, 0, 0, 0);
    const startIdx = startFromDate ? 0 : 1;

    for (let i = startIdx; i <= daysWindow && slots.length < 6; i++) {
      const currentDay = new Date(d);
      currentDay.setDate(currentDay.getDate() + i);
      const dow = currentDay.getDay();

      // Skip weekends
      if (dow === 0 || dow === 6) continue;

      const { hours: offsetHours, abbr } = getNYOffset(currentDay);
      const dateStr = `${currentDay.getFullYear()}-${String(currentDay.getMonth() + 1).padStart(2, '0')}-${String(currentDay.getDate()).padStart(2, '0')}`;

      const targetHours = [9, 10, 11, 13, 14, 15, 16];
      for (const hr of targetHours) {
        const slotStart = new Date(`${dateStr}T${String(hr).padStart(2, '0')}:00:00.000Z`);
        slotStart.setTime(slotStart.getTime() + offsetHours * 3600000); // NY to UTC
        const slotEnd = new Date(slotStart.getTime() + 3600000);

        const isBusy = busy.some(b => {
          const bs = new Date(b.start);
          const be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });

        if (!isBusy && slotStart > new Date()) {
          const nyTime = new Date(slotStart.getTime() - offsetHours * 3600000);

          const daysInfo = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const monthsInfo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

          const weekdayStr = daysInfo[nyTime.getUTCDay()];
          const monthStr = monthsInfo[nyTime.getUTCMonth()];
          const dateDayStr = nyTime.getUTCDate();
          let hour12 = nyTime.getUTCHours();
          const ampm = hour12 >= 12 ? 'PM' : 'AM';
          hour12 = hour12 % 12 || 12;
          const min = String(nyTime.getUTCMinutes()).padStart(2, '0');

          const labelCore = `${weekdayStr}, ${monthStr} ${dateDayStr} at ${hour12}:${min} ${ampm} ${abbr}`;
          const label = `${labelCore} [start:${slotStart.toISOString()}]`;

          slots.push({ label, start: slotStart.toISOString(), end: slotEnd.toISOString() });
          if (slots.length >= 6) break;
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
  let meetLink = null;

  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await oauth2Client.getAccessToken().catch(() => { });

    let eventData = null;
    const delays = [2000, 4000, 8000];

    for (let i = 0; i < 3; i++) {
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
              attendees: [{ email: process.env.GMAIL_USER }],
              conferenceData: {
                createRequest: {
                  requestId: `nf-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
        ]);
        eventData = res.data;
        break;
      } catch (err) {
        if (i < 2) await new Promise(r => setTimeout(r, delays[i]));
      }
    }
    if (eventData) meetLink = eventData.hangoutLink || null;
  }

  // Client Email
  await resend.emails.send({
    from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
    to: email,
    subject: "Your NeuralFlow Consultation is Confirmed ✅",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#fff;padding:48px 40px;border-radius:12px;">
        <h1 style="color:#fff;">Neural<span style="color:#FF6B1A;">Flow</span></h1>
        <h2>Your Consultation is Confirmed</h2>
        <p>Hi ${name}, your 1-hour consultation with Danny Boehmer is booked.</p>
        <div style="background:#16161a;border:1px solid #2a2a35;padding:24px;border-radius:10px;">
          <p><strong>When</strong><br/>${slotLabel}</p>
          <p><strong>Duration</strong><br/>1 hour</p>
          <p><strong>Google Meet</strong><br/><a href="${meetLink || '#'}" style="color:#FF6B1A;">${meetLink || 'Link coming shortly'}</a></p>
        </div>
      </div>
    `,
  }).catch(() => { });

  // Danny Email
  await resend.emails.send({
    from: "NeuralFlow ARIA <danny@neuralflowai.io>",
    to: process.env.GMAIL_USER,
    subject: `🔥 New Booking — ${name} (${company})`,
    html: `
      <div style="font-family:sans-serif;">
        <h2>🤖 New Booking via ARIA</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Time:</strong> ${slotLabel}</p>
        <p><strong>What they want:</strong> ${notes ? notes.split('|')[0] : ''}</p>
        <p><strong>Pain points:</strong> ${notes ? (notes.split('|')[1] || '') : ''}</p>
        <p><strong>Meet:</strong> ${meetLink || 'None'}</p>
      </div>
    `,
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

// ─── Chat / ARIA ──────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, conversationId, clientTimezone } = req.body;
    if (!messages) return res.status(400).json({ error: 'Messages required' });
    const convId = conversationId || 'default';

    // Date Detection
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';
    let searchFromDate = null;
    let daysWindow = 7;

    const wMatch = lastUserMsg.match(/in\s+(\d+)\s+weeks?/);
    const mMatch = lastUserMsg.match(/in\s+(\d+)\s+months?/);

    if (lastUserMsg.match(/couple weeks?|few weeks?/)) {
      const d = new Date(); d.setDate(d.getDate() + 14);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/next week/)) {
      const d = new Date(); d.setDate(d.getDate() + 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (wMatch) {
      const d = new Date(); d.setDate(d.getDate() + parseInt(wMatch[1]) * 7);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 7;
    } else if (lastUserMsg.match(/next month/)) {
      const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1);
      searchFromDate = d.toISOString().split('T')[0]; daysWindow = 14;
    } else if (mMatch) {
      const d = new Date(); d.setMonth(d.getMonth() + parseInt(mMatch[1]));
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
          searchFromDate = d.toISOString().split('T')[0]; daysWindow = 1;
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

    let weekendNote = false;
    if (searchFromDate) {
      const d = new Date(searchFromDate + "T00:00:00");
      const day = d.getDay();
      if (day === 0) {
        d.setDate(d.getDate() + 1);
        searchFromDate = d.toISOString().split('T')[0];
        weekendNote = true;
      } else if (day === 6) {
        d.setDate(d.getDate() + 2);
        searchFromDate = d.toISOString().split('T')[0];
        weekendNote = true;
      }
    }

    // Cache Logic
    const lockedEntry = conversationSlots.get(convId);
    let slots;
    let fallbackFetch = false;

    if (lastUserMsg.match(/\byes\b|\bthat works\b|\bsounds good\b/)) {
      slots = lockedEntry?.slots;
      if (!slots) fallbackFetch = true;
    } else if (lockedEntry) {
      const validCached = lockedEntry.slots.filter(s => new Date(s.start) > new Date());
      let coversDate = true;
      if (searchFromDate && validCached.length > 0) {
        const targetStr = searchFromDate;
        coversDate = validCached.some(s => s.start.startsWith(targetStr));
      }
      if (validCached.length > 0 && coversDate) {
        slots = validCached;
      } else {
        fallbackFetch = true;
      }
    } else {
      fallbackFetch = true;
    }

    if (fallbackFetch) {
      slots = await getAvailableSlots(daysWindow, searchFromDate);
      if (!slots || slots.length === 0) {
        await new Promise(r => setTimeout(r, 3000));
        slots = await getAvailableSlots(daysWindow, searchFromDate);
      }
    }

    if (slots && slots.length > 0) {
      conversationSlots.set(convId, { slots, fetchedAt: Date.now() });
    }

    // System Prompt Build
    const nowEastern = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const slotsAlert = weekendNote ? "\nNOTE: The client asked for a weekend. Slots below are for the nearest available weekday instead. Tell the client: 'We don't have weekend availability — here are the closest times:'" : "";
    const slotsText = slots && slots.length > 0
      ? `AVAILABLE SLOTS:${slotsAlert}\n${slots.map((s, i) => `SLOT ${i + 1}: ${s.label}`).join('\n')}`
      : "CALENDAR UNAVAILABLE: Do NOT invent times. Tell the client: 'Let me check Danny's calendar — can I get your email so we can confirm a time?'";

    const tzNote = clientTimezone
      ? `\n- When confirming a slot, tell the client: 'I've found a time at [Time] ${clientTimezone}. Should I send the invite to [Email]?'`
      : "";

    const systemPrompt = `You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: ${nowEastern} Eastern Time
NEVER suggest or book any time that is in the past.

CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2–3 qualifying questions to understand their business needs
3. Collect in order: Full Name → Email → Company name
   EMAIL VALIDATION: When the client gives you their email address, validate it before moving on. A valid email must contain exactly one @ symbol and at least one dot after the @. If the email looks wrong or is written out in plain language (e.g. 'john at gmail dot com'), say: 'Could you double-check that email address? I want to make sure your calendar invite reaches you.' Do not proceed to show slots or book until you have a valid email.
4. ONLY after collecting all three AND understanding their pain points — present available slots
5. When they confirm a slot — output the BOOK command immediately

SCHEDULING RULES:
- Copy slot labels EXACTLY character-for-character from the list below — no changes whatsoever
- Never reformat times. "10:00 AM - 11:00 AM ET" is wrong. "tomorrow" is wrong. Copy the label verbatim.
- If the client asks for a time NOT in the list, that time is already booked. Say: "That time's taken — here's what's still open:" then list the available slots
- Never say a whole day is unavailable if there are slots listed for that day
- Never invent or add slots that are not in the list${tzNote}
- CRITICAL: The time you tell the client IS the time that will be booked. Never confirm a time verbally and then output a different slotStart in the BOOK command. The slotStart must always be the [start:...] value from the exact slot you told the client about.
- When outputting the BOOK command, copy the [start:...] value from the chosen slot exactly into the slotStart field.
- CONFIRMATION REQUIRED: Before outputting the BOOK command, you must first send a confirmation message in this exact format:
'Just to confirm — I'm booking [exact slot label] for [Full Name] at [email address]. Shall I go ahead?'
Only output the BOOK command after the client explicitly confirms with yes, correct, go ahead, book it, or similar. Never book on an ambiguous reply.

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
          'Authorization': `Bearer \${process.env.OPENROUTER_API_KEY}`,
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

    // Slot Label Enforcer
    if (slots && slots.length > 0 && /(AM|PM)/.test(aiReplyText)) {
      slots.forEach((s, i) => {
        const num = i + 1;
        aiReplyText = aiReplyText.replace(new RegExp(`(^|\\\\n)\\\\s*\${num}\\\\. \\\\[.*?\\\\]\\\\s*.*?(AM|PM).*?`, 'gm'), `$1\${num}. \${s.label}`);
        aiReplyText = aiReplyText.replace(new RegExp(`(^|\\\\n)\\\\s*\${num}\\\\. \\\\[.*?\\\\]`, 'gm'), `$1\${num}. \${s.label}`);
        aiReplyText = aiReplyText.replace(new RegExp(`(^|\\\\n)\\\\s*\${num}\\\\.\\\\s+.*?(AM|PM).*?`, 'gm'), `$1\${num}. \${s.label}`);
      });
      let bulletIdx = 0;
      aiReplyText = aiReplyText.replace(/(^|\n)(\s*[-•]\s*)(.*?(AM|PM).*?)/gm, (match, nl, bullet) => {
        if (bulletIdx < slots.length) {
          const label = slots[bulletIdx].label;
          bulletIdx++;
          return nl + bullet + label;
        }
        return match;
      });
    }

    // Book command parser
    const bookMatch = aiReplyText.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch) {
      const bookData = JSON.parse(bookMatch[1]);

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!bookData.email || !emailRegex.test(bookData.email)) {
        console.log('⚠️ Invalid email provided during booking:', bookData.email);
        const reply = "Could you double-check that email address? I want to make sure your calendar invite reaches you.";
        return res.json({ reply, booked: false });
      }

      const lockedSlots = conversationSlots.get(convId)?.slots || slots || [];

      let slot = null;
      let matchMethod = '';

      if (bookData.slotStart) {
        slot = lockedSlots.find(s => s.start === bookData.slotStart);
        if (slot) matchMethod = 'Exact ISO';
      }

      if (!slot) {
        slot = lockedSlots.find(s => s.label === bookData.slotLabel);
        if (slot) matchMethod = 'Exact Label';
      }
      if (!slot) {
        const labelCore = bookData.slotLabel?.replace(/\[start:.*?\]/, '')?.replace(/\s+(EDT|EST)$/i, '').trim();
        slot = lockedSlots.find(s => s.label.replace(/\[start:.*?\]/, '').replace(/\s+(EDT|EST)$/i, '').trim() === labelCore);
        if (slot) matchMethod = 'Fuzzy Core';
      }
      if (!slot && bookData.slotLabel?.includes(' at ')) {
        const timePart = bookData.slotLabel.split(' at ')[1]?.replace(/\[start:.*?\]/, '')?.replace(/\s+(EDT|EST)$/i, '').trim();
        const datePart = bookData.slotLabel.split(' at ')[0]?.trim();
        slot = lockedSlots.find(s => s.label.includes(datePart) && s.label.includes(timePart));
        if (slot) matchMethod = 'Fuzzy Date/Time';
      }

      if (!slot && lockedSlots.length > 0) {
        slot = lockedSlots[0];
        matchMethod = 'Last Resort [0]';
      }

      if (slot) {
        console.log(`📌 Booking: \${slot.label} | start: \${slot.start} | method: \${matchMethod}`);
        await bookAppointment({
          name: bookData.name, email: bookData.email, company: bookData.company,
          notes: bookData.notes, slotStart: slot.start, slotEnd: slot.end, slotLabel: slot.label.replace(/\s*\[start:[^\]]+\]/g, '').trim()
        });
        conversationSlots.delete(convId);
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

app.listen(port, () => console.log(`Server running on \${port}`));
