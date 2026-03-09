# FIX19 — Fix "View Calendar Event" link opening blank new event form

## Problem
The "View Calendar Event" button in Danny's notification email opens a blank Google Calendar create-event form (`/r/eventedit`) instead of the actual booked event. This happens because `eventHtmlLink` is either null or not being set correctly.

## Root Cause
`eventData.htmlLink` returns a URL like `https://www.google.com/calendar/event?eid=XXXXX` which is the correct direct link to the event. But it's not being passed into the Danny email properly.

## Fix

In the `bookAppointment` function in `server.js`, find where `dannyHtml` email is built and replace the "View Calendar Event" button href.

Change the View Calendar Event button from using `eventHtmlLink` (which can be null) to a guaranteed working URL built from the event ID:

After the event is created, build a direct event URL:
```js
const directEventUrl = eventData?.id 
  ? `https://calendar.google.com/calendar/r/eventedit?eid=${Buffer.from(eventData.id).toString('base64')}`
  : eventHtmlLink || 'https://calendar.google.com/calendar/r';
```

Actually simpler fix: just use `eventHtmlLink` but ensure it's logged and passed. The real issue may be that `eventHtmlLink` is set correctly but the email template is using the wrong variable.

## Actual Fix
Search for where the Danny email HTML is constructed. Find the "View Calendar Event" anchor tag. Make sure it uses `${eventHtmlLink}` not a hardcoded fallback.

Also add this fallback: if `eventHtmlLink` is null, build the URL as:
```js
const calLink = eventHtmlLink || `https://calendar.google.com/calendar/r/search?q=${encodeURIComponent(name)}`;
```

Use `calLink` in the Danny email button href.
