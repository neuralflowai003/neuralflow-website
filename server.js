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

// Session slot cache — stores slots shown to user so booking uses same list
const slotCache = new Map(); // key: session_id or first-user-msg hash

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

  // 1. Create Google Calendar event (blocking so we get the Meet link)
  let meetLink = null;
  if (process.env.GOOGLE_REFRESH_TOKEN || fs.existsSync(TOKEN_PATH)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📅 Calendar attempt ${attempt} for ${name}`);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        await oauth2Client.getAccessToken();
        const event = await calendar.events.insert({
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
                requestId: `nf-${Date.now()}-${attempt}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          },
        });
        meetLink = event.data?.hangoutLink || null;
        results.calendar = true;
        console.log(`✅ Calendar event created for ${name} — Meet: ${meetLink || 'pending'}`);
        break;
      } catch (e) {
        console.error(`❌ Calendar attempt ${attempt} failed: ${e.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  // 2. Email confirmation to lead
  try {
    await sendEmail({
      from: "Danny @ NeuralFlow <danny@neuralflowai.io>",
      to: email,
      subject: `✅ Your NeuralFlow Consultation is Confirmed!`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#ffffff;padding:0;border-radius:16px;overflow:hidden;">
          <!-- Header bar with gradient -->
          <div style="background:linear-gradient(135deg,#0a0a0f 0%,#1a1020 50%,#0a0a0f 100%);padding:40px 40px 32px;border-bottom:1px solid #FF6B1A22;">
            <h1 style="margin:0 0 28px;font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Neural<span style="color:#FF6B1A;">Flow</span></h1>
            <h2 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">Your Consultation<br/>is Confirmed</h2>
          </div>
          <!-- Body -->
          <div style="padding:32px 40px;background:#0d0d14;">
            <p style="margin:0 0 8px;font-size:15px;color:#8888a0;">Hi ${name},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#8888a0;line-height:1.6;">Your 1-hour consultation with Danny Boehmer is booked. We look forward to speaking with you.</p>
            <!-- Details card -->
            <div style="background:#13131e;border:1px solid #2a2a40;border-radius:12px;padding:24px;margin:0 0 28px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 18px;vertical-align:top;width:50%;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FF6B1A;margin-bottom:6px;">When</div>
                    <div style="font-size:15px;color:#ffffff;">${slotLabel.includes('EST') ? slotLabel : slotLabel + ' EST'}</div>
                  </td>
                  <td style="padding:0 0 18px;vertical-align:top;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FF6B1A;margin-bottom:6px;">Duration</div>
                    <div style="font-size:15px;color:#ffffff;">1 hour</div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:18px 0 0;border-top:1px solid #2a2a40;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FF6B1A;margin-bottom:8px;">Google Meet</div>
                    <a href="${meetLink || '#'}" style="display:inline-block;background:#FF6B1A;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Join Meeting →</a>
                  </td>
                </tr>
              </table>
            </div>
            <p style="margin:0;font-size:14px;color:#8888a0;">Talk soon,<br/><strong style="color:#ffffff;">Danny Boehmer</strong><br/><span style="color:#FF6B1A;">NeuralFlow</span></p>
          </div>
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
    // Use cached slots if available (ensures booking uses same slots shown to user)
    const cacheKey = messages[0]?.content?.slice(0, 50) || 'default';
    let slots;
    if (slotCache.has(cacheKey)) {
      slots = slotCache.get(cacheKey);
      console.log('📅 Using cached slots:', slots.map(s=>s.label));
    } else {
      slots = await getAvailableSlots(30, searchFromDate);
      console.log('📅 Slots returned:', slots ? slots.map(s=>s.label) : 'NULL');
      if (slots && slots.length > 0) {
        slotCache.set(cacheKey, slots);
        // Clear cache after 1 hour
        setTimeout(() => slotCache.delete(cacheKey), 60 * 60 * 1000);
      }
    }
    console.log('🔍 Slots count:', slots ? slots.length : 0, '| cacheKey:', cacheKey.slice(0,30));
    const slotsText = slots && slots.length > 0
      ? `\n\n[DANNY'S REAL AVAILABLE TIMES]\n${slots.map((s, i) => `SLOT ${i+1}: ${s.label}`).join('\n')}\n[END OF AVAILABLE TIMES]\n\nWhen showing slots to the client, copy them EXACTLY as: "SLOT 1: Wednesday, Mar 4 at 2:00 PM EST" — use the full date, never say 'tomorrow' or 'next Monday'.\n\nCRITICAL SLOT RULES:\n1. Show slot labels EXACTLY as written above — do NOT convert to relative dates like "tomorrow" or "next Monday". Show "Wednesday, Mar 4 at 2:00 PM EST" verbatim.\n2. Never invent, add, or rephrase any slot.\n3. When client picks a slot, use that EXACT slot number from the list above.\n\nWhen client picks a slot number, respond with:\nBOOK:{"slotIndex": N, "slotLabel": "EXACT label text from the slot list", "name": "Full Name", "email": "their@email.com", "company": "Company", "notes": "What they want|Pain points"}\n(N = slot number they picked, slotLabel = copied exactly from the list above)`
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

    // If ARIA listed slots, replace its reply's slot lines with exact labels from our list
    if (slots && slots.length > 0 && reply.includes('SLOT') === false) {
      // Replace any numbered list items that don't match exact slot labels
      slots.forEach((slot, i) => {
        const num = i + 1;
        // Replace patterns like "1. Tomorrow, 2:00 PM" or "1. **Tomorrow**" with exact label
        reply = reply.replace(
          new RegExp(`(^|\n)\s*${num}\. [^\n]*`, 'g'),
          (match, pre) => {
            // Only replace if this looks like a slot listing line
            if (match.match(/\d+\. .*(AM|PM|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next)/i)) {
              return `${pre}${num}. ${slot.label}`;
            }
            return match;
          }
        );
      });
    }

    // Check if ARIA wants to book
    const bookMatch = reply.match(/BOOK:(\{[^{}]*\})/);
    if (bookMatch && slots) {
      try {
        const bookData = JSON.parse(bookMatch[1]);
        // Try to match by label first (most reliable), then fall back to index
        let slot;
        if (bookData.slotLabel) {
          slot = slots.find(s => s.label === bookData.slotLabel);
        }
        if (!slot) {
          // ARIA numbers slots from 1, array is 0-based — subtract 1
          const slotIdx = Math.max(0, (bookData.slotIndex || 1) - 1);
          slot = slots[slotIdx] || slots[0];
        }
        console.log('📌 Booking slot:', slot?.label, '| Index:', bookData.slotIndex, '| Label match:', bookData.slotLabel);
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
