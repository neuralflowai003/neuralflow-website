export interface WorkflowData {
  taskName: string;
  estimatedMinutes: number;
  frequencyPerWeek: number;
  hourlyRate: number;
  errorRate: number;       // 0–1, fraction of runs that produce an error
  costPerError: number;    // $ cost to fix one error
  automationPotential: number; // 0–1
  implementationCost: number;  // one-time investment
  suggestedPhases?: string[];
}

export interface ROIResult {
  taskName: string;
  laborSavingsAnnual: number;
  errorReductionAnnual: number;
  opportunityCostAnnual: number;
  totalAnnualSavings: number;
  projection: [number, number, number]; // years 1–3
  breakevenMonth: number;
  automationPotential: number;
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
    taskName,
    suggestedPhases = [],
  } = data;

  const runsPerYear = frequencyPerWeek * 52;

  // Direct labor savings — hours freed × hourly rate × automation coverage
  const hoursPerYear = (estimatedMinutes * runsPerYear) / 60;
  const laborSavingsAnnual = hoursPerYear * hourlyRate * automationPotential;

  // Error reduction — fewer mistakes × cost per mistake
  const errorReductionAnnual = errorRate * costPerError * runsPerYear * automationPotential;

  // Opportunity cost — reallocating saved hours at 1.5× rate (high-value work)
  const opportunityCostAnnual = hoursPerYear * automationPotential * hourlyRate * 0.5;

  const totalAnnualSavings = laborSavingsAnnual + errorReductionAnnual + opportunityCostAnnual;

  // 3-year projection with 10% compound growth
  const year1 = totalAnnualSavings;
  const year2 = year1 * 1.1;
  const year3 = year2 * 1.1;

  // Breakeven: month when cumulative savings > implementation cost
  const monthlySavings = totalAnnualSavings / 12;
  const breakevenMonth =
    monthlySavings > 0 ? Math.ceil(implementationCost / monthlySavings) : 999;

  return {
    taskName,
    laborSavingsAnnual,
    errorReductionAnnual,
    opportunityCostAnnual,
    totalAnnualSavings,
    projection: [year1, year2, year3],
    breakevenMonth,
    automationPotential,
    suggestedPhases,
    inputs: data,
  };
}
