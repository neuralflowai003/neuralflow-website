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

  // cycle phrases
  useState(() => {
    const id = setInterval(() => setPhraseIndex((i) => (i + 1) % scanPhrases.length), 1100);
    return () => clearInterval(id);
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] gap-8">
      {/* pulsing ring */}
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

      {/* progress bar */}
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
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-white/50">
        <span>{label}</span>
        <span className="font-mono text-cyan-400">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
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
  const [showMethod, setShowMethod] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');

  const live = calculateROI({ ...roi.inputs, estimatedMinutes: mins, frequencyPerWeek: freq, hourlyRate: rate });

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
    { year: 'Year 1', savings: Math.round(live.projection[0]) },
    { year: 'Year 2', savings: Math.round(live.projection[1]) },
    { year: 'Year 3', savings: Math.round(live.projection[2]) },
  ];

  const roiUrl = 'https://neuralflow-roi-production.up.railway.app/roi-calculator';

  const shareText = `Just ran my workflow through NeuralFlow AI's ROI calculator:\n\n✅ ${live.inputs.taskName}\n💰 ${fmt(live.totalAnnualSavings)}/year in potential savings\n📈 ${Math.round(live.automationPotential * 100)}% automatable\n⏱ Breakeven in ${live.breakevenMonth < 999 ? live.breakevenMonth + ' months' : 'under a year'}\n\nFind out what YOUR team is leaving on the table 👇`;

  const linkedInUrl = `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(roiUrl)}&title=${encodeURIComponent('AI Automation ROI Calculator')}&summary=${encodeURIComponent(shareText)}`;

  const xText = `Just found out I could save ${fmt(live.totalAnnualSavings)}/year by automating "${live.inputs.taskName}" — ${Math.round(live.automationPotential * 100)}% automatable, breakeven in ${live.breakevenMonth < 999 ? live.breakevenMonth + ' months' : 'under a year'}.\n\nCalculate yours 👇`;
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(roiUrl)}`;

  const ariaUrl = `https://neuralflowai.io/?roi_task=${encodeURIComponent(live.inputs.taskName)}&roi_savings=${encodeURIComponent(fmt(live.totalAnnualSavings))}&open_chat=1`;

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

      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Complexity + potential */}
        <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-4">
          <div>
            <p className="text-xs text-white/40 mb-2 uppercase tracking-wider">Complexity</p>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold font-mono text-white">{live.inputs.estimatedMinutes}<span className="text-sm text-white/40 ml-1">min</span></span>
            </div>
            <p className="text-xs text-white/30 mt-1">per run · {live.inputs.frequencyPerWeek}× / week</p>
          </div>
          <div>
            <div className="flex justify-between text-xs text-white/40 mb-1.5">
              <span>Automation Potential</span>
              <span className="text-emerald-400 font-mono">{Math.round(live.automationPotential * 100)}%</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 rounded-full transition-all duration-500"
                style={{ width: `${live.automationPotential * 100}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-white/40 mb-1">Breakeven</p>
            <p className="text-lg font-mono font-semibold text-white">
              {live.breakevenMonth < 999 ? `${live.breakevenMonth} months` : 'N/A'}
            </p>
          </div>
        </div>

        {/* ROI breakdown */}
        <div className="md:col-span-2 border border-white/10 rounded-xl p-5 bg-white/[0.02] space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">Annual Savings Breakdown</p>
          {[
            { label: 'Labor Savings', value: live.laborSavingsAnnual, color: 'text-cyan-400' },
            { label: 'Error Reduction', value: live.errorReductionAnnual, color: 'text-sky-400' },
            { label: 'Opportunity Cost Recovery', value: live.opportunityCostAnnual, color: 'text-indigo-400' },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2 border-b border-white/5">
              <span className="text-sm text-white/60">{row.label}</span>
              <span className={`font-mono font-semibold text-sm ${row.color}`}>{fmt(row.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-semibold text-white">Total Annual Savings</span>
            <motion.span
              key={live.totalAnnualSavings}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-mono font-bold text-2xl text-emerald-400"
            >
              {fmt(live.totalAnnualSavings)}
            </motion.span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="border border-white/10 rounded-xl p-5 bg-white/[0.02]">
        <p className="text-xs text-white/40 uppercase tracking-wider mb-4">3-Year Projection</p>
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
        <p className="text-xs text-white/40 uppercase tracking-wider">Adjust Assumptions</p>
        <SliderRow label="Minutes per run" value={mins} min={5} max={480} step={5} format={(v) => `${v} min`} onChange={setMins} />
        <SliderRow label="Runs per week" value={freq} min={1} max={50} step={1} format={(v) => `${v}×`} onChange={setFreq} />
        <SliderRow label="Hourly rate" value={rate} min={25} max={300} step={5} format={(v) => `$${v}/hr`} onChange={setRate} />
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

      {/* Methodology toggle */}
      <div className="border border-white/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowMethod((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          <span className="uppercase tracking-wider">View Methodology</span>
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
              <div className="px-5 pb-5 space-y-2 border-t border-white/5">
                <p className="text-xs text-white/30 mt-3 font-mono">Labor Savings = (minutes × runs/week × 52) ÷ 60 × hourly_rate × automation_potential</p>
                <p className="text-xs text-white/30 font-mono">Error Reduction = error_rate × cost_per_error × runs/year × automation_potential</p>
                <p className="text-xs text-white/30 font-mono">Opportunity Cost = hours_freed × hourly_rate × 0.5 (reallocation premium)</p>
                <p className="text-xs text-white/30 font-mono">Year 2 = Year 1 × 1.10 · Year 3 = Year 2 × 1.10 (10% compounding)</p>
                <p className="text-xs text-white/30 font-mono">Breakeven = ⌈implementation_cost ÷ (total_savings ÷ 12)⌉</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <a
          href={ariaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 bg-cyan-400 hover:bg-cyan-300 text-zinc-950 font-bold text-sm py-3.5 px-6 rounded-xl transition-colors"
        >
          Talk to ARIA About This →
        </a>
        <a
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-3.5 px-6 rounded-xl transition-colors"
        >
          Share on LinkedIn
        </a>
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-3.5 px-6 rounded-xl transition-colors"
        >
          Share on X
        </a>
      </div>

      {/* Email report capture */}
      <div className="border-t border-white/5 pt-6 space-y-3">
        {emailStatus === 'sent' ? (
          <p className="text-sm text-emerald-400 font-mono text-center">Report sent! Check your inbox.</p>
        ) : (
          <>
            <p className="text-xs text-white/40 uppercase tracking-wider">Email me this report</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); setEmailStatus('idle'); }}
                placeholder="Enter your email"
                className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-cyan-400/40 transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSubmit(); }}
              />
              <button
                onClick={handleEmailSubmit}
                disabled={emailStatus === 'sending'}
                className="flex items-center justify-center gap-2 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 hover:border-cyan-400/50 text-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold py-2.5 px-5 rounded-xl transition-colors whitespace-nowrap"
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

  // On mount: check for ?r= shareable URL param
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
    } catch {
      // bad param — stay on idle state
    }
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
        hourlyRate: 75,            // sensible default; user can adjust via slider
        errorRate: 0.08,
        costPerError: 200,
        automationPotential: data.automation_potential,
        implementationCost: 5000,
        suggestedPhases: data.suggested_phases ?? [],
      };

      const result = calculateROI(workflowData);
      localStorage.setItem('neuralflow_roi', JSON.stringify(result));
      setRoi(result);
      setState('results');
      try {
        const encoded = btoa(encodeURIComponent(JSON.stringify(result)));
        window.history.replaceState(null, '', `?r=${encoded}`);
      } catch {
        // URL update failed — non-critical
      }
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setState('error');
    }
  }, [input]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav strip */}
      <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <a href="/" className="text-lg font-bold">
          <span className="text-white">Neural</span>
          <span className="text-cyan-400">Flow</span>
        </a>
        <span className="text-xs font-mono tracking-widest text-white/30 uppercase">ROI Calculator</span>
      </div>

      <div className="px-6 py-16 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {/* ── Idle ── */}
          {state === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="max-w-2xl mx-auto text-center space-y-8"
            >
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 border border-cyan-400/20 bg-cyan-400/5 rounded-full px-4 py-1.5 text-xs text-cyan-400 font-mono tracking-wider uppercase">
                  ✦ AI-Powered ROI Analysis
                </div>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
                  What's your manual work<br />
                  <span className="text-cyan-400">actually costing you?</span>
                </h1>
                <p className="text-white/50 text-lg">
                  Describe a repetitive task your team handles. Our AI calculates the exact dollar value of automating it.
                </p>
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe a manual process your team does repeatedly...&#10;&#10;Example: &quot;Every Monday we pull sales data from three spreadsheets, reconcile it, and send a summary email to leadership. Takes about 2 hours, done weekly.&quot;"
                className="w-full h-44 bg-white/[0.03] border border-white/10 rounded-xl px-5 py-4 text-sm text-white placeholder-white/25 resize-none focus:outline-none focus:border-cyan-400/40 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) handleAnalyze();
                }}
              />

              <button
                onClick={handleAnalyze}
                disabled={input.trim().length < 10}
                className="w-full sm:w-auto bg-cyan-400 hover:bg-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-950 font-bold text-base py-3.5 px-10 rounded-xl transition-colors"
              >
                Analyze My Workflow →
              </button>

              <p className="text-xs text-white/20">⌘ + Enter to submit · No account needed</p>
            </motion.div>
          )}

          {/* ── Scanning ── */}
          {state === 'scanning' && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ScanningState />
            </motion.div>
          )}

          {/* ── Results ── */}
          {state === 'results' && roi && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResultsPanel roi={roi} onReset={() => { setState('idle'); setInput(''); setRoi(null); window.history.replaceState(null, '', window.location.pathname); }} />
            </motion.div>
          )}

          {/* ── Error ── */}
          {state === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-lg mx-auto text-center space-y-6"
            >
              <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-8 space-y-3">
                <p className="text-3xl">⚠️</p>
                <p className="text-white font-semibold">Couldn't analyze that workflow</p>
                <p className="text-sm text-white/50">{errorMsg}</p>
              </div>
              <button
                onClick={() => setState('idle')}
                className="border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 px-6 rounded-xl transition-colors"
              >
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

