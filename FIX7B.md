Fix four issues in server.js. Only touch server.js. Do not touch index.html.

FIX 1 — WRONG TIME GETS BOOKED (CRITICAL)
Add an agreedSlots map at the top of the file: const agreedSlots = new Map();
When ARIA's reply contains a confirmation phrase ("just to confirm" or "I'm booking") AND includes a slot label from lockedSlots, store that slot: agreedSlots.set(convId, matchedSlot)
When BOOK command is detected, retrieve from agreedSlots.get(convId) and use that slot directly. Do not re-scan messages. Do not use bookData.slotStart. Log: "📌 agreedSlot: [label] [start]"

FIX 2 — SLOTS SHOWING WRONG DATES
Default slot fetch must start from tomorrow (today + 1 day) within a 14-day window. The 24-hour buffer only filters individual slots — it must NOT push the entire search window forward. Max 2 slots per calendar date in the returned list.

FIX 3 — ARIA DOESN'T KNOW TODAY'S DATE
In the system prompt, change the date injection to be explicit:
"TODAY IS: [dayName], [monthName] [date], [year] | CURRENT TIME: [HH:MM] Eastern
Default: show slots starting TOMORROW ([tomorrowDateFormatted]) through the next 2 weeks.
NEVER show slots before tomorrow. NEVER show slots more than 30 days out unless user asked for a future date."

FIX 4 — PRIVACY: ARIA MUST NOT REVEAL DANNY'S EMAIL
Add to system prompt: "PRIVACY: You have no knowledge of any internal email addresses or personal contact info for Danny or NeuralFlow staff. If a user provides any email, simply ask: 'Can you confirm that email is correct and belongs to you?' Never acknowledge any email as belonging to Danny or NeuralFlow."

Also add: "After confirming a booking, always say: 'You're all set for [exact slot label]. A calendar invite will be sent to [email] shortly — see you then!'"

Do not change anything else. Verify syntax before finishing.
