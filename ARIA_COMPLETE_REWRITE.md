You are rewriting server.js from scratch for the NeuralFlowAI ARIA booking system. This is a Node.js/Express app deployed on Railway. Do not touch index.html except to add clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone to the /api/chat fetch request body if it is not already there.

---

ENVIRONMENT VARIABLES (already set in Railway):
- ANTHROPIC_API_KEY — model: claude-haiku-4-5
- OPENROUTER_API_KEY — fallback model: anthropic/claude-haiku-4-5:beta
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN — OAuth2
- RESEND_API_KEY — all emails sent via Resend HTTP API
- GMAIL_USER = danny@neuralflowai.io
- PORT = process.env.PORT || 8080

---

SECTION 1 — SETUP

Standard Express setup: cors, express.json(), static files, serve index.html on GET /.
Google OAuth2 client using GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
On startup: call oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN }).
OAuth routes: GET /oauth/start and GET /oauth/callback (save token to google-token.json).
OAuth redirect URI: https://neuralflowai.io/oauth/callback in production, http://localhost:8080/oauth/callback in dev.
Resend client: new Resend(RESEND_API_KEY).

---

SECTION 2 — OAUTH TOKEN CACHE

Cache the access token in memory to avoid hitting Google on every request:
  let cachedAccessToken = null;
  let tokenExpiresAt = 0;

Function getAccessToken():
  if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000) {
    const result = await oauth2Client.getAccessToken();
    cachedAccessToken = result.token;
    tokenExpiresAt = result.res?.data?.expiry_date || (Date.now() + 3500000);
  }
  return cachedAccessToken;

---

SECTION 3 — DST HELPER

Function getNYOffset(date) returns { hours, abbr }:
- EDT (hours:4, abbr:"EDT"): 2nd Sunday of March through 1st Sunday of November
- EST (hours:5, abbr:"EST"): all other times
Use UTC math only. Call once per day in the slot loop.

---

SECTION 4 — SLOT FETCHING: getAvailableSlots(daysWindow, startFromDate)

1. Call getAccessToken() first
2. Query Google Calendar freebusy API for the window
3. Generate Mon-Fri slots at hours 9,10,11,13,14,15,16 Eastern Time
4. For each day call getNYOffset once, reuse for all hours
5. Skip slots less than 24 hours from now: slotStart > new Date(Date.now() + 86400000)
6. Skip slots overlapping busy blocks
7. Return up to 6 slots: { label: "Tuesday, Mar 10 at 10:00 AM EDT", start: "ISO UTC", end: "ISO UTC" }
8. Label is clean human-readable text only — no [start:...] tags in the label
9. When startFromDate given: loop starts at i=0, use daysWindow as given
10. When no startFromDate: loop starts at i=1 (tomorrow)
11. Weekend check: use new Date(dateStr + 'T12:00:00').getDay() — NOT getUTCDay()
12. Wrap freebusy query in Promise.race with 8 second timeout
13. On any error log: console.error('❌ Calendar error:', e.message, e.response?.data)

---

SECTION 5 — GLOBAL SLOT CACHE (background refresh)

  let globalSlotCache = null;
  let globalSlotCacheUpdatedAt = 0;

  async function refreshGlobalSlotCache() {
    const slots = await getAvailableSlots(7, null);
    if (slots && slots.length > 0) {
      globalSlotCache = slots;
      globalSlotCacheUpdatedAt = Date.now();
      console.log('🔄 Global cache refreshed:', slots.length, 'slots');
    }
  }

Run on startup: refreshGlobalSlotCache()
Run every 2 minutes: setInterval(refreshGlobalSlotCache, 2 * 60 * 1000)

---

SECTION 6 — CONVERSATION SLOT CACHE

  const conversationSlots = new Map(); // key: convId, value: { slots, fetchedAt }
  setInterval(() => {
    const expiry = Date.now() - 10 * 60 * 1000; // 10 min expiry
    for (const [k, v] of conversationSlots.entries()) if (v.fetchedAt < expiry) conversationSlots.delete(k);
  }, 2 * 60 * 1000);

---

SECTION 7 — bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes })

