Fix a security issue in the ARIA system prompt in server.js. Only touch server.js. Do not touch index.html.

PROBLEM: ARIA knows Danny's personal email (dannyboehmer42@gmail.com) from the system prompt context and is revealing it to users, saying things like "that's our founder Danny's email."

FIX: Add this instruction to the ARIA system prompt:

"PRIVACY RULE: You have no knowledge of any internal email addresses, phone numbers, or personal contact info for Danny or NeuralFlow staff. If a user provides an email that happens to match an internal address, do not acknowledge it — just treat it like any other email and ask them to confirm it is their own email address. Never reference or confirm any email as belonging to Danny or NeuralFlow. Simply ask: 'Can you confirm that email address is correct and belongs to you?'"

BUG 2 — SLOTS SHOWING MAY INSTEAD OF THIS WEEK
The global slot cache and default slot fetch is returning dates in May instead of the next available days. The 24-hour buffer combined with other date logic is pushing slots too far out.

FIX:
- The default slot fetch (no date specified) should start from tomorrow (today + 1 day) and return the next 6 available Mon-Fri slots within a 14-day window
- The 24-hour buffer should only exclude slots within 24 hours of NOW — it should NOT push the entire search window forward
- The slot loop should start at i=1 (tomorrow) by default and increment day by day, returning the first 6 slots found within 14 days

BUG 3 — ARIA DOESN'T KNOW TODAY'S DATE
The system prompt already includes the current date/time but ARIA is still showing wrong dates. 

FIX: In the system prompt, make the current date/time injection more explicit:
  "TODAY IS: [full date like 'Wednesday, March 4, 2026'] | CURRENT TIME: [time] Eastern"
  "Default availability window: show slots starting TOMORROW ([tomorrow's date]) through the next 2 weeks."
  "NEVER show slots before tomorrow. NEVER show slots more than 30 days out unless the user specifically asked for a future date."

BUG 4 — WRONG TIME GETS BOOKED
The time shown to the user in chat does not match the time booked in Google Calendar. This is the most critical bug.

FIX: When the BOOK command is detected, do NOT rely on slot label matching or message scanning to find the slot. Instead:
- Store the exact slot object (including start ISO, end ISO, and label) in a per-conversation "agreedSlot" map the moment ARIA's reply contains a confirmation message that includes a slot label from the lockedSlots list
- At BOOK time, retrieve agreedSlot from the map using convId — use it directly, do not re-scan messages, do not fuzzy match, do not use bookData.slotStart
- Log: "📌 Using agreedSlot: [label] [start ISO]"
- This guarantees: time shown to user = time booked in calendar = time in email

IMPROVEMENT — MAX 2 SLOTS PER DAY
When building the slot list, never show more than 2 slots on the same calendar date. Spread availability across multiple days.

IMPROVEMENT — LEAD WITH SOONEST SLOTS
Add to ARIA system prompt: "Always present the soonest available slots first. After listing say: 'These are the next available times — if you'd prefer a different week, just let me know.'"

BUG 5 — GOOGLE CALENDAR EVENT NOT BEING CREATED
The booking goes through and emails send but no event appears in Google Calendar. The calendar API call is either failing silently or not being reached.

FIX:
- Add detailed logging around the calendar insert call: log "📅 Creating calendar event..." before the call and "✅ Event created: [event.id] | [event.htmlLink]" after
- Wrap the calendar.events.insert() call in a try/catch that logs the full error including event.response?.data
- Make sure the OAuth token is fresh before the calendar insert — call getAccessToken() immediately before calendar.events.insert(), not just at the top of bookAppointment()
- Verify calendarId is set to 'primary' (not hardcoded to a specific calendar ID that may not exist)
- Make sure conferenceDataVersion: 1 is passed as a query parameter to calendar.events.insert(), not inside the event body
- After insert, log the full event.data object so we can see what Google returned

