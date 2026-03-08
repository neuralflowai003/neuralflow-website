You are the Lead Automation Architect at NeuralFlowAI. You are doing a complete, clean rewrite of ARIA — an AI booking agent that converts website visitors into confirmed consulting consultations on Danny's Google Calendar.

This is a rewrite of an existing Node.js/Express project. The project folder is neuralflow-tracker. Rewrite server.js completely from scratch. Do not touch index.html except for one change: in the chat widget JS, find where the /api/chat fetch is called and add clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone to the request body.

---

ENVIRONMENT (already set in Railway and .env):
- ANTHROPIC_API_KEY — use model claude-haiku-4-5
- OPENROUTER_API_KEY — fallback if Anthropic fails, model anthropic/claude-haiku-4-5:beta
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN — OAuth2 (do NOT use service account)
- RESEND_API_KEY — use Resend HTTP API for all emails (Railway blocks SMTP)
- GMAIL_USER = danny@neuralflowai.io
- PORT — use process.env.PORT || 8080

---

SECTION 1 — DST-AWARE TIMEZONE

Write a helper function getNYOffset(date) that returns { hours, abbr } where:
- EDT (hours: 4, abbr: "EDT") applies from the 2nd Sunday of March through the 1st Sunday of November
- EST (hours: 5, abbr: "EST") applies the rest of the year
Use UTC date math only. Never hardcode the offset.

---

SECTION 2 — SLOT FETCHING: getAvailableSlots(daysWindow, startFromDate)

- Call Google Calendar freebusy API for the window
- Generate Monday–Friday slots at hours 9, 10, 11, 13, 14, 15, 16 Eastern Time
- For each day, call getNYOffset once and reuse it for all hours that day
- Skip any slot that is in the past or overlaps a busy block
- Return up to 6 slots, each as: { label, start, end }
- label format: "Tuesday, Mar 10 at 10:00 AM EDT" — exact, never relative
- start and end are ISO UTC strings
- When startFromDate is given: start the loop at i=0 (that exact date), set daysWindow=1 for specific dates
- When startFromDate is null: start the loop at i=1 (tomorrow)

---

SECTION 3 — CONVERSATION SLOT CACHE