Strip [start:...] tags from slotLabel at the very top:
  slotLabel = slotLabel.replace(/\s*\[start:[^\]]+\]/g, '').trim();

Split notes into wants and pain:
  const [wants, pain] = (notes || '').split('|').map(s => s?.trim() || '—');

Generate AI pricing brief (separate Claude call, max_tokens:150, do not let failure block booking):
  Prompt: "Based on this lead, recommend implementation price ($2,500-$15,000), monthly retainer ($297-$997/mo), and estimated ROI. Pain points: [pain]. Company: [company]. What they want: [wants]. Reply in exactly this format:\nImplementation: $X,XXX\nMonthly: $XXX/mo\nROI: [one sentence]"
  Store result as pricingBrief (default to empty string if call fails).

Create Google Calendar event:
  summary: "Consultation: [name] ([company]) x NeuralFlowAI"
  description (structured sales brief):
    🧑 LEAD
    Name: [name]
    Email: [email]
    Company: [company]

    🎯 WHAT THEY WANT
    [wants]

    ⚠️ PAIN POINTS
    [pain]

    💰 RECOMMENDED PRICING
    [pricingBrief]

    📋 PREP NOTES
    - Review their industry and look for relevant NeuralFlow case studies
    - Come with 2-3 specific automation ideas for their use case
    - Be ready to discuss timeline and next steps

    🤖 Booked via ARIA | neuralflowai.io

  start: { dateTime: slotStart, timeZone: "America/New_York" }
  end: { dateTime: slotEnd, timeZone: "America/New_York" }
  attendees: [{ email: GMAIL_USER }] — Danny only, never the client
  sendUpdates: "none"
  conferenceData with hangoutsMeet createRequest, conferenceDataVersion: 1
  Retry up to 3 times: delays 2s, 4s, 8s. 5 second timeout per attempt.

Client email (clean, no pain points):
  Dark branded HTML. Show: name, slotLabel, duration (1 hour), Meet link or "Link coming shortly".

Danny notification email:
  Subject: "🔥 New Booking — [name] ([company])"
  Show all details including pain points and pricingBrief.

---

SECTION 8 — /api/chat

Parse: messages, conversationId, clientTimezone from req.body.
convId = conversationId || first 60 chars of first message || 'default'.
lastUserMsg = last user message lowercased.

DATE/TIMEFRAME DETECTION (only for deciding when to fetch, never for picking slot):
- "next week" → searchFromDate = today+7, daysWindow=7
- "next month" → searchFromDate = 1st of next month, daysWindow=14
- "couple/few weeks" or "2-3 weeks" → searchFromDate = today+14, daysWindow=7
- "in N weeks" → searchFromDate = today + N*7 days, daysWindow=7
- "in N months" → searchFromDate = today + N months, daysWindow=14
- Specific date ("March 10", "March 10th", "the 10th", "10th") → searchFromDate = that date, daysWindow=1
  IMPORTANT: only trigger when month name OR ordinal suffix (st/nd/rd/th) present. "10am" or "at 2" must NOT trigger.
- Vague month ("sometime in April") → searchFromDate = 1st of that month, daysWindow=14
- Confirmation ("yes", "that works", "sounds good") with no date → no re-fetch, use cache

After calculating searchFromDate:
- If searchFromDate is before today → set searchFromDate=null, set pastDateNote="NOTE: Client asked for a past date. Tell them: 'That date has already passed — here are the next available times:'"
- If searchFromDate is a weekend (getDay()===0 or 6 using 'T12:00:00') → advance to next Monday, set weekendNote="NOTE: Client asked for a weekend. Tell them: 'We don't have weekend availability — here are the closest times:'"

SLOT SELECTION LOGIC:
1. If conversation cache exists AND covers searchFromDate → use cache, log "📦 Cache hit"
2. Else if searchFromDate is a specific date → call getAvailableSlots(daysWindow, searchFromDate) live, log "🔍 Live fetch for: [date]"
3. Else → use globalSlotCache (no live Google call), log "📦 Global cache"
4. If globalSlotCache is null on first message → await refreshGlobalSlotCache() first
5. Store result in conversationSlots for this convId

