import type { ROIResult } from './roi-engine';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Generates a plain-text "Preliminary Efficiency Report" from a saved ROI result.
 * Designed for injection into booking confirmation emails and calendar event descriptions.
 *
 * Pass `roi` directly when available server-side, or call `blueprintFromStorage()`
 * on the client to read from localStorage automatically.
 */
export function generateBlueprint(roi: ROIResult): string {
  const { taskName, totalAnnualSavings, laborSavingsAnnual, errorReductionAnnual,
    opportunityCostAnnual, breakevenMonth, automationPotential, projection,
    suggestedPhases, inputs } = roi;

  const pct = Math.round(automationPotential * 100);
  const runsPerYear = inputs.frequencyPerWeek * 52;

  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  NEURALFLOW AI — PRELIMINARY EFFICIENCY REPORT',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `WORKFLOW IDENTIFIED: ${taskName}`,
    `Runs per year: ${runsPerYear.toLocaleString()}  |  Time per run: ${inputs.estimatedMinutes} min  |  Staff rate: ${fmt(inputs.hourlyRate)}/hr`,
    '',
    '── PROJECTED SAVINGS ──────────────────',
    `  Labor savings:          ${fmt(laborSavingsAnnual)} / year`,
    `  Error reduction:        ${fmt(errorReductionAnnual)} / year`,
    `  Opportunity cost freed: ${fmt(opportunityCostAnnual)} / year`,
    `  ─────────────────────────────────────`,
    `  TOTAL ANNUAL SAVINGS:   ${fmt(totalAnnualSavings)}`,
    '',
    '── 3-YEAR PROJECTION ──────────────────',
    `  Year 1: ${fmt(projection[0])}`,
    `  Year 2: ${fmt(projection[1])}`,
    `  Year 3: ${fmt(projection[2])}`,
    '',
    `  Automation potential: ${pct}%`,
    `  Estimated breakeven:  ${breakevenMonth < 999 ? `${breakevenMonth} months` : 'N/A'}`,
    '',
  ];

  if (suggestedPhases.length > 0) {
    lines.push('── RECOMMENDED IMPLEMENTATION ─────────');
    suggestedPhases.forEach((phase) => lines.push(`  ${phase}`));
    lines.push('');
  }

  lines.push(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'This report was auto-generated based on inputs provided during the ROI',
    'discovery session. Final figures depend on implementation scope.',
    'NeuralFlow AI  |  neuralflowai.io',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  );

  return lines.join('\n');
}

/**
 * Client-side helper — reads ROI from localStorage and returns blueprint string,
 * or null if no saved ROI found.
 */
export function blueprintFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('neuralflow_roi');
    if (!raw) return null;
    return generateBlueprint(JSON.parse(raw) as ROIResult);
  } catch {
    return null;
  }
}
