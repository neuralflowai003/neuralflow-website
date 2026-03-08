Add a maximize/expand button to the ARIA chat window in index.html. Only touch index.html. Do not touch server.js.

The chat window has a header with an "ARIA" title and a close button (×). Add a small expand button (⛶ unicode &#x26F6;) in the header to the left of the close button.

When clicked:
- Toggle a class "chat-expanded" on the chat window
- In expanded mode, the chat window becomes 700px wide × 600px tall, centered fixed on the screen (top:50%, left:50%, transform:translate(-50%,-50%))
- The button icon changes to ✕ (&#x2715;) to collapse
- Clicking again collapses back to normal size (440px × 620px, bottom-right corner)
- Smooth CSS transition: 0.3s ease on width, height, top, left

Style the expand button to match the close button style — subtle, white/grey color, no background, hover effect.

Do not change mobile styles. Do not change any other functionality. Verify syntax before finishing.