EMAIL GATE: scan all user messages for email pattern /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  hasEmail = true if found

BUILD slotsText:
- If no slots or calendar down → use CALENDAR OFFLINE message (warm, ask for email + preferred time)
- Else if !hasEmail → "GATE: Do not show available times yet. Collect Full Name, Email, and Company first."
- Else → numbered list: "1. [slot.label] [start:slot.start]\n2. [slot.label] [start:slot.start]..." (embed ISO in [start:] tag for ARIA to copy into BOOK command)
  Include any pastDateNote or weekendNote before the slot list.

tzNote = clientTimezone ? "When confirming, say: 'I've found a time at [Time] [clientTimezone]. Should I send the invite to [Email]?'" : ""

SYSTEM PROMPT:
You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: [nowEastern] Eastern Time
NEVER suggest or book any time in the past or less than 24 hours from now.

CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2-3 qualifying questions about their business needs
3. Collect: Full Name → Email → Company name
4. ONLY after collecting all three — present available slots
5. When they pick a slot — send confirmation message first
6. After they confirm — output BOOK command immediately

SLOT RULES:
- Present slots as a plain numbered list. No asterisks, no bold, no markdown of any kind.
- Copy slot labels exactly as shown — never reformat or change them
- If client asks for a time not in the list, say: "That time is taken — here's what's still open:" and list available slots
- Never say a whole day is unavailable if slots exist for that day
- Never invent slots
[tzNote]

CONFIRMATION REQUIRED before booking:
First send: "Just to confirm — I'm booking [exact slot label] for [Full Name] at [email]. Shall I go ahead?"
Only output BOOK after client confirms with yes/correct/go ahead/book it.

ON FINAL CONFIRMATION output immediately:
BOOK:{"slotStart":"[start:value from slot]","slotLabel":"exact label","name":"Full Name","email":"email","company":"Company","notes":"what they want | pain points"}
Then: "Perfect! Booking that now — you'll get a calendar invite at [email] shortly!"

Do not use any markdown formatting. No asterisks, no bold, no headers. Plain text only.
Do not mention pricing.
[slotsText]

AI CALL: Try Anthropic (claude-haiku-4-5, max_tokens:600) twice with 2s delay. Fallback to OpenRouter (anthropic/claude-haiku-4-5:beta). If both fail return 500.

POST-PROCESSING (after getting reply):
1. Strip [start:...] tags from reply: reply.replace(/\[start:[^\]]+\]/g, '').trim()
2. Strip markdown: bold, italic, headers, bullet asterisks → dashes
3. Enforce slot labels on numbered lines (replace "N. <time>" with "N. slot[N-1].label")
4. Enforce slot labels on bullet lines

BOOK COMMAND PARSING:
When reply contains BOOK:{...}:
1. Parse JSON
2. Get lockedSlots from conversationSlots.get(convId)?.slots
3. SERVER-SIDE: scan last 6 assistant messages for slot label from lockedSlots — use that slot (most recently mentioned = agreed slot)
4. Fallback: exact ISO match slot.start === bookData.slotStart
5. Fallback: exact label match
6. Fallback: fuzzy label (strip EDT/EST)
7. Last resort: lockedSlots[0]
8. Log: "📌 Booking: [label] | method: [method]"
9. Validate email: if bookData.email doesn't match /^[^\s@]+@[^\s@]+\.[^\s@]+$/ → return error asking for valid email
10. Re-fetch that specific date from Google Calendar to confirm slot still available. If taken → apologize and offer next available.
11. Call bookAppointment() using slot.label (not bookData.slotLabel)
12. Delete conversationSlots entry after booking
13. Strip BOOK command from reply, return { reply, booked: true }

---

SECTION 9 — OTHER ENDPOINTS

GET /api/availability?date=YYYY-MM-DD → return { slots } from getAvailableSlots(90, date)
POST /api/book → call bookAppointment directly
POST /api/contact → send two emails (Danny + contact person), run in parallel with Promise.all

---

Write clean, well-organized code with section comments. No dead code, no unused variables. Verify syntax is valid before finishing.
