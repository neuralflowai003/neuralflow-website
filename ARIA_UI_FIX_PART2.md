Make exactly these 3 improvements to server.js in the NeuralFlowAI ARIA booking system. Do not change anything else.

IMPROVEMENT 1 — EMAIL GATE: DON'T SHOW SLOTS UNTIL EMAIL IS COLLECTED
Before injecting the slot list into the system prompt, scan all user messages in the conversation history for an email pattern (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/). If no email found, replace the slot list with:
  "GATE: Do not show any available times yet. You must first collect the client's Full Name, Email, and Company. You have not collected their email yet."
Only show real slots once an email is detected in the conversation.

IMPROVEMENT 2 — GRACEFUL CALENDAR FALLBACK
If getAvailableSlots() returns null, inject this instead of CALENDAR UNAVAILABLE:
  "CALENDAR OFFLINE: Tell the client warmly: 'Our scheduling system is having a brief hiccup — no worries! Can I grab your email and I'll personally send you a few available times within the hour?' Then collect their email and preferred timeframe. End with: 'Perfect, I'll have Danny reach out shortly with available times.'"

IMPROVEMENT 3 — 24-HOUR BOOKING BUFFER
In getAvailableSlots(), change the slot filter from:
  slotStart > new Date()
To:
  slotStart > new Date(Date.now() + 24 * 60 * 60 * 1000)

Also add to ARIA system prompt: "BOOKING BUFFER: Never offer any slot less than 24 hours from now. If client asks for very soon, say: 'I want to make sure Danny has time to prepare — here are the next available times:'"

Do not change anything else. Verify syntax before finishing.