BUG 6 — GOOGLE MEET LINK NOT EXTRACTED FROM CALENDAR RESPONSE
After creating the calendar event, the Meet link is in the response at event.data.conferenceData.entryPoints[0].uri but we're not extracting it. The client email shows "Link coming shortly" and we never send the real link.

FIX: After calendar.events.insert() returns, extract the Meet link:
  const meetLink = event.data?.conferenceData?.entryPoints?.[0]?.uri || null;
Use this meetLink in both the client email and Danny's notification email. If null, show "Google Meet link will be sent separately."

BUG 7 — NO VERIFICATION THAT CALENDAR EVENT WAS SAVED
After insert, we never confirm the event actually exists in the calendar.

FIX: After a successful insert, do a quick calendar.events.get({ calendarId: 'primary', eventId: event.data.id }) to verify. If it fails or returns 404, retry the insert once with a 2-second delay. Log "✅ Event verified in calendar" or "⚠️ Event verification failed — retrying."

BUG 5 — "VIEW CALENDAR EVENT" BUTTON LINKS TO CALENDAR HOME NOT THE EVENT
The "View Calendar Event" button in Danny's notification email links to https://calendar.google.com instead of the specific event.

FIX: After creating the Google Calendar event, grab the event ID from the API response (event.id or event.htmlLink). Use event.htmlLink directly as the "View Calendar Event" button URL — Google Calendar API returns the direct event link in the response. If htmlLink is not available, fall back to: https://calendar.google.com/calendar/r/eventedit

IMPROVEMENT — SHOW TIME IN USER'S TIMEZONE AT CONFIRMATION
When ARIA sends the confirmation message ("Just to confirm — I'm booking X..."), if clientTimezone is known, convert the slot time to the user's local timezone and include it:
"Just to confirm — I'm booking Wednesday, March 11 at 10:00 AM EST (9:00 AM your time in Chicago) for [Name] at [email]. Shall I go ahead?"

Add this instruction to the ARIA system prompt: "When confirming a booking, always state the time in Eastern Time first, then in the client's timezone in parentheses if known. Example: '10:00 AM EST (9:00 AM your time)'"

IMPROVEMENT — REPEAT TIME AFTER BOOKING CONFIRMED
Add to ARIA system prompt: "After outputting the BOOK command and confirming the booking is processing, always follow up with: 'You're all set for [exact slot label]. A calendar invite will be sent to [email] shortly — see you then!'"

BUG 8 — "JOIN GOOGLE MEET" BUTTON DOESN'T WORK IN CLIENT EMAIL
The Join Google Meet button in the client email is not linking correctly or the meetLink variable is null/undefined when the email is built.

FIX: Make sure meetLink is passed into the client email HTML builder function. The button href should be the extracted meetLink from BUG 6 fix above. If meetLink is null, show the button as greyed out with text "Meet link coming shortly" and no href.

BUG 9 — CLIENT EMAIL HAS WHITE BACKGROUND ON MOBILE
On mobile email clients, the dark background (#0a0a0f) is being overridden and showing white, making the email unreadable.

FIX: Force dark background on mobile by adding these to the email HTML:
- Add bgcolor="#0a0a0f" attribute directly on the <body> tag and the outer <table>
- Add this meta tag in <head>: <meta name="color-scheme" content="dark light">
- Add this in <style>: @media (prefers-color-scheme: light) { body, table, td { background-color: #0a0a0f !important; color: #ffffff !important; } }
- Add style="background-color:#0a0a0f !important" inline on every <td> and <table> element
- Wrap all content in a <table width="100%" bgcolor="#0a0a0f"> as the outermost container
- Add a media query for mobile: @media only screen and (max-width: 600px) { .email-container { width: 100% !important; } all font sizes slightly larger, buttons full width }

This ensures the dark theme holds on Gmail mobile, Apple Mail, and Outlook mobile.

Do not change anything else. Verify syntax before finishing.
