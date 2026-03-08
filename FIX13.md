Fix the mobile chat widget experience in index.html. Only touch index.html. Do not touch server.js. Do not change desktop styles (min-width: 769px).

GOAL: On mobile, when the chat opens it should feel like a native app — full screen, messages scroll independently, keyboard doesn't block anything.

FIX 1 — FULL SCREEN ON MOBILE WHEN CHAT OPENS
When the chat window opens on mobile (screen width <= 768px), make it take up the full screen:
  position: fixed
  top: 0
  left: 0
  right: 0
  bottom: 0
  width: 100%
  height: 100dvh  /* dynamic viewport height — shrinks when keyboard appears */
  border-radius: 0
  z-index: 99999

FIX 2 — LOCK PAGE SCROLL WHEN CHAT IS OPEN ON MOBILE
When chat opens on mobile, add overflow: hidden to document.body so the page behind doesn't scroll.
When chat closes on mobile, remove it.
Only do this on mobile (window.innerWidth <= 768).

FIX 3 — MESSAGES AREA FILLS REMAINING SPACE
The chat layout must be a flex column filling full height:
  .chat-window: display flex, flex-direction column, height 100%
  .chat-messages: flex 1, overflow-y auto, -webkit-overflow-scrolling touch
  .chat-input-area: flex-shrink 0

This ensures messages fill the space above the input and scroll independently.

FIX 4 — INPUT STAYS ABOVE KEYBOARD
Use height: 100dvh on the chat window. Dynamic viewport height (dvh) automatically accounts for the iOS keyboard — it shrinks the available height when the keyboard appears, so the input naturally stays above it without any JavaScript viewport listeners needed.

Also add to the input area: padding-bottom: env(safe-area-inset-bottom, 8px) to handle iPhone notch/home bar.

FIX 5 — SCROLL TO BOTTOM WHEN NEW MESSAGE ARRIVES
After each new message is added, call chatMessages.scrollTop = chatMessages.scrollHeight to keep the latest message visible.

Do not change desktop layout. Do not change the expand button. Verify syntax before finishing.
