Fix three bugs in server.js. Only touch server.js. Do not touch index.html.

BUG 1 — GOOGLE CALENDAR EVENT NOT BEING CREATED
In bookAppointment(), add full logging and fix the calendar insert:
- Call getAccessToken() immediately before calendar.events.insert()
- Set calendarId to 'primary'
- Pass conferenceDataVersion: 1 as a query parameter: { resource: eventBody, conferenceDataVersion: 1 }
- After insert, extract meet link: const meetLink = event.data?.conferenceData?.entryPoints?.[0]?.uri || null
- Use event.data.htmlLink as the calendar event URL for the "View Calendar Event" button
- Log "📅 Creating calendar event..." before and "✅ Event created: [id] | [htmlLink]" after
- Wrap in try/catch, log full error on failure

BUG 2 — JOIN GOOGLE MEET BUTTON BROKEN IN CLIENT EMAIL
The meetLink extracted from the calendar response (event.data?.conferenceData?.entryPoints?.[0]?.uri) must be passed into the client email HTML. The "Join Google Meet" button href must use this meetLink. If null, show "Meet link coming shortly" with no href.

BUG 3 — VIEW CALENDAR EVENT BUTTON GOES TO CALENDAR HOME
In Danny's notification email, the "View Calendar Event" button must link to event.data.htmlLink (the direct event URL returned by Google Calendar API), not https://calendar.google.com.

Do not change anything else. Verify syntax before finishing.
