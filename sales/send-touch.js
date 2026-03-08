require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const nodemailer = require('nodemailer');
const recipients = require('./campaign-recipients.json');

const TOUCH = parseInt(process.argv[2] || '1');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function getEmailContent(touch, name, company) {
  switch(touch) {
    case 1: return {
      subject: 'Quick question about your front desk',
      body: `<p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">I was checking out <strong>${company}</strong> and had a quick question — how do you handle appointment requests that come in after hours?</p>
        <p style="margin:0 0 16px;">I run NeuralFlow AI — we build AI receptionists for local businesses. Our clients typically capture 30–40% more appointments just from after-hours coverage alone.</p>
        <p style="margin:0 0 24px;">We can also automate appointment reminders, follow-up emails, review requests, and more — basically anything your staff does manually.</p>
        <p style="margin:0 0 24px;">To see it in action, go to <a href="https://neuralflowai.io" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a> and chat with ARIA — she'll show you everything in real time.</p>
        <p style="margin:0 0 32px;">Worth a 15-minute call?</p>`
    };
    case 2: return {
      subject: 'Re: Quick question about your front desk',
      body: `<p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">Just following up on my last note.</p>
        <p style="margin:0 0 16px;">Wanted to share something quick — a local business owner told us after their first week: <em>"We captured 4 new clients we would have missed on Friday night alone."</em></p>
        <p style="margin:0 0 24px;">That's what happens when someone's always there to answer.</p>
        <p style="margin:0 0 32px;">Still worth a 15-minute call? Book directly at <a href="https://neuralflowai.io" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a>.</p>`
    };
    case 3: return {
      subject: 'How much is one missed call worth to you?',
      body: `<p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">Think about this — if your average client is worth $500–$2,000 a year, one missed after-hours call isn't just an inconvenience. It's real money walking to your competitor.</p>
        <p style="margin:0 0 24px;">Our AI answers every call, books the appointment, and sends the confirmation — while you're off the clock.</p>
        <p style="margin:0 0 32px;"><a href="https://neuralflowai.io" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a> — chat with ARIA and see it live.</p>`
    };
    case 4: return {
      subject: `Try calling ${company} after hours tonight`,
      body: `<p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">Quick challenge — call your own front desk after closing tonight.</p>
        <p style="margin:0 0 16px;">What happens?</p>
        <p style="margin:0 0 24px;">Whatever the answer is, we can fix it. Our AI is live 24/7, books appointments in real time, and never puts anyone on hold.</p>
        <p style="margin:0 0 32px;"><a href="https://neuralflowai.io" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a> → chat with ARIA → she'll book us a call.</p>`
    };
    case 5: return {
      subject: `Last note from me, ${name}`,
      body: `<p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">I've reached out a few times — totally get it, you're busy running <strong>${company}</strong>.</p>
        <p style="margin:0 0 24px;">Last thing I'll say: if you ever want to see what AI-powered scheduling and automation looks like for your business, the live demo is always at <a href="https://neuralflowai.io" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a>.</p>
        <p style="margin:0 0 32px;">Whenever the timing's right, I'm one chat away.</p>`
    };
  }
}

function buildHtml(body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.8;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:40px 0;">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
        <tr><td style="padding-bottom:32px;">
          <span style="font-size:20px;font-weight:700;color:#1a1a1a;">Neural<span style="color:#FF6B2B;">Flow</span></span>
        </td></tr>
        <tr><td>${body}</td></tr>
        <tr><td style="padding-top:16px;padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td bgcolor="#FF6B2B" style="border-radius:6px;">
              <a href="https://neuralflowai.io" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;">See It Live →</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="border-top:1px solid #eeeeee;padding-top:24px;">
          <p style="margin:0;font-size:14px;font-weight:600;">Danny Boehmer</p>
          <p style="margin:2px 0 0;font-size:13px;color:#666;">Founder, NeuralFlow AI</p>
          <p style="margin:8px 0 0;font-size:13px;">
            <a href="https://neuralflowai.io" style="color:#FF6B2B;text-decoration:none;">neuralflowai.io</a>
            &nbsp;·&nbsp;
            <a href="mailto:danny@neuralflowai.io" style="color:#666;text-decoration:none;">danny@neuralflowai.io</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendAll() {
  console.log(`\n📧 Sending Touch ${TOUCH} to ${recipients.length} recipients...\n`);
  let sent = 0, failed = 0;

  for (const r of recipients) {
    const content = getEmailContent(TOUCH, r.name, r.company);
    try {
      await transporter.sendMail({
        from: '"Danny Boehmer" <danny@neuralflowai.io>',
        to: r.email,
        subject: content.subject,
        html: buildHtml(content.body)
      });
      console.log(`✅ ${r.company} <${r.email}>`); sent++;
      await new Promise(r => setTimeout(r, 300)); // small delay between sends
    } catch(e) {
      console.log(`❌ ${r.company}: ${e.message}`); failed++;
    }
  }

  console.log(`\n✅ Done — ${sent} sent, ${failed} failed`);
}

sendAll();