- In-memory Map called conversationSlots
- Key: conversationId (UUID sent from frontend on every request)
- Value: { slots, fetchedAt }
- Expire entries after 30 minutes using setInterval
- Cache-first logic:
  - If cache exists AND the requested date is covered (any slot's start begins with searchFromDate) → reuse cache
  - If cache is empty OR date not covered → fetch fresh and update cache
  - Confirmation messages ("yes", "that works", "sounds good") with no date → always reuse cache
- No slot reservation system

---

SECTION 4 — DATE DETECTION IN /api/chat

Use regex only to detect WHAT date range to fetch. Never use regex to decide which slot to book — Claude handles that.

Parse lastUserMsg (lowercased last user message) for these patterns:
- "next week" → searchFromDate = today + 7 days, daysWindow = 7
- "next month" → searchFromDate = 1st of next month, daysWindow = 14
- "couple weeks" / "few weeks" → searchFromDate = today + 14 days, daysWindow = 7
- "in N weeks" → searchFromDate = today + N*7 days, daysWindow = 7
- "in N months" → searchFromDate = today + N months, daysWindow = 14
- Specific date like "March 10", "March 10th", "the 10th", "10th" → searchFromDate = that exact date, daysWindow = 1
- Vague month like "sometime in April", "April works" → searchFromDate = 1st of that month, daysWindow = 14
- IMPORTANT: bare numbers like "at 2", "10am", "2pm" must NOT trigger date detection. Only trigger when a month name OR ordinal suffix (st/nd/rd/th) is present.

---

SECTION 5 — ARIA SYSTEM PROMPT

Inject this into every /api/chat call. Replace {nowEastern}, {slotsText}, and {tzNote} dynamically:

You are ARIA, the AI receptionist for NeuralFlow — a B2B AI consulting and automation company at neuralflowai.io. Danny Boehmer is the founder.

CURRENT DATE & TIME: {nowEastern} Eastern Time
NEVER suggest or book any time that is in the past.

CONVERSATION FLOW — follow this order exactly:
1. Greet warmly, ask what brings them to NeuralFlow
2. Ask 2–3 qualifying questions to understand their business needs
3. Collect in order: Full Name → Email → Company name
4. ONLY after collecting all three AND understanding their pain points — present available slots
5. When they confirm a slot — output the BOOK command immediately

SLOT RULES:
- Copy slot labels EXACTLY character-for-character from the list below — no changes whatsoever
- Never reformat times. "10:00 AM - 11:00 AM ET" is wrong. "tomorrow" is wrong. Copy the label verbatim.
- If the client asks for a time NOT in the list, that time is already booked. Say: "That time's taken — here's what's still open:" then list the available slots
- Never say a whole day is unavailable if there are slots listed for that day
- Never invent or add slots that are not in the list
{tzNote}

ON CONFIRMATION — output this immediately, no delays:
BOOK:{"slotLabel":"EXACT label copied from slot list","slotIndex":N,"name":"Full Name","email":"email@example.com","company":"Company Name","notes":"what they want | pain points"}
Then say: "Perfect! Booking that now — you'll get a calendar invite at [email] shortly!"

Keep replies to 2–3 sentences. Be warm and professional.
NEVER mention pricing, costs, or rates under any circumstances.

{slotsText}

---

Where slotsText is:
- If slots available: "AVAILABLE SLOTS:\nSLOT 1: [label]\nSLOT 2: [label]..." etc.
- If no slots: "CALENDAR UNAVAILABLE: Do NOT invent times. Tell the client: 'Let me check Danny's calendar — can I get your email so we can confirm a time?'"

Where tzNote is (only if clientTimezone was sent):
- "When confirming a slot, tell the client: 'I've found a time at [Time] [clientTimezone]. Should I send the invite to [Email]?'"

---

SECTION 6 — SLOT LABEL ENFORCER

After every Claude response, if the reply contains AM or PM, enforce exact slot labels:
- Find any line matching "N. <anything with AM or PM>" and replace with "N. [slots[N-1].label]"
- Find any line matching "- <anything with AM or PM>" and replace with "- [slots[bulletIndex].label]"
This prevents ARIA from reformatting labels in its own style.

---

SECTION 7 — BOOK COMMAND PARSER

When reply contains BOOK:{...}:
1. Parse the JSON
2. Get lockedSlots from conversationSlots.get(convId)?.slots
3. Find the correct slot using this priority order:
   a. Exact match: lockedSlots.find(s => s.label === slotLabel)
   b. Fuzzy: strip " EDT" or " EST" from both sides and compare
   c. Fuzzy: check if label contains both the date part and time part from slotLabel
   d. Index fallback: lockedSlots[slotIndex - 1] (slotIndex is 1-based)
   e. Last resort: lockedSlots[0]
4. Log: "Booking: [slot.label] | UTC: [slot.start]"
5. Call bookAppointment() with the matched slot
6. Strip the BOOK:{...} from reply before returning
7. Return { reply, booked: true }

---

SECTION 8 — bookAppointment({ name, email, company, slotStart, slotEnd, slotLabel, notes })

Google Calendar event:
- summary: "Consultation: [name] ([company]) x NeuralFlowAI"
- description: "Company: [company]\nPain Points: [notes]\nBooked via ARIA."
- start: { dateTime: slotStart, timeZone: "America/New_York" }
- end: { dateTime: slotEnd, timeZone: "America/New_York" }
- attendees: [{ email: GMAIL_USER }] — Danny only, never add the client
- sendUpdates: "none" — we send our own emails
- conferenceData with hangoutsMeet createRequest
- conferenceDataVersion: 1
- Retry up to 3 times with delays of 2s, 4s, 8s
- Wrap in a 5 second Promise.race timeout per attempt

Client email via Resend (clean — no pain points visible to client):
- from: "Danny @ NeuralFlow <danny@neuralflowai.io>"
- to: client email
- subject: "Your NeuralFlow Consultation is Confirmed ✅"
- Dark branded HTML: show name, slotLabel, duration (1 hour), Google Meet link if available
- If no Meet link yet, show "Link coming shortly"

Danny notification email via Resend (full details):
- from: "NeuralFlow ARIA <danny@neuralflowai.io>"
- to: GMAIL_USER
- subject: "🔥 New Booking — [name] ([company])"
- Show: name, email, company, slotLabel, what they want, pain points, Meet link

---

SECTION 9 — AI CALL WITH FALLBACK

Try Anthropic first:
- model: claude-haiku-4-5
- max_tokens: 600
- 2 attempts with 2s delay between them

On any Anthropic failure, fall back to OpenRouter:
- model: anthropic/claude-haiku-4-5:beta
- Same max_tokens
- Headers: Authorization, Content-Type, HTTP-Referer: https://neuralflowai.io, X-Title: NeuralFlow ARIA
- Normalize response to { content: [{ text: "..." }] }

If both fail, return HTTP 500 with { error: "AI error" }.

---

SECTION 10 — OTHER ENDPOINTS (keep these exactly as they are)

GET /api/availability?date=YYYY-MM-DD — returns { slots } from getAvailableSlots
POST /api/book — calls bookAppointment directly
POST /api/contact — sends two emails (to Danny and to the contact)
GET /oauth/start and GET /oauth/callback — Google OAuth flow
OAuth redirect URI: https://neuralflowai.io/oauth/callback in production, http://localhost:8080/oauth/callback in development

---

DELIVERABLES:
1. Complete clean server.js — no leftover comments, no unused variables, no dead code
2. One-line change to index.html chat widget to send clientTimezone
3. Verify syntax is valid before finishing
4. Test mentally: user says "march 10th at 9am" (busy) → ARIA offers other times that day. User says "10am works" → correct slot booked, correct time in calendar and email.
