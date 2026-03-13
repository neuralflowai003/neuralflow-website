'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { calculateROI, type ROIResult, type WorkflowData } from '@/lib/roi-engine';

// ── Types ──────────────────────────────────────────────────────────────────────
type PageState = 'idle' | 'scanning' | 'results' | 'error';
type WorkerType = 'hourly' | 'revenue';

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const scanPhrases = [
  'Identifying workflow steps…',
  'Calculating labor cost…',
  'Modeling automation ROI…',
  'Generating savings projection…',
  'Compiling efficiency report…',
];

// ── Scanning animation ─────────────────────────────────────────────────────────
function ScanningState() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  useState(() => {
    const id = setInterval(() => setPhraseIndex((i) => (i + 1) % scanPhrases.length), 1100);
    return () => clearInterval(id);
  });
  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] gap-8">
      <div className="relative">
        <motion.div
          className="w-24 h-24 rounded-full border-2 border-cyan-400/30"
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-0 w-24 h-24 rounded-full border-2 border-cyan-400/60"
          animate={{ scale: [1, 1.2, 1], opacity: [1, 0.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-cyan-400/20 border border-cyan-400/60 flex items-center justify-center">
            <motion.div
              className="w-4 h-4 rounded-full bg-cyan-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </div>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={phraseIndex}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35 }}
          className="text-cyan-400 font-mono text-sm tracking-widest uppercase"
        >
          {scanPhrases[phraseIndex]}
        </motion.p>
      </AnimatePresence>
      <div className="w-64 h-0.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </div>
  );
}

// ── Slider row ─────────────────────────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, format, onChange, description,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-white/50">
        <span>{label}</span>
        <span className="font-mono text-cyan-400">{format(value)}</span>
      </div>
      {description && <p className="text-xs text-white/30 mt-1">{description}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

// ── Chart tooltip ──────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
      <p className="text-white/50 mb-1">{label}</p>
      <p className="text-emerald-400 font-mono font-semibold">{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Results panel ──────────────────────────────────────────────────────────────
function ResultsPanel({ roi, onReset }: { roi: ROIResult; onReset: () => void }) {
  const [mins, setMins] = useState(roi.inputs.estimatedMinutes);
  const [freq, setFreq] = useState(roi.inputs.frequencyPerWeek);
  const [rate, setRate] = useState(roi.inputs.hourlyRate);
  const [workerType, setWorkerType] = useState<WorkerType>('hourly');
  const [revenuePerClient, setRevenuePerClient] = useState(65);
  const [serviceDuration, setServiceDuration] = useState(60);
  const [monthlyFee, setMonthlyFee] = useState(roi.inputs.monthlyFee ?? 450);
  const [setupFee, setSetupFee] = useState(roi.inputs.implementationCost);
  const [showMethod, setShowMethod] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');

  const effectiveRate =
    workerType === 'revenue' ? revenuePerClient / (serviceDuration / 60) : rate;

  const live = calculateROI({
    ...roi.inputs,
    estimatedMinutes: mins,
    frequencyPerWeek: freq,
    hourlyRate: effectiveRate,
    implementationCost: setupFee,
    monthlyFee,
  });

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = emailInput.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    setEmailStatus('sending');
    setEmailError('');
    try {
      const res = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, roi: live }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setEmailError(data.error ?? 'Failed to send. Please try again.');
        setEmailStatus('error');
      } else {
        setEmailStatus('sent');
      }
    } catch {
      setEmailError('Something went wrong. Please try again.');
      setEmailStatus('error');
    }
  }, [emailInput, live]);

  const chartData = [
    { year: 'Year 1', savings: Math.max(0, Math.round(live.netProjection[0])) },
    { year: 'Year 2', savings: Math.max(0, Math.round(live.netProjection[1])) },
    { year: 'Year 3', savings: Math.max(0, Math.round(live.netProjection[2])) },
  ];

  const roiUrl = 'https://roi.neuralflowai.io/roi-calculator';
  const shareText = `Just ran my workflow through NeuralFlow AI's ROI calculator:\n\n✅ ${live.inputs.taskName}\n💰 ${fmt(live.netOngoing)}/year NET savings after NeuralFlow fees\n📈 ${Math.round(live.automationPotential * 100)}% automatable\n⏱ Breakeven in ${live.breakevenMonth < 999 ? live.breakevenMonth + ' months' : 'under a year'}\n\nFind out what YOUR team is leaving on the table 👇`;
  const linkedInUrl = `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(roiUrl)}&title=${encodeURIComponent('AI Automation ROI Calculator')}&summary=${encodeURIComponent(shareText)}`;
  const xText = `Just found out I could NET ${fmt(live.netOngoing)}/year by automating "${live.inputs.taskName}" — ${Math.round(live.automationPotential * 100)}% automatable, breakeven in ${live.breakevenMonth < 999 ? live.breakevenMonth + ' months' : 'under a year'}.\n\nCalculate yours 👇`;
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(roiUrl)}`;
  const ariaUrl = `https://neuralflowai.io/?roi_task=${encodeURIComponent(live.inputs.taskName)}&roi_savings=${encodeURIComponent(fmt(live.netOngoing))}&open_chat=1`;

  const netColor = live.netOngoing >= 0 ? 'text-emerald-400' : 'text-red-400';
  const net1Color = live.netYear1 >= 0 ? 'text-emerald-400' : 'text-orange-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-4xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-mono tracking-widest text-cyan-400/70 uppercase mb-1">Analysis Complete</p>
          <h2 className="text-2xl font-bold text-white">{live.inputs.taskName}</h2>
        </div>
        <button onClick={onReset} className="text-xs text-white/30 hover:text-white/60 transition-colors mt-1">
          ← New analysis
        </button>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Gross Savings</p>
          <p className="text-lg font-mono font-bold text-white">{fmt(live.totalAnnualSavings)}</p>
          <p className="text-[10px] text-white/25 mt-0.5">what it costs you now</p>
        </div>
        <div className="border border-emerald-500/30 rounded-xl p-4 bg-emerald-500/5 text-center">
          <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider mb-1">Net (Year 2+)</p>
          <motion.p
            key={live.netOngoing}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`text-lg font-mono font-bold ${netColor}`}
          >
            {fmt(live.netOngoing)}
          </motion.p>
          <p className="text-[10px] text-white/25 mt-0.5">after NeuralFlow fees</p>
        </div>
        <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Automatable</p>
          <p className="text-lg font-mono font-bold text-white">{Math.round(live.automationPotential * 100)}%</p>
          <p className="text-[10px] text-white/25 mt-0.5">of this workflow</p>
        </div>
        <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Breakeven</p>
          <p className="text-lg font-mono font-bold text-white">
            {live.breakevenMonth < 999 ? `${live.breakevenMonth} mo` : 'N/A'}
          </p>
          <p className="text-[10px] text-white/25 mt-0.5">to recoup setup cost</p>
        </div>
      </div>

      {/* Savings breakdown */}
      <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-2">
        <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Full Savings Breakdown</p>
        {[
          { label: 'Labor Savings', value: live.laborSavingsAnnual, color: 'text-cyan-400' },
          { label: 'Error Reduction', value: live.errorReductionAnnual, color: 'text-sky-400' },
          { label: 'Opportunity Cost Recovery', value: live.opportunityCostAnnual, color: 'text-indigo-400' },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-white/5">
            <span className="text-sm text-white/50">{row.label}</span>
            <span className={`font-mono font-semibold text-sm ${row.color}`}>{fmt(row.value)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between py-2 border-b border-white/10">
          <span className="text-sm text-white/70 font-medium">Gross Annual Savings</span>
          <span className="font-mono font-semibold text-white text-sm">{fmt(live.totalAnnualSavings)}</span>
        </div>

        <p className="text-[10px] text-white/30 uppercase tracking-wider pt-1">NeuralFlow Investment</p>
        <div className="flex items-center justify-between py-1.5 border-b border-white/5">
          <span className="text-sm text-white/50">Monthly Service Fee (×12)</span>
          <span className="font-mono font-semibold text-sm text-orange-400">−{fmt(live.neuralflowMonthlyCost)}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-white/10">
          <span className="text-sm text-white/50">
            One-time Setup Fee{' '}
            <span className="text-[10px] text-white/25 ml-1">(Year 1 only)</span>
          </span>
          <span className="font-mono font-semibold text-sm text-orange-400">−{fmt(setupFee)}</span>
        </div>

        <div className="flex items-center justify-between py-2 border-b border-white/5">
          <span className="text-sm text-white/60">
            Net Year 1 <span className="text-[10px] text-white/30">(includes setup)</span>
          </span>
          <span className={`font-mono font-bold text-base ${net1Color}`}>{fmt(live.netYear1)}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-semibold text-white">Net Annual Savings (Year 2+)</span>
          <motion.span
            key={live.netOngoing}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`font-mono font-bold text-2xl ${netColor}`}
          >
            {fmt(live.netOngoing)}
          </motion.span>
        </div>
      </div>

      {/* Chart — net projection */}
      <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">3-Year Net Projection</p>
          <p className="text-[10px] text-white/25">After all NeuralFlow fees</p>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="year" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="savings" stroke="#10b981" strokeWidth={2} fill="url(#savingsGrad)" dot={{ fill: '#10b981', r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Sliders */}
      <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-5">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-wider">Fine-tune your numbers</p>
          <p className="text-xs text-white/30 mt-1">AI estimated these from your description — drag to correct them and everything recalculates instantly.</p>
        </div>

        {/* Worker type toggle */}
        <div>
          <p className="text-xs text-white/40 mb-2">How does the person doing this task get paid?</p>
          <div className="flex gap-2">
            {(['hourly', 'revenue'] as WorkerType[]).map((t) => (
              <button
                key={t}
                onClick={() => setWorkerType(t)}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${
                  workerType === t
                    ? 'bg-cyan-400/10 border-cyan-400/40 text-cyan-400'
                    : 'border-white/10 text-white/40 hover:text-white/60'
                }`}
              >
                {t === 'hourly' ? '💼 Hourly / Salary' : '💅 Revenue per Client'}
              </button>
            ))}
          </div>
        </div>

        <SliderRow
          label="Minutes per run"
          value={mins} min={5} max={480} step={5}
          format={(v) => `${v} min`}
          onChange={setMins}
          description="How long does this task take each time? For phone interruptions, think total time per day lost to calls and booking."
        />
        <SliderRow
          label="Runs per week"
          value={freq} min={1} max={100} step={1}
          format={(v) => `${v}×`}
          onChange={setFreq}
          description="How often does this happen? Daily = 5×, twice daily = 10×. For phone calls at a busy shop, total weekly call/interruption count."
        />

        {workerType === 'hourly' ? (
          <SliderRow
            label="Hourly rate"
            value={rate} min={12} max={150} step={1}
            format={(v) => `$${v}/hr`}
            onChange={setRate}
            description="Cost of the person doing this task. Annual salary ÷ 2,080 = hourly rate. NJ average for admin/front desk is $18–$28/hr."
          />
        ) : (
          <>
            <SliderRow
              label="Average revenue per client"
              value={revenuePerClient} min={20} max={500} step={5}
              format={(v) => `$${v}`}
              onChange={setRevenuePerClient}
              description="What does an average client spend per visit? (e.g. nail full set $65, haircut $45, massage $90, facial $80)"
            />
            <SliderRow
              label="Average service duration"
              value={serviceDuration} min={15} max={240} step={15}
              format={(v) => `${v} min`}
              onChange={setServiceDuration}
              description="How long does serving one client take? This determines your effective hourly earning rate."
            />
            <div className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-cyan-400/5 border border-cyan-400/15">
              <span className="text-white/40">Effective hourly value</span>
              <span className="font-mono text-cyan-400 font-semibold">
                ${Math.round(revenuePerClient / (serviceDuration / 60))}/hr
              </span>
            </div>
          </>
        )}

        {/* NeuralFlow investment */}
        <div className="pt-3 border-t border-white/5 space-y-4">
          <p className="text-xs text-white/40 uppercase tracking-wider">NeuralFlow Investment</p>
          <SliderRow
            label="Monthly service fee"
            value={monthlyFee} min={200} max={2000} step={50}
            format={(v) => `$${v}/mo`}
            onChange={setMonthlyFee}
            description="Adjust to match the quote from your NeuralFlow consultation."
          />
          <SliderRow
            label="One-time setup fee"
            value={setupFee} min={1000} max={15000} step={500}
            format={(v) => fmt(v)}
            onChange={setSetupFee}
            description="Adjust to match the quote from your NeuralFlow consultation. Every build is scoped individually."
          />
        </div>
      </div>

      {/* Phases */}
      {live.suggestedPhases.length > 0 && (
        <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">Implementation Roadmap</p>
          {live.suggestedPhases.map((phase, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="w-5 h-5 rounded-full bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-[10px] text-cyan-400 font-mono shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-sm text-white/60">{phase.replace(/^Phase \d+:\s*/, '')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Methodology */}
      <div className="border border-white/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowMethod((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          <span className="uppercase tracking-wider">How we calculate this</span>
          <span>{showMethod ? '−' : '+'}</span>
        </button>
        <AnimatePresence>
          {showMethod && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5 border-t border-white/5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: 'Labor Savings', color: 'text-cyan-400', bg: 'bg-cyan-400/5 border-cyan-400/15', formula: '(minutes × runs/week × 52) ÷ 60 × effective hourly rate × automation potential' },
                    { label: 'Error Reduction', color: 'text-sky-400', bg: 'bg-sky-400/5 border-sky-400/15', formula: 'error rate × cost per error × annual runs × automation potential' },
                    { label: 'Opportunity Cost', color: 'text-indigo-400', bg: 'bg-indigo-400/5 border-indigo-400/15', formula: 'hours freed × effective rate × 0.5 reallocation premium' },
                    { label: 'Net Savings', color: 'text-emerald-400', bg: 'bg-emerald-400/5 border-emerald-400/15', formula: 'Gross savings − (monthly fee × 12). Year 1 also subtracts one-time setup cost.' },
                    { label: '3-Year Growth', color: 'text-violet-400', bg: 'bg-violet-400/5 border-violet-400/15', formula: 'Gross compounds at 10%/yr. Chart and projection show net after fees.' },
                    { label: 'Breakeven', color: 'text-orange-400', bg: 'bg-orange-400/5 border-orange-400/15', formula: 'Setup cost ÷ (monthly gross savings − monthly fee), rounded up to nearest month' },
                  ].map((card) => (
                    <div key={card.label} className={`rounded-lg border p-3.5 ${card.bg}`}>
                      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${card.color}`}>{card.label}</p>
                      <p className="text-xs text-white/50 leading-relaxed">{card.formula}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <a href={ariaUrl} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 bg-cyan-400 hover:bg-cyan-300 text-zinc-950 font-bold text-sm py-3.5 px-6 rounded-xl transition-colors">
          Talk to ARIA About This →
        </a>
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-3.5 px-6 rounded-xl transition-colors">
          Share on LinkedIn
        </a>
        <a href={xUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-3.5 px-6 rounded-xl transition-colors">
          Share on X
        </a>
      </div>

      {/* Email report */}
      <div className="border-t border-white/5 pt-6 space-y-3">
        {emailStatus === 'sent' ? (
          <p className="text-sm text-emerald-400 font-mono text-center">Report sent! Check your inbox.</p>
        ) : (
          <>
            <p className="text-xs text-white/40 uppercase tracking-wider">Email me this report</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email" value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); setEmailStatus('idle'); }}
                placeholder="Enter your email"
                className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-cyan-400/40 transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSubmit(); }}
              />
              <button
                onClick={handleEmailSubmit} disabled={emailStatus === 'sending'}
                className="flex items-center justify-center gap-2 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 hover:border-cyan-400/50 text-cyan-400 disabled:opacity-40 text-sm font-semibold py-2.5 px-5 rounded-xl transition-colors whitespace-nowrap"
              >
                {emailStatus === 'sending' ? 'Sending…' : 'Email me this report'}
              </button>
            </div>
            {emailError && <p className="text-xs text-red-400">{emailError}</p>}
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ROICalculatorPage() {
  const [state, setState] = useState<PageState>('idle');
  const [input, setInput] = useState('');
  const [roi, setRoi] = useState<ROIResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('r');
      if (r) {
        const result = JSON.parse(decodeURIComponent(atob(r))) as ROIResult;
        localStorage.setItem('neuralflow_roi', JSON.stringify(result));
        setRoi(result);
        setState('results');
      }
    } catch { /* bad param — stay idle */ }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!input.trim()) return;
    setState('scanning');
    try {
      const res = await fetch('/api/analyze-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: input }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? 'Analysis failed.');
        setState('error');
        return;
      }

      const workflowData: WorkflowData = {
        taskName: data.task_name,
        estimatedMinutes: data.estimated_minutes,
        frequencyPerWeek: data.frequency_per_week,
        hourlyRate: 25,             // realistic NJ default for admin/service work
        errorRate: 0.08,
        costPerError: 200,
        automationPotential: data.automation_potential,
        implementationCost: 3000,   // typical NeuralFlow setup
        monthlyFee: 450,            // typical NeuralFlow monthly
        suggestedPhases: data.suggested_phases ?? [],
      };

      const result = calculateROI(workflowData);
      localStorage.setItem('neuralflow_roi', JSON.stringify(result));
      setRoi(result);
      setState('results');
      try {
        const encoded = btoa(encodeURIComponent(JSON.stringify(result)));
        window.history.replaceState(null, '', `?r=${encoded}`);
      } catch { /* non-critical */ }
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setState('error');
    }
  }, [input]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <a href="/" className="text-lg font-bold">
          <span className="text-white">Neural</span>
          <span className="text-cyan-400">Flow</span>
        </a>
        <span className="text-xs font-mono tracking-widest text-white/30 uppercase">ROI Calculator</span>
      </div>

      <div className="px-6 py-16 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="max-w-2xl mx-auto text-center space-y-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 border border-cyan-400/20 bg-cyan-400/5 rounded-full px-4 py-1.5 text-xs text-cyan-400 font-mono tracking-wider uppercase">
                  ✦ AI-Powered ROI Analysis
                </div>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
                  What's your manual work<br />
                  <span className="text-cyan-400">actually costing you?</span>
                </h1>
                <p className="text-white/50 text-lg">
                  Describe a repetitive task your team handles. Our AI calculates the real net savings after paying for NeuralFlow — no inflated numbers.
                </p>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe your situation in plain English...&#10;&#10;Examples:&#10;&quot;I own a nail salon. My techs stop mid-service to answer the phone, we miss bookings, and our no-show rate kills us.&quot;&#10;&#10;&quot;Every Monday we pull sales data from three spreadsheets, reconcile it, and email leadership. Takes 2 hours.&quot;"
                className="w-full h-48 bg-white/[0.03] border border-white/10 rounded-xl px-5 py-4 text-sm text-white placeholder-white/25 resize-none focus:outline-none focus:border-cyan-400/40 transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleAnalyze(); }}
              />
              <button
                onClick={handleAnalyze} disabled={input.trim().length < 10}
                className="w-full sm:w-auto bg-cyan-400 hover:bg-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-950 font-bold text-base py-3.5 px-10 rounded-xl transition-colors"
              >
                Analyze My Workflow →
              </button>
              <p className="text-xs text-white/20">⌘ + Enter to submit · No account needed · Net savings shown after NeuralFlow fees</p>
            </motion.div>
          )}

          {state === 'scanning' && (
            <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ScanningState />
            </motion.div>
          )}

          {state === 'results' && roi && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResultsPanel roi={roi} onReset={() => { setState('idle'); setInput(''); setRoi(null); window.history.replaceState(null, '', window.location.pathname); }} />
            </motion.div>
          )}

          {state === 'error' && (
            <motion.div key="error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="max-w-lg mx-auto text-center space-y-6">
              <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-8 space-y-3">
                <p className="text-3xl">⚠️</p>
                <p className="text-white font-semibold">Couldn't analyze that workflow</p>
                <p className="text-sm text-white/50">{errorMsg}</p>
              </div>
              <button onClick={() => setState('idle')}
                className="border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 px-6 rounded-xl transition-colors">
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
