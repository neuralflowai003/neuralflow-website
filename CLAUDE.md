# NeuralFlow AI — Project Context

## Who You're Working With
**Danny Boehmer** — Founder of NeuralFlow AI LLC, based in Bayonne, NJ.
- Email: danny@neuralflowai.io
- Phone: (908) 347-5095
- GitHub: neuralflowai003

## What NeuralFlow AI Is
B2B AI consulting and automation company. We build custom AI systems that automate workflows, qualify leads, and scale businesses. Main product is **ARIA** — an AI receptionist/chatbot that books appointments directly on the website.

## Live URLs
- Main site: https://neuralflowai.io
- ROI Calculator: https://roi.neuralflowai.io/roi-calculator

---

## Tech Stack

### Main Website (`neuralflow-tracker` repo)
- **Runtime**: Node.js + Express (`server.js`)
- **Frontend**: Single `index.html` (vanilla JS, no framework)
- **Email**: Resend API
- **AI**: Anthropic Claude API (`claude-haiku-4-5` for ARIA chat)
- **Calendar**: Google Calendar API (OAuth2)
- **Alerts**: Telegram Bot API
- **Hosting**: Railway (`focused-victory` project, `neuralflow-website` service)
- **Domain**: neuralflowai.io

### ROI Calculator (`neuralflow-roi` repo at `/Users/danny/.openclaw/workspace/neuralflow-roi`)
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS + inline styles
- **Hosting**: Railway (`focused-victory` project, separate `neuralflow-roi` service)
- **Domain**: roi.neuralflowai.io

---

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Main Express server — all API routes, ARIA logic, booking, email, Telegram |
| `index.html` | Entire frontend — homepage, ARIA chat widget, all sections |
| `accept.html` | Client proposal acceptance page |
| `BUSINESS_INFO.txt` | Company details, accounts, credentials |
| `roi-calculator/` | Copy of ROI calculator (synced to neuralflow-roi) |

---

## Deployment

### Main site
```bash
git add . && git commit -m "message" && git push
```
Railway auto-deploys from GitHub on push. **Do not use `railway up`** — GitHub push is the correct flow.

### ROI Calculator
```bash
cd /Users/danny/.openclaw/workspace/neuralflow-roi
railway up
```
Or push to GitHub — same repo, Railway detects the `roi-calculator/` subdirectory.

### Railway config
- Main site service: `0fc15cf2-196a-4900-adba-e23aec8e8b0e`
- ROI service: `77b14326-4d1b-4532-b411-a8b54f16395b`
- Project: `2ea56357-2d74-4920-8664-0ebadef9d742`

---

## ARIA — The AI Chatbot

ARIA is an AI receptionist embedded in `index.html` that:
- Chats with website visitors via `/api/chat`
- Detects intent and collects name, email, phone, company
- Checks Google Calendar availability via `/api/availability`
- Books appointments directly into Danny's Google Calendar
- Sends confirmation emails via Resend
- Sends Telegram alerts to Danny for every key event

### Key ARIA behaviors
- Rate limited: 30 req/min per IP
- Conversation history stored in `conversationSlots` Map (30 min TTL)
- Agreed booking slots stored in `agreedSlots` Map
- Abandoned chat follow-up: emails leads who gave email but didn't book (fires 30 min after last message)
- No-show recovery: fires 2h after missed appointment with new slot options

---

## Telegram Alerts (Alerts Bot: @Orion_ai_003_1bot)
Danny receives Telegram alerts for:
- `👀 ARIA LEAD` — email detected in chat
- `✅ NEW BOOKING CONFIRMED` — appointment booked
- `⚠️ DUPLICATE BOOKING BLOCKED`
- `⚠️ NO-SHOW` — missed appointment
- `🧮 ROI CALCULATOR LEAD` — ROI form submitted (name/email/phone)
- `🧮 NEW ROI LEAD` — ROI analysis completed with results
- `🔥 TALK TO ARIA CLICKED` — from ROI calculator
- `🎉 NEW CLIENT ACCEPTED` — proposal accepted
- `🚨` prefix — any system error or failure

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | ARIA conversation (rate limited) |
| `/api/book` | POST | Book appointment |
| `/api/availability` | GET | Get available calendar slots |
| `/api/contact` | POST | Contact form |
| `/api/accept-proposal` | POST | Client proposal acceptance (requires PROPOSAL_SECRET token) |
| `/api/roi-lead` | POST | ROI calculator lead capture |
| `/api/track` | POST | ROI calculator event tracking |
| `/api/test` | GET | Full system health check (requires password) |
| `/api/test-email` | GET | Test Resend email (requires password) |
| `/oauth/start` | GET | Google Calendar OAuth (requires password) |
| `/oauth/callback` | GET | Google OAuth callback |
| `/bookings` | GET | Bookings dashboard (requires password) |
| `/robots.txt` | GET | SEO robots file |
| `/sitemap.xml` | GET | SEO sitemap |

---

## Environment Variables (set in Railway)
- `ANTHROPIC_API_KEY` — Claude API
- `RESEND_API_KEY` — Email sending
- `GMAIL_USER` — Danny's email address
- `TELEGRAM_BOT_TOKEN` — Alerts bot token
- `TELEGRAM_CHAT_ID` — Danny's Telegram chat ID
- `BOOKINGS_PASSWORD` — Password for /bookings, /api/test, /oauth/start
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` — Calendar
- `PROPOSAL_SECRET` — Token required in accept-proposal requests
- `OPENROUTER_API_KEY` — Fallback if Anthropic fails

---

## Recent Work Completed
- Migrated email from SMTP/nodemailer → Resend API
- Fixed UTC timezone conversion for calendar freebusy checks
- Fixed `requestedTime` detection running for all date cases
- Mobile menu fix: global `nav {}` CSS was affecting drawer nav
- ARIA demo: continuous loop with smooth animations, no IntersectionObserver
- ROI calculator: full visual redesign matching main site (dark theme, orange/purple gradient)
- Telegram lead capture: immediate alert on form submit + combined alert after analysis
- Security hardening: helmet, escapeHtml XSS fix, rate limiting all endpoints, input length limits, Telegram retry with timeout, Claude API abort timeout, Map size caps
- SEO: JSON-LD structured data, canonical tag, sitemap.xml, robots.txt, www redirect, brand name consistency

---

## Design System
- Background: `#050508` / `#06060b`
- Orange accent: `#FF6B2B`
- Purple accent: `#7B61FF`
- Gradient: `linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)`
- Font: Space Grotesk (headings) + Inter (body)
- Cards: dark glass with `rgba(255,255,255,0.05)` background, subtle border

---

## Important Rules
- Always commit + push to GitHub for main site deploys — never just `railway up`
- Never commit `.env` files or credentials
- Test Telegram alerts after any server.js changes
- The ROI calculator at `neuralflow-roi` is a separate Railway service from the main site
- `escapeHtml()` must be used for any user input rendered in HTML
