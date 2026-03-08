Fix a performance problem in server.js in the NeuralFlowAI ARIA booking system. Response time is 6-12 seconds because getAvailableSlots() calls await oauth2Client.getAccessToken() and hits Google's API on every single chat message.

---

FIX 1 — BACKGROUND SLOT CACHE (warm on startup, refresh every 2 minutes)

Add a module-level slot cache that runs independently of conversations:

  let globalSlotCache = null;
  let globalSlotCacheUpdatedAt = 0;

On server startup, immediately fetch and populate this cache:
  async function refreshGlobalSlotCache() {
    try {
      const slots = await getAvailableSlots(7, null);
      if (slots && slots.length > 0) {
        globalSlotCache = slots;
        globalSlotCacheUpdatedAt = Date.now();
        console.log('✅ Global slot cache refreshed:', slots.length, 'slots');
      }
    } catch (e) {
      console.error('⚠️ Global cache refresh failed:', e.message);
    }
  }
  refreshGlobalSlotCache(); // run on startup
  setInterval(refreshGlobalSlotCache, 2 * 60 * 1000); // refresh every 2 minutes

---

FIX 2 — USE GLOBAL CACHE IN /api/chat (never hit Google per-message)

In the /api/chat slot logic, change the strategy to:

1. If the conversation already has cached slots (conversationSlots Map) AND they cover the requested date → use them (no Google call)
2. If the user asked for a SPECIFIC date not in the conversation cache → call getAvailableSlots() for that specific date only (this is the only time a live Google call happens mid-conversation)
3. For ALL other cases (default slots, "next week", "next month", vague months) → use globalSlotCache instead of calling getAvailableSlots() live
4. When using globalSlotCache, store the relevant slots in conversationSlots for that convId as usual

This means Google Calendar is only called:
- Every 2 minutes in the background (not blocking any user request)
- When a user asks for a very specific date not covered by the global cache

---

FIX 3 — CACHE THE OAUTH ACCESS TOKEN

Add a module-level token cache so getAvailableSlots() doesn't refresh the token on every call:

  let cachedAccessToken = null;
  let tokenExpiresAt = 0;

At the start of getAvailableSlots(), replace any getAccessToken() call with:
  if (!cachedAccessToken || Date.now() > tokenExpiresAt - 60000) {
    const result = await oauth2Client.getAccessToken();
    cachedAccessToken = result.token;
    tokenExpiresAt = result.res?.data?.expiry_date || (Date.now() + 3500000);
  }

---

FIX 4 — REMOVE THE 3-SECOND RETRY DELAY

Remove the retry logic that waits 3 seconds when slots come back empty. The background cache in Fix 1 handles this — if the global cache is populated, slots will always be available. If the cache is somehow empty, show CALENDAR UNAVAILABLE immediately without waiting.

---

FIX 5 — STRIP [start:...] TAGS FROM slotLabel BEFORE SENDING EMAILS

The client confirmation email is showing "[start:2026-03-25T13:00:00.000Z]" after the time because the slot label stored in the cache contains the embedded ISO tag.

In bookAppointment(), before using slotLabel anywhere (email subject, email body, calendar description), strip the tag:
  slotLabel = slotLabel.replace(/\s*\[start:[^\]]+\]/g, '').trim();

Do this at the very top of bookAppointment() so it's clean everywhere it's used.

Also in getAvailableSlots(), do NOT include the [start:...] tag in the slot.label string. The label should only be the human-readable text like "Wednesday, Mar 25 at 9:00 AM EDT". Store the ISO time only in slot.start — that's what it's there for. The [start:...] tag should only be added when building the slotsText for the ARIA system prompt, not stored permanently in the slot object.

---

FIX 6 — PRE-WARM ON FIRST CHAT MESSAGE

If globalSlotCache is null or empty when a user sends their first message (e.g. server just restarted and the 2-minute interval hasn't fired yet), immediately call refreshGlobalSlotCache() and await it before proceeding. This ensures the very first user on a freshly deployed server still gets slots without waiting up to 2 minutes.

Only do this await if globalSlotCache is null or empty — do not await it on subsequent messages.

---

FIX 7 — LOG CACHE HITS VS LIVE FETCHES

Add clear console.log statements so Railway logs show exactly what's happening:

- When using global cache: console.log('📦 Using global slot cache:', globalSlotCache.length, 'slots, age:', Math.round((Date.now() - globalSlotCacheUpdatedAt) / 1000), 'sec')
- When doing a live fetch for a specific date: console.log('🔍 Live fetch for specific date:', searchFromDate)
- When refreshGlobalSlotCache runs: console.log('🔄 Background cache refresh — slots:', slots.length)
- When a booking happens: console.log('📌 Booking confirmed:', slot.label, '| method:', matchMethod)

---

FIX 8 — BETTER CALENDAR EVENT DESCRIPTION

Change the Google Calendar event description from the current plain format to a structured sales brief that Danny can read before the call. Format it like this:

  🧑 LEAD
  Name: [Full Name]
  Email: [email]
  Company: [Company]

  🎯 WHAT THEY WANT
  [what they want — first part of notes before the | pipe]

  ⚠️ PAIN POINTS
  [pain points — second part of notes after the | pipe]

  💰 RECOMMENDED PRICING (AI-generated based on their pain points)
  Implementation: $[X,XXX] one-time setup
  Monthly Retainer: $[XXX]/mo
  Estimated ROI: [X]x return within [timeframe] based on [reasoning]

  📋 PREP NOTES
  - Review their industry and look for relevant NeuralFlow case studies
  - Come with 2-3 specific automation ideas for their use case
  - Be ready to discuss timeline and next steps

  🤖 Booked via ARIA | neuralflowai.io

For the RECOMMENDED PRICING section, use a second Claude API call (claude-haiku-4-5, max_tokens 200) with this prompt:

"Based on this lead's pain points and company, recommend:
1. A one-time implementation price (range $2,500–$15,000 based on complexity)
2. A monthly retainer (range $297–$997/mo based on ongoing support needed)
3. Estimated ROI: how much time/money they could save per month and how long until they break even

Pain points: [pain points]
Company: [company]
What they want: [what they want]

Reply in this exact format:
Implementation: $X,XXX
Monthly: $XXX/mo
ROI: [1-2 sentence estimate of time/money saved and break-even point]"

Use the response to fill in the RECOMMENDED PRICING section of the calendar description. If the Claude call fails for any reason, omit the pricing section gracefully — do not let it block the booking.

This gives Danny a proper sales brief to review before every call instead of a single line of raw text.

---

Do not change anything else. Verify syntax before finishing.
