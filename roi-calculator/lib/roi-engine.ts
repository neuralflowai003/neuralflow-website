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
  totalAnnualSavings: number;       // gross (all sources)
  neuralflowMonthlyCost: number;    // monthlyFee × 12
  netYear1: number;                 // gross − setup − monthly×12
  netOngoing: number;               // gross − monthly×12 (Year 2+)
  projection: [number, number, number];     // gross 3-year
  netProjection: [number, number, number];  // net 3-year
  breakevenMonth: number;
  automationPotential: number;
  hoursPerYear: number;
  suggestedPhases: string[];
  inputs: WorkflowData;
}

export function calculateROI(data: WorkflowData): ROIResult {
  const {
    estimatedMinutes,
    frequencyPerWeek,
    hourlyRate,
    errorRate,
    costPerError,
    automationPotential,
    implementationCost,
    monthlyFee = 450,
    taskName,
    suggestedPhases = [],
    missedRevenueMonthly = 0,
  } = data;

  const runsPerYear = frequencyPerWeek * 52;
  const hoursPerYear = (estimatedMinutes * runsPerYear) / 60;

  const laborSavingsAnnual = hoursPerYear * hourlyRate * automationPotential;
  const errorReductionAnnual = errorRate * costPerError * runsPerYear * automationPotential;
  const opportunityCostAnnual = hoursPerYear * automationPotential * hourlyRate * 0.5;
  const missedRevenueAnnual = missedRevenueMonthly * 12;
  const totalAnnualSavings = laborSavingsAnnual + errorReductionAnnual + opportunityCostAnnual + missedRevenueAnnual;

  const neuralflowMonthlyCost = monthlyFee * 12;
  const netYear1 = totalAnnualSavings - implementationCost - neuralflowMonthlyCost;
  const netOngoing = totalAnnualSavings - neuralflowMonthlyCost;

  // Gross 3-year with 10% compound growth
  const year1 = totalAnnualSavings;
  const year2 = year1 * 1.1;
  const year3 = year2 * 1.1;

  // Net 3-year (setup only hits Year 1)
  const netYear1Proj = year1 - implementationCost - neuralflowMonthlyCost;
  const netYear2Proj = year2 - neuralflowMonthlyCost;
  const netYear3Proj = year3 - neuralflowMonthlyCost;

  // Breakeven: months until cumulative net benefit covers setup cost
  const monthlyNetBenefit = totalAnnualSavings / 12 - monthlyFee;
  const breakevenMonth =
    monthlyNetBenefit > 0 ? Math.ceil(implementationCost / monthlyNetBenefit) : 999;

  return {
    taskName,
    laborSavingsAnnual,
    errorReductionAnnual,
    opportunityCostAnnual,
    missedRevenueAnnual,
    totalAnnualSavings,
    neuralflowMonthlyCost,
    netYear1,
    netOngoing,
    projection: [year1, year2, year3],
    netProjection: [netYear1Proj, netYear2Proj, netYear3Proj],
    breakevenMonth,
    automationPotential,
    hoursPerYear,
    suggestedPhases,
    inputs: data,
  };
}
