Fix four bugs in server.js. Only touch server.js. Do not touch index.html.

BUG 1 — "END OF MONTH" TRIGGERS WRONG MESSAGE
When user says "end of month" or "end of the month", the code shows "I want to make sure Danny has time to prepare" — that message is only for same-day requests. Fix: detect "end of month" / "end of the month" before the 24-hour buffer check. Set searchFromDate to the 20th of the current month (or the 20th of next month if today is past the 20th), daysWindow to 10. Skip the 24-hour buffer message for this case.

BUG 2 — FUTURE DATE REQUESTS SHOW WRONG SLOTS
When user says "in a few weeks", "couple weeks", "end of month", or any specific future date, ARIA shows near-term cached slots instead of slots for that timeframe. Fix: when searchFromDate is detected, always do a live fetch for that date range — never use the global cache. Only use global cache when no timeframe was specified.

BUG 3 — WRONG DAY OF WEEK FOR DATES
April 26 2026 is a Sunday but ARIA says Saturday. Fix: everywhere day-of-week is calculated from a YYYY-MM-DD string, use:
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sunday, 6=Saturday
Never use getUTCDay(). Always include T12:00:00 to avoid timezone off-by-one.

BUG 4 — YEAR SHOWING IN ARIA MESSAGES
Add to the ARIA system prompt: "When referring to dates, never include the year. Say 'Saturday, April 26' not 'Saturday, April 26 2026'. Always calculate the correct day of week based on the actual calendar date."

BUG 5 — MONTH-BASED DATE PHRASES NOT DETECTED
"next month", "in a few months", "in 2 months", "in 3 months", "a couple months" are not detected and fall back to showing near-term cached slots.

Fix: add detection for these phrases before the general date detection logic:
- "next month" → searchFromDate = 1st of next month, daysWindow = 14
- "in a few months" / "a couple months" / "in 2 months" → searchFromDate = today + 60 days, daysWindow = 14
- "in 3 months" → searchFromDate = today + 90 days, daysWindow = 14
- "in N months" (any number) → searchFromDate = today + N*30 days, daysWindow = 14

BUG 6 — "ANYTIME" / FLEXIBLE USER GETS NO SLOTS
When user says "anytime", "whatever works", "you pick", "flexible", "whatever is available", or "doesn't matter" — ARIA should immediately show the next 6 available slots from the global cache without asking for a date preference.

Fix: detect these phrases and set a flag: userIsFlexible = true. When userIsFlexible, skip date detection entirely, use globalSlotCache directly, and add this note to the system prompt: "USER IS FLEXIBLE: Show the next available slots immediately without asking for a date preference."

Also treat these as flexible: "what's your availability", "what's available", "when are you free", "when is Danny free", "what times do you have", "what do you have open", "show me times", "show me availability".

Do not change anything else. Verify syntax before finishing.
