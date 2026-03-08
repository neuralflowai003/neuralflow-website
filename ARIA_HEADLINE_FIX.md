Fix two issues in the NeuralFlowAI website. Only touch index.html. Do not touch server.js.

FIX 1 — HERO HEADLINE CLIPPING
The headline "Automate the Ordinary." has the last letter "y" cut off on desktop and full screen.

Find the .hero-headline CSS rule. Make these changes:
- Change font-size to: clamp(2.5rem, 4vw, 5.5rem)
- Add: overflow: visible
- Add: padding-right: 8px
- Do NOT change white-space — leave it as is

FIX 2 — SLOT LIST RUNS TOGETHER ON ONE LINE
In the appendMessage function in the chat widget JavaScript, find where message text is inserted into the HTML. Add .replace(/\n/g, '<br>') so newlines render as line breaks in the chat.

Find this line:
  html += `<div class="message-content">${text}</div>`;

Change it to:
  html += `<div class="message-content">${text.replace(/\n/g, '<br>')}</div>`;

Do not change anything else. Verify syntax before finishing.
