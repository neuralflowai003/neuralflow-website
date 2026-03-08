Add an expand/collapse button to the ARIA chat widget in index.html. Only touch index.html. Do not touch server.js.

The chat widget has a container with class "chat-widget" or similar. Add a small expand button (⛶ or ⤢ icon) in the top-right corner of the chat header, next to the close button.

When clicked:
- The chat widget expands to roughly 2.5x its normal size (wider and taller), centered on screen
- The button icon changes to a collapse icon (⤡ or ✕ style)
- Clicking again collapses back to normal size
- On mobile, expanded mode goes full screen (95vw x 85vh)
- On desktop, expanded mode is 700px wide x 600px tall, centered fixed on screen

Add a CSS class "chat-expanded" toggled on the chat widget container. All size changes via CSS transition (0.3s ease). The expanded widget should have a higher z-index so it floats above everything.

Do not change any other functionality, colors, or styles. Verify syntax before finishing.
