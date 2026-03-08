You are fixing specific bugs and adding improvements to the NeuralFlowAI ARIA booking system in server.js.

---

BUG 1 — WRONG TIME BOOKED ON CALENDAR

When a user agrees to a time (e.g. "2pm works"), ARIA books the wrong slot (e.g. 3pm instead of 2pm). Label matching and index fallback are unreliable.

FIX: Embed the exact ISO start time in the slot list and use it as the primary booking key.

CHANGE 1A — slotsText format in system prompt:
Change slot list from:
  SLOT 1: Tuesday, Mar 10 at 10:00 AM EDT
To:
  SLOT 1: Tuesday, Mar 10 at 10:00 AM EDT [start:2026-03-10T14:00:00.000Z]

Add this instruction in the system prompt: "When outputting the BOOK command, copy the [start:...] value from the chosen slot exactly into the slotStart field."

CHANGE 1B — BOOK command format ARIA outputs:
Change from:
  BOOK:{"slotLabel":"...","slotIndex":N,"name":"...","email":"...","company":"...","notes":"..."}
To:
  BOOK:{"slotStart":"ISO_FROM_SLOT_LIST","slotLabel":"EXACT label","name":"...","email":"...","company":"...","notes":"..."}

CHANGE 1C — BOOK parser slot matching priority:
1. PRIMARY: slot.start === bookData.slotStart (exact ISO — unambiguous)
2. FALLBACK: slot.label === bookData.slotLabel (exact label)
3. FALLBACK: fuzzy label (strip EDT/EST from both and compare)
4. LAST RESORT: slots[0]
Remove slotIndex fallback entirely — it was causing off-by-one errors.

CHANGE 1D — Strip [start:...] tags from reply before sending to user:
  reply = reply.replace(/\[start:[^\]]+\]/g, '').trim()

CHANGE 1E — Log on booking:
  console.log('📌 Booking:', slot.label, '| start:', slot.start, '| method:', matchMethod)

---

BUG 2 — SLOTS NOT SHOWING UNTIL GOOGLE CALENDAR IS MANUALLY REFRESHED

Available time slots do not appear in ARIA until the user manually opens Google Calendar in a browser tab. This means the OAuth access token is expired and not being refreshed automatically.

FIX:
- In getAvailableSlots(), always call await oauth2Client.getAccessToken() at the very start of the function, before any other API calls — this forces a fresh access token every time
- Wrap the entire freebusy query in a try/catch that logs the full error: console.error('❌ freebusy failed:', e.message, e.response?.data)
- Add an 8-second timeout using Promise.race on the freebusy query so it never hangs
- If getAvailableSlots returns null or empty, retry once after 3 seconds before giving up — this handles transient token refresh failures on cold start

---

BUG 3 — ARIA MUST NEVER BOOK THE WRONG TIME

Add this rule explicitly to the ARIA system prompt inside the SCHEDULING RULES section:

"CRITICAL: The time you tell the client IS the time that will be booked. Never confirm a time verbally and then output a different slotStart in the BOOK command. The slotStart must always be the [start:...] value from the exact slot you told the client about."

---

BUG 4 — STALE SLOTS SHOWN AFTER SUCCESSFUL BOOKING

After a booking is completed, the conversation slot cache still holds the old slots. If the user tries to book again in the same chat, it shows already-booked times.

FIX: After bookAppointment() succeeds, delete the conversation's entry from conversationSlots:
  conversationSlots.delete(convId)

---

BUG 5 — NO RETRY WHEN SLOTS COME BACK EMPTY

If getAvailableSlots() returns null or an empty array on the first call (e.g. due to a cold token refresh), ARIA immediately shows the CALENDAR UNAVAILABLE message with no retry.

FIX: In /api/chat, after the first getAvailableSlots() call, if slots is null or empty, wait 3 seconds and try once more before falling back to CALENDAR UNAVAILABLE:
  if (!slots || slots.length === 0) {
    await new Promise(r => setTimeout(r, 3000));
    slots = await getAvailableSlots(daysWindow, searchFromDate);
  }

---

IMPROVEMENT 6 — WEEKEND DATE HANDLING

If a user asks for a Saturday or Sunday, ARIA currently shows CALENDAR UNAVAILABLE which is confusing.

FIX: In the date detection logic in /api/chat, after calculating searchFromDate, check if that date is a Saturday (day 6) or Sunday (day 0). If it is, advance the date to the following Monday and set a flag. Pass a note into the system prompt:

Add to slotsText when this happens:
  "NOTE: The client asked for a weekend. Slots below are for the nearest available weekday instead. Tell the client: 'We don't have weekend availability — here are the closest times:'"

---

IMPROVEMENT 7 — EXPLICIT CONFIRMATION BEFORE BOOKING

Currently ARIA books immediately when the client says something like "yes" or "that works", which can cause accidental bookings from ambiguous messages.

FIX: Add this rule to the ARIA system prompt in the SCHEDULING RULES section:

"CONFIRMATION REQUIRED: Before outputting the BOOK command, you must first send a confirmation message in this exact format:
'Just to confirm — I'm booking [exact slot label] for [Full Name] at [email address]. Shall I go ahead?'
Only output the BOOK command after the client explicitly confirms with yes, correct, go ahead, book it, or similar. Never book on an ambiguous reply."

This means the BOOK command should only fire on the message AFTER the confirmation exchange, not on the first "yes" to a slot suggestion.

---

IMPROVEMENT 8 — EMAIL VALIDATION BEFORE BOOKING

If the client provides a malformed email (missing @, missing domain, spaces, written out like "john at gmail dot com"), ARIA should not proceed to booking.

FIX: Add this rule to the ARIA system prompt in the data collection section:

"EMAIL VALIDATION: When the client gives you their email address, validate it before moving on. A valid email must contain exactly one @ symbol and at least one dot after the @. If the email looks wrong or is written out in plain language (e.g. 'john at gmail dot com'), say: 'Could you double-check that email address? I want to make sure your calendar invite reaches you.' Do not proceed to show slots or book until you have a valid email."

Also add server-side validation in the BOOK command parser: before calling bookAppointment(), check that bookData.email matches /^[^\s@]+@[^\s@]+\.[^\s@]+$/. If it does not match, log a warning and return an error reply to the user asking them to provide a valid email instead of attempting to book.

---

Do not change anything else in the file. Only make these fixes and improvements to server.js. Do not touch index.html. Verify syntax is valid before finishing.
