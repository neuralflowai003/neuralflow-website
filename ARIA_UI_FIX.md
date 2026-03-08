Fix two display bugs in server.js in the NeuralFlowAI ARIA booking system.

---

BUG 1 — WRONG DAY FOR WEEKEND DETECTION

The weekend check is incorrectly identifying days. March 29 2026 is a Sunday but the code said "March 29th is a Saturday". The day-of-week calculation is off.

FIX: When checking if a date is a weekend, parse the date correctly in local time. Use this approach:
  const d = new Date(searchFromDate + 'T12:00:00');
  const dow = d.getDay(); // 0=Sunday, 6=Saturday

Do not use UTC date methods (getUTCDay) for this check — they can be off by one day depending on timezone. Use getDay() with a noon local time to ensure the correct calendar date.

---

BUG 2 — **SLOT 1:** MARKDOWN SHOWING RAW IN CHAT

ARIA is outputting "**SLOT 1:**" with asterisks that render as raw markdown in the chat widget instead of being stripped. The chat widget does not render markdown.

FIX: In the system prompt, change the slot list format from:
  **SLOT 1:** Tuesday, Mar 10 at 10:00 AM EDT

To plain text with no markdown:
  1. Tuesday, Mar 10 at 10:00 AM EDT [start:...]
  2. Wednesday, Mar 11 at 9:00 AM EDT [start:...]

And update the instruction to ARIA accordingly — tell it to present slots as a numbered list with no bold, no asterisks, no markdown formatting of any kind.

Also after getting Claude's reply, add a post-processing step to strip any remaining markdown asterisks from slot lines:
  reply = reply.replace(/\*\*(SLOT\s*\d+:?\*?\*?)/gi, '$1').replace(/\*\*/g, '')

---

BUG 3 — MARKDOWN RENDERING THROUGHOUT CHAT

The chat widget does not render markdown. Any bold (**text**), italic (*text*), headers (## text), or bullet asterisks (* item) show as raw symbols to the user.

FIX: After every Claude response, strip all markdown formatting before sending to the client:
  reply = reply.replace(/\*\*(.*?)\*\*/g, '$1')  // bold
  reply = reply.replace(/\*(.*?)\*/g, '$1')       // italic
  reply = reply.replace(/^#{1,6}\s+/gm, '')       // headers
  reply = reply.replace(/^\*\s+/gm, '• ')         // bullet asterisks → bullet dots

Also add this instruction to the ARIA system prompt: "Do not use any markdown formatting — no asterisks, no bold, no headers, no bullet asterisks. Use plain text only. For lists use numbers (1. 2. 3.) or dashes (-)."

---

BUG 4 — USER ASKS FOR A DATE THAT HAS ALREADY PASSED

If a user asks for a date in the past (e.g. "March 1st" when today is March 4th), ARIA currently shows CALENDAR UNAVAILABLE which is confusing.

FIX: In the date detection logic, after calculating searchFromDate, check if that date is before today. If it is, do not use it as searchFromDate. Instead set searchFromDate to null (fetch default upcoming slots) and add a note to the slotsText injected into the system prompt:

  "NOTE: The client asked for a date that has already passed. Tell them: 'That date has already passed — here are the next available times:' then show the upcoming slots."

---

IMPROVEMENT 5 — SERVER-SIDE EMAIL GATE: DON'T SHOW SLOTS UNTIL EMAIL IS COLLECTED

ARIA sometimes rushes and shows available slots before collecting the client's name, email, and company. This means bookings can happen without contact info.

FIX: Before injecting the slot list into the system prompt, scan the full conversation history for an email address pattern (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/). If no email is found in any user message, replace the slot list with this note instead:

  "GATE: Do not show any available times yet. You must first collect the client's Full Name, Email, and Company before showing slots. You have not collected their email address yet."

Only show the real slot list once an email address has been detected in the conversation history. This is enforced server-side — ARIA cannot bypass it.

---

IMPROVEMENT 6 — GRACEFUL CALENDAR FALLBACK

If getAvailableSlots() returns null (Google Calendar API is down or auth failed), instead of the current CALENDAR UNAVAILABLE message that makes ARIA go silent, inject this into the system prompt:

  "CALENDAR OFFLINE: Our scheduling system is briefly unavailable. Tell the client warmly: 'Our scheduling system is having a brief hiccup — no worries! Can I grab your email address and I'll personally send you a few available times within the hour?' Then collect their email and note their preferred timeframe. End with: 'Perfect, I'll have Danny reach out to you shortly with available times.'"

This keeps the conversation warm and still captures the lead even when the calendar is down.

---

IMPROVEMENT 7 — MINIMUM 24-HOUR BOOKING BUFFER

If a client tries to book a slot that is less than 24 hours from now, ARIA should not offer it.

FIX: In getAvailableSlots(), when filtering slots, change the check from:
  slotStart > new Date()
To:
  slotStart > new Date(Date.now() + 24 * 60 * 60 * 1000)

This ensures all slots shown are at least 24 hours in the future, giving Danny time to prepare.

Also add this instruction to the ARIA system prompt:
"BOOKING BUFFER: Never book or offer any time slot that is less than 24 hours from now. If a client asks for today or tomorrow very soon, say: 'I want to make sure Danny has time to prepare for your call — here are the next available times:' and show slots starting from tomorrow or later."

---

Do not change anything else. Verify syntax before finishing.
