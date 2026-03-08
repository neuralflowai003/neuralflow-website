Fix the slot availability window in server.js. Only touch server.js. Do not touch index.html.

PROBLEM: When a user asks for a specific date like "April 15th", ARIA says "I don't have April 15th on the calendar yet" because the slot fetch only looks 14 days out. April 15 is 42 days away and is not in the cache.

FIX 1 — EXTEND DEFAULT GLOBAL CACHE TO 90 DAYS
Change the global slot cache refresh to fetch 90 days of availability instead of 7 or 14. This ensures ARIA always has slots available for any date within 90 days without needing a live fetch.

Change refreshGlobalSlotCache() to call getAvailableSlots(90, null) instead of getAvailableSlots(7, null).

FIX 2 — WHEN USER REQUESTS A SPECIFIC DATE, FETCH THAT DATE LIVE
When searchFromDate is detected (user named a specific date like "April 15th"), always do a live fetch for that date with daysWindow=3. Do not rely on the global cache for specific date requests. If the live fetch returns slots, show those. If no slots on that exact date, show the nearest available slots within 7 days of that date and say "I don't have availability on April 15th, but here are the closest times:"

FIX 3 — NEVER SAY "I DON'T HAVE IT ON THE CALENDAR YET"
Add to the ARIA system prompt: "NEVER tell a client you don't have a date on the calendar or that you can't check a date. If no slots are available on a requested date, say: 'I don't have any openings on that day — here are the closest available times:' and show alternatives. Always show alternatives, never leave the client without options."

FIX 4 — WEEKEND DATE REDIRECT FOR SPECIFIC DATE REQUESTS
When a user requests a specific date that falls on a Saturday or Sunday, do not say "no availability." Instead:
- Detect the day of week using new Date(dateStr + 'T12:00:00').getDay()
- If Saturday (6): automatically advance to the following Monday
- If Sunday (0): automatically advance to the following Monday
- Set searchFromDate to that Monday and fetch slots for it
- Add to slotsText: "NOTE: [original date] is a weekend. Tell the client: 'We don't have weekend availability — here are the closest times starting Monday [date]:'"

This must work correctly for dates in any month or year, not just the current week.

Do not change anything else. Verify syntax before finishing.
