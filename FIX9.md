Fix the mobile chat widget layout in index.html. Only touch index.html. Do not touch server.js.

The recent changes broke the mobile chat widget — it's now covering the page content by default. The chat widget should be hidden until the user clicks the chat button, same as before.

FIX 1 — REVERT BAD MOBILE CHAT CSS
Find any mobile media query CSS that was recently added for .chat-widget with position:fixed, top:10px, left:5px, right:5px — remove it entirely. The chat widget default state on mobile should be the same as desktop: hidden until opened, then appears as a small popup in the bottom-right corner.

FIX 2 — MOBILE CHAT WHEN OPEN (NOT EXPANDED)
When the chat widget is open (visible) on mobile, it should appear as a popup in the bottom-right, same as desktop but slightly wider:
@media (max-width: 768px) {
  .chat-widget.chat-open {
    width: calc(100vw - 20px) !important;
    right: 10px !important;
    left: 10px !important;
    bottom: 80px !important;
    max-height: 65vh !important;
  }
}

FIX 3 — KEYBOARD HANDLING
Keep the visualViewport resize listener but only apply it when the chat widget is open:
  window.visualViewport.addEventListener('resize', () => {
    const chatWidget = document.querySelector('.chat-widget');
    if (!chatWidget || !chatWidget.classList.contains('chat-open')) return;
    if (window.innerWidth <= 768) {
      const viewportHeight = window.visualViewport.height;
      chatWidget.style.maxHeight = (viewportHeight - 100) + 'px';
    }
  });

Do not change expanded mode (.chat-expanded). Do not change desktop styles. Verify syntax before finishing.
