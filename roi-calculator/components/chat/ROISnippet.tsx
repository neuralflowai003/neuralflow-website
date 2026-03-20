'use client';

import { useEffect, useState } from 'react';
import type { ROIResult } from '@/lib/roi-engine';

export default function ROISnippet() {
  const [roi, setRoi] = useState<ROIResult | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('neuralflow_roi');
      if (raw) setRoi(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  if (!roi) return null;

  const fmt = (n: number) =>
    n >= 1000
      ? `$${(n / 1000).toFixed(0)}k`
      : `$${Math.round(n).toLocaleString()}`;

  const pct = Math.round(roi.automationPotential * 100);

  return (
    <div className="my-3 rounded-xl border border-purple-500/30 bg-purple-950/40 p-4 text-sm text-white shadow-lg">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-purple-400">
        Your ROI Analysis
      </p>

      <p className="mb-1 font-medium text-purple-100 truncate">{roi.taskName}</p>

      <div className="mb-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-green-400">
          {fmt(roi.totalAnnualSavings)}
        </span>
        <span className="text-xs text-gray-400">/ year estimated savings</span>
      </div>

      {/* Automation potential bar */}
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>Automation potential</span>
          <span className="text-purple-300 font-medium">{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-700">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-green-400 transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-gray-400">Breakeven</p>
          <p className="font-semibold text-white">
            {roi.breakevenMonth < 999 ? `${roi.breakevenMonth} mo` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-gray-400">3-Year Value</p>
          <p className="font-semibold text-white">{fmt(roi.projection[2])}</p>
        </div>
      </div>

      <a
        href="https://neuralflowai.io#contact"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 py-2 text-center text-xs font-semibold text-white transition hover:opacity-90"
      >
        Book a Free Strategy Call →
      </a>
    </div>
  );
}
