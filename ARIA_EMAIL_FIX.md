Fix critical bugs in server.js in the NeuralFlowAI ARIA booking system.

---

THE CORE REQUIREMENT:
When a client agrees to a specific date and time (e.g. Wednesday March 25th at 2:00 PM EDT), that exact month, date, and time must appear identically in:
1. The client's confirmation email
2. Danny's notification email
3. The Google Calendar event

---

FIX 1 — USE slot.label NOT bookData.slotLabel IN EMAILS

In the /api/chat BOOK command parser, change the bookAppointment() call to always use the matched slot object's own label:

Change from:
  slotLabel: bookData.slotLabel
To:
  slotLabel: slot.label

Also verify inside bookAppointment() that the Google Calendar event description, the client email, and Danny's email all display the same slotLabel parameter. Fix any that reference a different variable.

---

FIX 2 — SERVER-SIDE SLOT CONFIRMATION (do not trust BOOK command for slot selection)

The BOOK command from Claude can hallucinate the wrong slot label or ISO time, especially in longer conversations. Instead of relying on what Claude puts in BOOK, determine the correct slot server-side.

When a BOOK command is detected, do the following:
1. Scan the last 6 assistant messages in the conversation history for any text matching a slot label from the current conversationSlots cache (format: "Weekday, Mon D at H:MM AM/PM EDT/EST")
2. The most recently mentioned slot label that exists in the cache is the agreed slot
3. Use that slot for booking — ignore the slotLabel and slotStart in the BOOK command entirely for slot selection purposes (still use name, email, company, notes from BOOK command)
4. Only fall back to BOOK command slot data if no matching label is found in recent assistant messages

This means: what ARIA actually said to the client in chat is what gets booked — not what Claude puts in the BOOK JSON.

---

FIX 3 — ALWAYS FETCH FRESH SLOTS AT BOOKING TIME

The slot cache can become stale during a long conversation, causing the wrong ISO times to be used. At the moment a BOOK command is detected, always re-fetch that specific slot from Google Calendar to confirm it is still available and get the authoritative ISO start/end times.

Do this:
1. When BOOK command is detected and slot is matched by label from recent messages
2. Extract the date from the slot label (e.g. "Mar 25")
3. Call getAvailableSlots(1, searchFromDate) for that specific date to get a fresh list
4. Find the matching slot in the fresh list by label
5. Use the fresh slot's start/end ISO times for the calendar event
6. If the slot is no longer available (someone else booked it), have ARIA apologize and offer the next available time instead of double-booking

This guarantees the calendar event always uses live, authoritative times from Google Calendar — never stale cache.

---

FIX 4 — CACHE REFRESH STRATEGY

Change the slot cache behavior:
- Keep the cache for showing slots during conversation (so the user sees consistent options)
- BUT: set cache expiry to 10 minutes instead of 30 (slots can fill up fast)
- AND: always re-fetch at booking time as described in Fix 3 above
- AND: after a successful booking, immediately delete that conversation's cache entry so follow-up messages get fresh slots

---

Do not change anything else. Verify syntax before finishing.
