Fix two issues in the NeuralFlowAI project. Only touch index.html. Do not touch server.js.

FIX 1 — Hero headline "Automate the Ordinary." has the last letter "y" cut off.
Find .hero-headline CSS. Change font-size to clamp(2.5rem, 4vw, 5.5rem). Add overflow: visible and padding-right: 8px. Do not change white-space.

FIX 2 — ARIA chat messages show slots all on one line instead of each on their own line.
Find the appendMessage function. Find this line:
  html += `<div class="message-content">${text}</div>`;
Change to:
  html += `<div class="message-content">${text.replace(/\n/g, '<br>')}</div>`;

Do not change anything else. Verify syntax before finishing.
