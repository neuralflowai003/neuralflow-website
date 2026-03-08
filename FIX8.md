Fix the hero headline on mobile in index.html. Only touch index.html. Do not touch server.js.

Find the mobile media query (max-width: 768px) that targets .hero-headline and update it to:
  font-size: clamp(1.8rem, 7vw, 2.8rem) !important;
  white-space: normal !important;
  word-break: keep-all !important;
  overflow-wrap: normal !important;
  letter-spacing: -1px !important;
  text-align: center !important;

Also inside that same mobile media query, add a rule for .line-1:
  .line-1 {
    word-break: keep-all !important;
    overflow-wrap: normal !important;
    overflow: visible !important;
    padding-right: 5px !important;
  }

ALSO fix the mobile chat widget keyboard issue in index.html:

When a user taps the input box on mobile (iOS/Android), the phone keyboard pops up and the chat widget breaks — the messages area disappears and only the input is visible.

FIX: Add a visualViewport resize listener in the chat widget JavaScript:

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const chatWidget = document.querySelector('.chat-widget');
      if (!chatWidget) return;
      if (window.innerWidth <= 768) {
        const keyboardHeight = window.innerHeight - window.visualViewport.height;
        chatWidget.style.height = (window.visualViewport.height - 20) + 'px';
        chatWidget.style.bottom = keyboardHeight > 0 ? keyboardHeight + 'px' : '';
        chatWidget.style.top = '10px';
      }
    });
  }

Also add this CSS for mobile chat widget:
@media (max-width: 768px) {
  .chat-widget {
    position: fixed !important;
    top: 10px !important;
    left: 5px !important;
    right: 5px !important;
    bottom: 80px !important;
    width: auto !important;
    max-height: none !important;
    height: calc(100vh - 90px) !important;
    border-radius: 16px !important;
  }
  .chat-messages {
    flex: 1 !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }
  .chat-input-area {
    flex-shrink: 0 !important;
    padding-bottom: env(safe-area-inset-bottom, 10px) !important;
  }
}

This keeps the full chat widget visible above the keyboard on mobile with messages scrollable and input always accessible.

Do not change desktop styles. Do not change server.js. Verify syntax before finishing.
