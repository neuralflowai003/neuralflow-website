require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const nodemailer = require('nodemailer');

const recipients = [
  { name: "Rita", email: "rcc@chippersonlaw.com", company: "Chipperson Law Group, P.C." },
  { name: "Shaun", email: "shaun@ampperformancerehab.com", company: "AMP Performance Rehab" },
  { name: "Stephen", email: "sgfromme@goldenlivingguidance.com", company: "Golden Living Guidance, Inc." },
  { name: "George", email: "george@1776morristown.com", company: "1776 MORRISTOWN" },
  { name: "Sae", email: "sae@reikimyoga.com", company: "Reiki My Yoga" },
  { name: "Marc", email: "mgoldberg@bonapeda.com", company: "BONAPEDA Enterprises LLC" },
  { name: "Scott", email: "smorgan@wmmblawfirm.com", company: "Weiner, Millo, Morgan & Bonanno, LLC" },
  { name: "Michael", email: "mcanarick@canarick-law.com", company: "Canarick & Canarick" },
  { name: "Laura", email: "laura@familyfocusedlegal.com", company: "Family Focused Legal Solutions" },
  { name: "Bobby", email: "bobby@igotrypt.com", company: "Reach Your Potential Training Inc." },
  { name: "Dipty", email: "diptymali@equipoisept.com", company: "Equipoise Physical Therapy" },
  { name: "Joanne", email: "joanne@cicalapllc.com", company: "Cicala Wackerly Conrod PLLC" },
  { name: "Michael", email: "mmaggiano@maggianolaw.com", company: "Maggiano, DiGirolamo & Lizzi P.C." },
  { name: "Bili", email: "bili@tattoostuff.com", company: "Redemption Tattoo Care" },
  { name: "Priscilla", email: "priscilla@pineapple-pink.com", company: "Pineapple Pink" },
  { name: "Sara", email: "sara@physeq.com", company: "Physical Equilibrium" },
  { name: "Melissa", email: "melissa@spurrlawllc.com", company: "Spurr Law LLC" },
  { name: "Shanece", email: "shanece@fondandfaye.com", company: "Fond & Faye" },
  { name: "Sebastien", email: "sebastien@vsvwinebars.com", company: "Vin sur Vingt Wine Bar" },
  { name: "Amy", email: "amy@toastcitydiner.com", company: "Toast City Diner" },
  { name: "AJ", email: "aj@svhnyc.com", company: "South Village Hospitality Group" },
  { name: "Robin", email: "robin@fitnessbarre.com", company: "Fitness Barre" },
  { name: "Anna", email: "apelligra@acp-law.com", company: "ACP Law" },
  { name: "Lynette", email: "lsiragusa@siragusalawfirm.com", company: "Siragusa Law Firm LLC" },
  { name: "Mitchell", email: "mtwersky@aftlaw.com", company: "Abraham, Fruchter & Twersky, LLP" },
  { name: "Naira", email: "naira@vidadivina.com", company: "The Tea Lady" },
  { name: "William", email: "william@groblelaw.com", company: "The Law Offices of William Groble" },
  { name: "Susan", email: "susan@susanhlieberman.com", company: "Pathways To Mind Body Wellness" },
  { name: "Michael", email: "mpiercy@thelabsports.com", company: "The LAB" },
  { name: "Joan", email: "joan@pmiemail.com", company: "PhysicalMind Institute" },
  { name: "Judd", email: "jgrossman@grossmanllp.com", company: "Grossman LLP" },
  { name: "Eric", email: "eric@sklawpllc.com", company: "Sperber Kahan Law Group PLLC" },
  { name: "Joseph", email: "joe.r@metrosportspt.com", company: "Metro Sports Physical Therapy" },
  { name: "Derrick", email: "derrick@cs-supplements.com", company: "Common Sense Supplements" },
  { name: "Leann", email: "lforbes@forbeslegalgroup.com", company: "Forbes Legal Group" },
  { name: "John", email: "jschepisi@schepisi.com", company: "Schepisi & McLaughlin, P.A." },
  { name: "Jose", email: "jsoto@njhiit.com", company: "NJ HIIT Cross Training & Performance" },
  { name: "Jennifer", email: "jennifer@liveinfinitive.com", company: "Infinitive Fitness Club" },
  { name: "Murat", email: "murat@thejollygoat.com", company: "The Jolly Goat Coffee Bar" },
  { name: "Caitlyn", email: "caitlyn@ritualnj.com", company: "Ritual Fitness + Wellness" },
  { name: "David", email: "dsr@rutherfordchristie.com", company: "Rutherford & Christie LLP" },
  { name: "John", email: "jmetekidis@bmwoffreeport.com", company: "Greek Brothers" },
  { name: "Juliet", email: "juliet@ridereflect.com", company: "Ride+Reflect" },
  { name: "Etai", email: "ecinader@kingsofkobe.com", company: "Kings of Kobe - Wagyu Kitchen & Bar" },
  { name: "Bradford", email: "bradford.geyer@formerfedsgroup.com", company: "FormerFedsGroup.com" },
  { name: "Chesney", email: "chesney@bluewellnesscenter.com", company: "Blue Counseling & Wellness Center" },
  { name: "Bodi", email: "bzhang@mybevimi.com", company: "Bevimi" },
  { name: "Ken", email: "kencheng@southjerseypt.com", company: "South Jersey Physical Therapy" },
  { name: "Richard", email: "rich@mongellilaw.com", company: "Mongelli Law" },
  { name: "Jon", email: "jon@matterformula.com", company: "Matter" }
];

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function buildHtml(name, company) {
  const body = `<p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 16px;">Wanted to follow up on my note from yesterday.</p>
    <p style="margin:0 0 16px;">I know you're running <strong>${company}</strong> and time is tight — so I'll keep this short: most of the businesses we work with were losing 5–10 leads a month simply because nobody was there to respond after hours.</p>
    <p style="margin:0 0 24px;">Our AI handles that. It answers, qualifies, books, and follows up — automatically, 24/7.</p>
    <p style="margin:0 0 16px;">Can we get 15 minutes on the calendar this week? Even just to see if it's a fit.</p>
    <p style="margin:0 0 32px;">Book directly at <a href="https://neuralflowai.io/#contact" style="color:#FF6B2B;font-weight:600;">neuralflowai.io</a> — or just reply and I'll send you a time.</p>`;

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
              <a href="https://neuralflowai.io/#contact" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;">Book a 15-Min Call →</a>
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
  console.log(`\n📧 Sending follow-up to ${recipients.length} Apollo contacts...\n`);
  let sent = 0, failed = 0;

  for (const r of recipients) {
    try {
      await transporter.sendMail({
        from: '"Danny Boehmer" <danny@neuralflowai.io>',
        to: r.email,
        subject: `Re: Quick follow-up from Danny`,
        html: buildHtml(r.name, r.company)
      });
      console.log(`✅ ${r.name} @ ${r.company} <${r.email}>`);
      sent++;
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch(e) {
      console.log(`❌ ${r.company}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done — ${sent} sent, ${failed} failed`);
}

sendAll();
