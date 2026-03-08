Fix the hero headline clipping in index.html. Only touch index.html. Do not touch server.js.

Find the CSS rule for .line-1 (it is a span inside the hero headline). It has overflow: hidden which is cutting off the last letter of "Automate the Ordinary."

Change .line-1 overflow from hidden to visible.
Also add padding-right: 10px to .line-1.

Do not change anything else. Verify syntax before finishing.
