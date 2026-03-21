import { NextRequest, NextResponse } from 'next/server';
import type { ROIResult } from '@/lib/roi-engine';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function buildEmailHtml(roi: ROIResult): string {
  const bookUrl = 'https://neuralflowai.io/?open_chat=1';
  const fontStack = `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

  const phasesHtml = roi.suggestedPhases && roi.suggestedPhases.length > 0
    ? `
          <!-- Implementation Roadmap -->
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0 0 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#6b7280;font-family:${fontStack};">Implementation Roadmap</p>
              ${roi.suggestedPhases.map((phase, i) => `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                <tr>
                  <td width="32" valign="top" style="padding-top:1px;">
                    <div style="width:24px;height:24px;border-radius:50%;background-color:#16a34a;text-align:center;line-height:24px;font-size:12px;font-weight:700;color:#ffffff;font-family:${fontStack};">${i + 1}</div>
                  </td>
                  <td style="padding-left:8px;">
                    <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;font-family:${fontStack};">${escapeHtml(phase.replace(/^Phase \d+:\s*/, ''))}</p>
                  </td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your NeuralFlow ROI Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f9;font-family:${fontStack};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Green header banner -->
          <tr>
            <td style="background-color:#f0fdf4;border-bottom:2px solid #bbf7d0;padding:28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px;font-family:${fontStack};">
                      <span style="color:#111827;">Neural</span><span style="color:#16a34a;">Flow</span>&nbsp;<span style="color:#16a34a;font-weight:900;">AI</span>
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin:0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#16a34a;font-family:${fontStack};">ROI Report</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:40px 40px 0;">

              <!-- Headline -->
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#111827;line-height:1.25;letter-spacing:-0.5px;font-family:${fontStack};">Your AI Automation ROI Report</h1>
              <p style="margin:0 0 24px;font-family:${fontStack};">
                <span style="display:inline-block;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;padding:4px 14px;font-size:13px;font-weight:600;color:#15803d;">${escapeHtml(roi.inputs.taskName)}</span>
              </p>

              <!-- 3 stat cards -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td width="32%" style="padding:20px 16px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#15803d;font-family:${fontStack};">Annual Savings</p>
                    <p style="margin:0;font-size:26px;font-weight:800;color:#16a34a;font-family:${fontStack};">${fmt(roi.totalAnnualSavings)}</p>
                  </td>
                  <td width="2%"></td>
                  <td width="32%" style="padding:20px 16px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#1d4ed8;font-family:${fontStack};">Automatable</p>
                    <p style="margin:0;font-size:26px;font-weight:800;color:#2563eb;font-family:${fontStack};">${Math.round(roi.automationPotential * 100)}%</p>
                  </td>
                  <td width="2%"></td>
                  <td width="32%" style="padding:20px 16px;background-color:#faf5ff;border:1px solid #e9d5ff;border-radius:12px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#6d28d9;font-family:${fontStack};">Breakeven</p>
                    <p style="margin:0;font-size:26px;font-weight:800;color:#7c3aed;font-family:${fontStack};">${roi.breakevenMonth < 999 ? roi.breakevenMonth + ' mo' : 'N/A'}</p>
                  </td>
                </tr>
              </table>

              <!-- Savings breakdown -->
              <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#6b7280;font-family:${fontStack};">Savings Breakdown</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
                <tr style="background-color:#f9fafb;">
                  <td style="padding:14px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:#22d3ee;margin-right:8px;vertical-align:middle;"></span>
                          <span style="font-size:14px;color:#374151;font-family:${fontStack};">Labor Savings</span>
                        </td>
                        <td align="right" style="font-size:15px;font-weight:700;color:#0e7490;font-family:${fontStack};">${fmt(roi.laborSavingsAnnual)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr style="background-color:#ffffff;">
                  <td style="padding:14px 16px;border-top:1px solid #f3f4f6;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:#60a5fa;margin-right:8px;vertical-align:middle;"></span>
                          <span style="font-size:14px;color:#374151;font-family:${fontStack};">Error Reduction</span>
                        </td>
                        <td align="right" style="font-size:15px;font-weight:700;color:#1d4ed8;font-family:${fontStack};">${fmt(roi.errorReductionAnnual)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr style="background-color:#f9fafb;">
                  <td style="padding:14px 16px;border-top:1px solid #f3f4f6;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:#818cf8;margin-right:8px;vertical-align:middle;"></span>
                          <span style="font-size:14px;color:#374151;font-family:${fontStack};">Opportunity Cost Recovery</span>
                        </td>
                        <td align="right" style="font-size:15px;font-weight:700;color:#4f46e5;font-family:${fontStack};">${fmt(roi.opportunityCostAnnual)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr style="background-color:#f0fdf4;">
                  <td style="padding:16px;border-top:2px solid #bbf7d0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px;font-weight:700;color:#111827;font-family:${fontStack};">Total Annual Savings</td>
                        <td align="right" style="font-size:20px;font-weight:800;color:#16a34a;font-family:${fontStack};">${fmt(roi.totalAnnualSavings)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- 3-year projection -->
              <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#6b7280;font-family:${fontStack};">3-Year Projection</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  ${[0, 1, 2].map((i) => `
                  <td width="32%" style="padding:18px 12px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;font-family:${fontStack};">Year ${i + 1}</p>
                    <p style="margin:0 0 2px;font-size:20px;font-weight:800;color:#16a34a;font-family:${fontStack};">${fmt(Math.round(roi.projection[i]))}</p>
                    <p style="margin:0;font-size:13px;color:#16a34a;font-family:${fontStack};">&#8599;</p>
                  </td>${i < 2 ? '<td width="2%"></td>' : ''}`).join('')}
                </tr>
              </table>

              ${phasesHtml}

            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:8px 40px 40px;text-align:center;">
              <a href="${bookUrl}" style="display:inline-block;background-color:#16a34a;color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;padding:16px 40px;border-radius:12px;letter-spacing:-0.1px;font-family:${fontStack};">Talk to ARIA About This &#8594;</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#374151;font-family:${fontStack};">
                <span style="color:#111827;">Neural</span><span style="color:#16a34a;">Flow</span> AI
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;font-family:${fontStack};">
                <a href="https://neuralflowai.io" style="color:#6b7280;text-decoration:none;">neuralflowai.io</a>
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#d1d5db;font-family:${fontStack};">This report was generated from inputs you provided in the ROI calculator.</p>
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
  const html = buildEmailHtml(roi);

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
