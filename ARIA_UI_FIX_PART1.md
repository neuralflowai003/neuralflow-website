Fix display bugs in server.js in the NeuralFlowAI ARIA booking system. Make exactly these 4 changes and nothing else.

BUG 1 — WRONG DAY FOR WEEKEND DETECTION
The weekend check is off by one day. Fix: use getDay() with noon local time, not getUTCDay():
  const d = new Date(searchFromDate + 'T12:00:00');
  const dow = d.getDay(); // 0=Sunday, 6=Saturday

BUG 2 — MARKDOWN IN SLOT LIST
ARIA outputs "**SLOT 1:**" with asterisks. Fix: change slot list in system prompt to plain numbered format with no markdown:
  1. Tuesday, Mar 10 at 10:00 AM EDT [start:...]
  2. Wednesday, Mar 11 at 9:00 AM EDT [start:...]
Tell ARIA in the prompt: "Use plain text only — no asterisks, no bold, no markdown."

BUG 3 — STRIP ALL MARKDOWN FROM REPLIES
After every Claude response, strip markdown before sending to client:
  reply = reply.replace(/\*\*(.*?)\*\*/g, '$1')
  reply = reply.replace(/\*(.*?)\*/g, '$1')
  reply = reply.replace(/^#{1,6}\s+/gm, '')
  reply = reply.replace(/^\*\s+/gm, '- ')

BUG 4 — PAST DATE HANDLING
If searchFromDate is before today, set it to null and add to slotsText: "NOTE: Client asked for a past date. Tell them: 'That date has already passed — here are the next available times:'"

Do not change anything else. Verify syntax before finishing.
