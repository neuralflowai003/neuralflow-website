# FIX16 — ARIA Slot Availability Fix

Edit server.js only. Make these changes:

## Change 1: Increase max slots per day from 2 to 6
Find any code that limits slots per calendar date to 2 (look for `maxPerDay`, `slotsPerDay`, or a counter that stops at 2 per date). Change that limit to 6.

## Change 2: Add instruction to ARIA system prompt
In the ARIA system prompt string, add this line:
"If a user asks for a specific time and you are unsure if it is available, say you will check rather than declaring it unavailable. Never say a day is fully booked unless you have confirmed it via calendar check. If a requested time is taken, immediately offer 2 alternative times on the same day."

## Change 3: When user requests a specific time, do a live freebusy check
In the route or function that handles BOOK or slot confirmation: if the agreedSlot is null and the user has stated a specific time on a specific date, call the Google Calendar freebusy API for that exact 30-minute window before rejecting it. If free, treat it as a valid slot and proceed to booking.

## Change 4: Round requested times to nearest 30 minutes
When parsing a user-requested time, round to the nearest 30-minute boundary (e.g. 2:15 → 2:00 or 2:30).

That is all. Only edit server.js.
