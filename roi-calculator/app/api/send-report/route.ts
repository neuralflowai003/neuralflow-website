import { NextRequest, NextResponse } from 'next/server';
import { generateBlueprint } from '@/lib/generate-blueprint';
import type { ROIResult } from '@/lib/roi-engine';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function buildEmailHtml(blueprint: string, roi: ROIResult): string {
  const bookUrl = 'https://neuralflowai.io/?open_chat=1';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your NeuralFlow ROI Report</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">
                Neural<span style="color:#22d3ee;">Flow</span>
              </p>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding-bottom:8px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(34,211,238,0.7);font-family:monospace;">Analysis Complete</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:32px;">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;line-height:1.3;">${roi.inputs.taskName}</h1>
            </td>
          </tr>

          <!-- Key stats -->
          <tr>
            <td style="padding-bottom:32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="padding:16px;background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4);">Annual Savings</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#34d399;font-family:monospace;">${fmt(roi.totalAnnualSavings)}</p>
                  </td>
                  <td width="4%"></td>
                  <td width="29%" style="padding:16px;background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4);">Automatable</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#22d3ee;font-family:monospace;">${Math.round(roi.automationPotential * 100)}%</p>
                  </td>
                  <td width="4%"></td>
                  <td width="30%" style="padding:16px;background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4);">Breakeven</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#a78bfa;font-family:monospace;">${roi.breakevenMonth < 999 ? roi.breakevenMonth + ' mo' : 'N/A'}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Full report -->
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0 0 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4);">Full Report</p>
              <pre style="margin:0;padding:20px;background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;font-family:'Courier New',Courier,monospace;font-size:12px;color:rgba(255,255,255,0.6);white-space:pre-wrap;word-break:break-word;line-height:1.6;">${blueprint.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding-bottom:40px;text-align:center;">
              <a href="${bookUrl}" style="display:inline-block;background-color:#22d3ee;color:#0a0a0a;font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:12px;">Book a Call with ARIA →</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid rgba(255,255,255,0.06);padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.25);">NeuralFlow AI &nbsp;·&nbsp; neuralflowai.io</p>
              <p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.15);">This report was generated from inputs you provided in the ROI calculator.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  let email: string;
  let roi: ROIResult;

  try {
    const body = await req.json();
    email = body.email;
    roi = body.roi;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }
  if (!roi || !roi.inputs?.taskName) {
    return NextResponse.json({ error: 'Invalid ROI data.' }, { status: 400 });
  }

  email = email.trim();
  const blueprint = generateBlueprint(roi);
  const html = buildEmailHtml(blueprint, roi);

  // Send email via Resend
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ARIA <aria@neuralflowai.io>',
      to: [email],
      subject: `Your NeuralFlow ROI Report — ${roi.taskName}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    console.error('Resend error:', errBody);
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 });
  }

  // Fire Telegram alert (non-blocking — don't fail if this errors)
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `📊 ROI REPORT REQUESTED\n${email}\nTask: ${roi.taskName}\nSavings: $${Math.round(roi.totalAnnualSavings).toLocaleString()}/yr`,
        }),
      }
    );
  } catch {
    // Telegram alert failure is non-critical
  }

  return NextResponse.json({ ok: true });
}
