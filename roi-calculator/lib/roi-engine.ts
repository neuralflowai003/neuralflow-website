export interface WorkflowData {
  taskName: string;
  estimatedMinutes: number;
  frequencyPerWeek: number;
  hourlyRate: number;
  errorRate: number;
  costPerError: number;
  automationPotential: number;
  implementationCost: number;
  monthlyFee?: number;
  suggestedPhases?: string[];
  missedRevenueMonthly?: number; // revenue lost from missed calls/leads per month
}

export interface ROIResult {
  taskName: string;
  laborSavingsAnnual: number;
  errorReductionAnnual: number;
  opportunityCostAnnual: number;
  missedRevenueAnnual: number;
  totalAnnualSavings: number;       // steady-state gross (all sources, Year 2+ run-rate)
  steadyStateAnnual: number;        // alias of totalAnnualSavings for clarity
  neuralflowMonthlyCost: number;    // monthlyFee × 12
  netYear1: number;                 // ramped gross − setup − monthly×12
  netOngoing: number;               // steady-state gross − monthly×12 (Year 2+)
  projection: [number, number, number];     // gross 3-year (Year 1 ramped)
  netProjection: [number, number, number];  // net 3-year
  breakevenMonth: number;
  paybackWeeks: number;             // breakeven expressed in weeks
  roiMultiple: number;              // steady-state gross ÷ annual all-in cost
  automationPotential: number;
  hoursPerYear: number;
  hoursFreedPerYear: number;        // hours actually reclaimed (× automation)
  suggestedPhases: string[];
  inputs: WorkflowData;
}

// Automation ramps over onboarding; Year 1 realizes ~85% of steady-state.
const RAMP_YEAR1 = 0.85;
// Modest, defensible business-volume growth applied to Year 2 and 3.
const GROWTH = 1.05;
// Value of reclaimed capacity redeployed to higher-value work. Conservative
// (a third of the freed labor's value) — not the arbitrary half it was before.
const REINVEST_FACTOR = 0.3;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

export function calculateROI(data: WorkflowData): ROIResult {
  const taskName = data.taskName;
  const suggestedPhases = data.suggestedPhases ?? [];

  // ── Sanitize inputs so a bad value can't produce nonsense output ──
  const estimatedMinutes = clamp(data.estimatedMinutes, 0, 100000);
  const frequencyPerWeek = clamp(data.frequencyPerWeek, 0, 100000);
  const hourlyRate = clamp(data.hourlyRate, 0, 10000);
  const errorRate = clamp(data.errorRate, 0, 1);
  const costPerError = clamp(data.costPerError, 0, 1_000_000);
  const automationPotential = clamp(data.automationPotential, 0, 0.95); // never claim 100%
  const implementationCost = clamp(data.implementationCost, 0, 10_000_000);
  const monthlyFee = clamp(data.monthlyFee ?? 450, 0, 1_000_000);
  const missedRevenueMonthly = clamp(data.missedRevenueMonthly ?? 0, 0, 10_000_000);

  const runsPerYear = frequencyPerWeek * 52;
  const hoursPerYear = (estimatedMinutes * runsPerYear) / 60;
  const hoursFreedPerYear = hoursPerYear * automationPotential;

  // ── Steady-state (Year 2+) annual savings ──
  const laborSavingsAnnual = hoursFreedPerYear * hourlyRate;
  const errorReductionAnnual = errorRate * costPerError * runsPerYear * automationPotential;
  const opportunityCostAnnual = hoursFreedPerYear * hourlyRate * REINVEST_FACTOR;
  const missedRevenueAnnual = missedRevenueMonthly * 12;
  const steadyStateAnnual =
    laborSavingsAnnual + errorReductionAnnual + opportunityCostAnnual + missedRevenueAnnual;
  const totalAnnualSavings = steadyStateAnnual;

  const neuralflowMonthlyCost = monthlyFee * 12;

  // ── Year 1 ramps up; Year 2/3 grow modestly ──
  const year1Gross = steadyStateAnnual * RAMP_YEAR1;
  const year2Gross = steadyStateAnnual * GROWTH;
  const year3Gross = steadyStateAnnual * GROWTH * GROWTH;

  const netYear1 = year1Gross - implementationCost - neuralflowMonthlyCost;
  const netOngoing = steadyStateAnnual - neuralflowMonthlyCost;

  const netYear1Proj = year1Gross - implementationCost - neuralflowMonthlyCost;
  const netYear2Proj = year2Gross - neuralflowMonthlyCost;
  const netYear3Proj = year3Gross - neuralflowMonthlyCost;

  // ── Breakeven against the ramped first-year monthly benefit ──
  const monthlyNetBenefit = year1Gross / 12 - monthlyFee;
  const breakevenMonth =
    monthlyNetBenefit > 0 ? Math.ceil(implementationCost / monthlyNetBenefit) : 999;
  const paybackWeeks =
    monthlyNetBenefit > 0 ? Math.max(1, Math.round((implementationCost / monthlyNetBenefit) * 4.33)) : 999;

  // ── ROI multiple: steady-state gross return per $1 of all-in first-year cost ──
  const annualAllInCost = neuralflowMonthlyCost + implementationCost; // Year-1 total spend
  const roiMultiple = annualAllInCost > 0 ? steadyStateAnnual / annualAllInCost : 0;

  return {
    taskName,
    laborSavingsAnnual,
    errorReductionAnnual,
    opportunityCostAnnual,
    missedRevenueAnnual,
    totalAnnualSavings,
    steadyStateAnnual,
    neuralflowMonthlyCost,
    netYear1,
    netOngoing,
    projection: [year1Gross, year2Gross, year3Gross],
    netProjection: [netYear1Proj, netYear2Proj, netYear3Proj],
    breakevenMonth,
    paybackWeeks,
    roiMultiple,
    automationPotential,
    hoursPerYear,
    hoursFreedPerYear,
    suggestedPhases,
    inputs: { ...data, automationPotential, monthlyFee, missedRevenueMonthly },
  };
}
