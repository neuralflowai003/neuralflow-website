# FIX17 — Proposal Accept Page

## Goal
Create a `/accept` route that clients land on when they click "Accept & Get Started" in their proposal. It triggers automated onboarding.

## Part A: New file `accept.html` in repo root

Dark-themed standalone HTML page matching NeuralFlow brand (bg #0a0a0f, accent #FF6B2B, Space Grotesk from Google Fonts).

### URL params to pre-fill:
- `?client=` → pre-fills Business Name field
- `?amount=` → deposit amount (e.g. 1498)
- `?fee=` → monthly fee (e.g. 497)

### Page layout:
- NeuralFlow AI wordmark at top (orange, bold, letter-spaced)
- Headline: "Let's Get Started"
- Subline: "Complete the form below to confirm your proposal and kick off onboarding."
- If `amount` param present, show a subtle card: "Your deposit today: $[amount] · Monthly retainer: $[fee]/mo"
- Form fields: Full Name, Business Name (pre-filled from `client` param), Email, Phone (optional)
- Submit button: "Confirm & Begin Onboarding →" (orange, full width)
- On success: hide form, show:
  - "🎉 You're in! Check your email for next steps."
  - A green "Pay Deposit →" button linking to `https://buy.stripe.com/PLACEHOLDER` (we'll update URL later)
  - "We'll send your DocuSign agreement within 24 hours."
- On error: "Something went wrong — email danny@neuralflowai.io directly."

POST to `/api/accept-proposal` on submit.

## Part B: New endpoint in `server.js`

Add `POST /api/accept-proposal` accepting `{ name, businessName, email, phone, amount, fee }`.

### On receive:

**1. Telegram ping to Danny** (immediate — use node-fetch or https to call Telegram Bot API):
- Bot token: use env var TELEGRAM_BOT_TOKEN if set, otherwise skip
- Chat ID: 8709413106
- Message: `🎉 NEW CLIENT ACCEPTED\n\nBusiness: [businessName]\nContact: [name]\nEmail: [email]\nPhone: [phone]\nDeposit: $[amount]\nMonthly: $[fee]/mo`

**2. Email to danny@neuralflowai.io** via Gmail SMTP (nodemailer, use GMAIL_USER + GMAIL_APP_PASSWORD from .env):
- Subject: `🎉 NEW CLIENT — [businessName] accepted their proposal`
- Dark HTML email body with all client fields, timestamp, and a note: "Send DocuSign + Stripe invoice now."

**3. Email to client** — dark branded HTML:
- Subject: `Welcome to NeuralFlow AI — Here's What Happens Next`
- Body: "Hi [name], your proposal has been accepted. Here's what happens next:
  1. We'll send your consulting agreement via DocuSign within 24 hours.
  2. A deposit invoice will follow for $[amount] to begin.
  3. Onboarding starts immediately after signing.
  Expected go-live: 10–14 days from today.
  Questions? Reply to this email.
  — Danny Boehmer, NeuralFlow AI"

**4. Return** `{ ok: true }` on success, `{ ok: false, error: message }` on failure.

## Part C: Static route in `server.js`
Add: `app.get('/accept', (req, res) => res.sendFile(path.join(__dirname, 'accept.html')));`

## Notes
- Require name, businessName, email — return 400 if missing
- Use same nodemailer transporter pattern already in server.js
- Dark email style: bgcolor #0a0a0f, accent #FF6B2B, inline CSS only
- Telegram call: use the `https` module (no new deps) — POST to `https://api.telegram.org/bot${token}/sendMessage`
- TELEGRAM_BOT_TOKEN is optional — wrap in try/catch, don't fail if missing
