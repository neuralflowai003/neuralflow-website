# FIX18 — Fix /api/accept-proposal timeout

## Problem
POST /api/accept-proposal hangs indefinitely. The nodemailer send is blocking without a timeout, causing the endpoint to never respond.

## Fix in server.js

In the `app.post('/api/accept-proposal', ...)` handler, wrap the `Promise.all([transporter.sendMail(...), transporter.sendMail(...)])` in a Promise.race with a 10-second timeout:

Replace the current:
```js
await Promise.all([
  transporter.sendMail(dannyMailOptions),
  transporter.sendMail(clientMailOptions)
]);
res.json({ ok: true });
```

With:
```js
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 10000));
await Promise.race([
  Promise.all([
    transporter.sendMail(dannyMailOptions),
    transporter.sendMail(clientMailOptions)
  ]),
  timeout
]);
res.json({ ok: true });
```

Also add a try/catch around the Telegram block specifically so if it fails it doesn't affect the rest.

Also create a new nodemailer transporter inside the route handler itself (not relying on the global one) using the env vars directly:

```js
const acceptTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});
```

Use `acceptTransporter` for both sendMail calls in this route.
