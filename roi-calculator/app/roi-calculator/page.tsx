'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { calculateROI, type ROIResult, type WorkflowData } from '@/lib/roi-engine';

// ── Types ──────────────────────────────────────────────────────────────────────
type PageState = 'idle' | 'scanning' | 'results' | 'error';
type WorkerType = 'hourly' | 'revenue';
type Industry =
  | 'nail_salon' | 'dental' | 'real_estate' | 'restaurant'
  | 'plumber' | 'electrician' | 'contractor' | 'general';

interface IndustryPreset {
  label: string;
  emoji: string;
  prompt: string;
  avgJobValue: number;
  missedCallsPerWeek: number;
  workerType: WorkerType;
  revenuePerClient: number;
  serviceDuration: number;
}

const INDUSTRY_PRESETS: Record<Industry, IndustryPreset> = {
  nail_salon: {
    label: 'Nail Salon / Med Spa', emoji: '💅',
    prompt: "I own a nail salon. My techs stop mid-service to answer the phone, we miss bookings constantly, and our no-show rate is around 15%. I spend 2+ hours a week on scheduling, reminder calls, and chasing down clients. We miss 6–10 calls a day when everyone is with clients.",
    avgJobValue: 65, missedCallsPerWeek: 35, workerType: 'revenue', revenuePerClient: 65, serviceDuration: 60,
  },
  dental: {
    label: 'Dental / Medical', emoji: '🦷',
    prompt: "I run a dental practice. My front desk spends 3+ hours a day on appointment reminders, rescheduling no-shows, and insurance follow-up calls. We miss 5–10 calls per day when staff are busy with patients.",
    avgJobValue: 280, missedCallsPerWeek: 25, workerType: 'revenue', revenuePerClient: 280, serviceDuration: 60,
  },
  real_estate: {
    label: 'Real Estate', emoji: '🏠',
    prompt: "I'm a real estate agent. I spend 10+ hours a week manually following up with leads, scheduling showings, and sending listing updates. I lose potential clients because I can't respond fast enough — if I don't answer within 5 minutes, they call someone else.",
    avgJobValue: 8500, missedCallsPerWeek: 15, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
  restaurant: {
    label: 'Restaurant', emoji: '🍽',
    prompt: "I own a restaurant. We handle reservations and takeout orders over the phone. Staff miss calls during rush hours and spend significant time taking orders. I also need to send review follow-up messages manually after each visit.",
    avgJobValue: 45, missedCallsPerWeek: 40, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
  plumber: {
    label: 'Plumber', emoji: '🔧',
    prompt: "I run a plumbing business. I miss calls constantly when I'm on job sites and lose jobs to competitors who answer first. I spend my evenings calling back leads, scheduling jobs, and sending quotes manually. Takes 2–3 hours a night.",
    avgJobValue: 350, missedCallsPerWeek: 20, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
  electrician: {
    label: 'Electrician', emoji: '⚡',
    prompt: "I'm an electrician. I miss incoming calls all day while on job sites — by the time I call back, the customer already hired someone else. I also spend 2–3 hours a week on scheduling and sending estimates.",
    avgJobValue: 420, missedCallsPerWeek: 18, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
  contractor: {
    label: 'General Contractor', emoji: '🏗',
    prompt: "I run a general contracting business. I miss calls while on job sites and lose bids because I'm slow to respond. I spend 5+ hours a week manually following up with leads, scheduling estimates, and sending invoices.",
    avgJobValue: 1200, missedCallsPerWeek: 12, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
  general: {
    label: 'General Business', emoji: '💼',
    prompt: '',
    avgJobValue: 200, missedCallsPerWeek: 10, workerType: 'hourly', revenuePerClient: 0, serviceDuration: 60,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function breakevenDisplay(months: number): string {
  if (months >= 999) return 'N/A';
  const weeks = Math.round(months * 4.33);
  if (weeks <= 11) return `${weeks} wks`;
  return `${months} mo`;
}

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
      <div className="relative flex items-center justify-center">
        {/* Outer pulse ring */}
        <motion.div
          className="absolute w-28 h-28 rounded-full"
          style={{ border: '1px solid rgba(255,107,43,0.25)' }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Middle ring */}
        <motion.div
          className="absolute w-20 h-20 rounded-full"
          style={{ border: '1px solid rgba(123,97,255,0.4)' }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.8, 0.1, 0.8] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />
        {/* Center orb */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(255,107,43,0.2), rgba(123,97,255,0.2))', border: '1px solid rgba(255,107,43,0.4)' }}
        >
          <motion.div
            className="w-5 h-5 rounded-full"
            style={{ background: 'linear-gradient(135deg, #FF6B2B, #7B61FF)' }}
            animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={phraseIndex}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35 }}
          className="font-mono text-sm tracking-widest uppercase"
          style={{ color: '#FF6B2B' }}
        >
          {scanPhrases[phraseIndex]}
        </motion.p>
      </AnimatePresence>

      {/* Progress bar */}
      <div className="w-64 h-px rounded-full overflow-hidden" style={{ background: 'rgba(16,16,20,0.08)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #FF6B2B, #7B61FF)' }}
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <p className="text-xs tracking-wider" style={{ color: '#9a9890' }}>Analyzing your workflow with AI…</p>
    </div>
  );
}

// ── Slider row ─────────────────────────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, format, onChange, description, tooltip,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; description?: string; tooltip?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs" style={{ color: '#55555F' }}>
        <span className="flex items-center gap-1.5">
          {label}
          {tooltip && (
            <span className="relative">
              <button
                onMouseEnter={() => setShowTip(true)}
                onMouseLeave={() => setShowTip(false)}
                onFocus={() => setShowTip(true)}
                onBlur={() => setShowTip(false)}
                aria-label={`More info about ${label}`}
                className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold leading-none transition-colors"
                style={{ border: '1px solid rgba(16,16,20,0.10)', color: '#9a9890' }}
              >?</button>
              {showTip && (
                <div
                  role="tooltip"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed z-10 pointer-events-none shadow-2xl"
                  style={{ background: '#FFFFFF', border: '1px solid #E6E4DE', color: 'rgba(16,16,20,0.92)', boxShadow: '0 24px 50px -32px rgba(16,16,20,0.25)' }}
                >
                  {tooltip}
                </div>
              )}
            </span>
          )}
        </span>
        <span className="font-mono font-semibold" style={{ color: '#FF6B2B' }}>{format(value)}</span>
      </div>
      {description && <p className="text-xs mt-1" style={{ color: '#9a9890' }}>{description}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="w-full"
      />
    </div>
  );
}

// ── Chart tooltip ──────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2.5 text-xs shadow-xl" style={{ background: '#FFFFFF', border: '1px solid #E6E4DE', boxShadow: '0 24px 50px -32px rgba(16,16,20,0.25)' }}>
      <p className="mb-1" style={{ color: '#9a9890' }}>{label}</p>
      <p className="font-mono font-semibold" style={{ color: '#FF6B2B' }}>{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Glass card wrapper ─────────────────────────────────────────────────────────
function GlassCard({ children, className = '', accent = false }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: '#FFFFFF',
        border: accent ? '1px solid rgba(242,90,28,0.22)' : '1px solid #E6E4DE',
        boxShadow: '0 24px 50px -32px rgba(16,16,20,0.25)',
      }}
    >
      {children}
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: 'rgba(255,107,43,0.7)' }}>
      {children}
    </p>
  );
}

// ── Results panel ──────────────────────────────────────────────────────────────
function ResultsPanel({
  roi, onReset, industry, initialMissedCalls, initialJobValue, leadName, leadEmail, leadPhone,
}: {
  roi: ROIResult;
  onReset: () => void;
  industry?: Industry;
  initialMissedCalls?: number;
  initialJobValue?: number;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
}) {
  const [mins, setMins] = useState(roi.inputs.estimatedMinutes);
  const [freq, setFreq] = useState(roi.inputs.frequencyPerWeek);
  const [rate, setRate] = useState(roi.inputs.hourlyRate);
  const [workerType, setWorkerType] = useState<WorkerType>(
    industry && INDUSTRY_PRESETS[industry]?.workerType === 'revenue' ? 'revenue' : 'hourly'
  );
  const [revenuePerClient, setRevenuePerClient] = useState(
    industry ? INDUSTRY_PRESETS[industry].revenuePerClient || 65 : 65
  );
  const [serviceDuration, setServiceDuration] = useState(
    industry ? INDUSTRY_PRESETS[industry].serviceDuration : 60
  );
  const [monthlyFee, setMonthlyFee] = useState(roi.inputs.monthlyFee ?? 450);
  const [setupFee, setSetupFee] = useState(roi.inputs.implementationCost);
  const [missedCalls, setMissedCalls] = useState(initialMissedCalls ?? 10);
  const [avgJobValue, setAvgJobValue] = useState(initialJobValue ?? 200);
  const [includeMissed, setIncludeMissed] = useState(!!(initialMissedCalls && initialJobValue));
  const [showMethod, setShowMethod] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    fetch('https://neuralflowai.io/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'roi_calculated',
        data: {
          taskName: roi.inputs.taskName,
          netOngoing: Math.round(roi.netOngoing),
          breakeven: roi.breakevenMonth,
          autoPercent: Math.round(roi.automationPotential * 100),
          industry: industry ?? 'general',
          leadName: leadName ?? '',
          leadEmail: leadEmail ?? '',
          leadPhone: leadPhone ?? '',
        }
      })
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveRate =
    workerType === 'revenue' ? revenuePerClient / (serviceDuration / 60) : rate;

  const missedRevenueMonthly = includeMissed
    ? Math.round(missedCalls * 4.33 * avgJobValue * 0.30)
    : 0;

  const live = calculateROI({
    ...roi.inputs,
    estimatedMinutes: mins,
    frequencyPerWeek: freq,
    hourlyRate: effectiveRate,
    implementationCost: setupFee,
    monthlyFee,
    missedRevenueMonthly,
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
  const ariaContext = btoa(encodeURIComponent(JSON.stringify({
    taskName: live.inputs.taskName,
    gross: Math.round(live.totalAnnualSavings),
    netY1: Math.round(live.netYear1),
    netOngoing: Math.round(live.netOngoing),
    breakeven: live.breakevenMonth,
    autoPercent: Math.round(live.automationPotential * 100),
    industry: industry ?? 'general',
    hoursFreed: Math.round(live.hoursPerYear),
    leadName: leadName ?? '',
    leadEmail: leadEmail ?? '',
    leadPhone: leadPhone ?? '',
  })));
  const ariaUrl = `https://neuralflowai.io/?aria_roi=${encodeURIComponent(ariaContext)}`;

  const netPositive = live.netOngoing >= 0;
  const net1Positive = live.netYear1 >= 0;
  const hoursFreedPerWeek = Math.round(live.hoursPerYear / 52 * 10) / 10;

  const pitchBreakeven = breakevenDisplay(live.breakevenMonth);
  const pitchLine = live.netOngoing > 0
    ? `Automating "${live.inputs.taskName}" frees up ${Math.round(live.hoursPerYear)} hours a year and nets you ${fmt(live.netOngoing)}/yr after all NeuralFlow fees. Setup pays for itself in ${pitchBreakeven}.`
    : `Your workflow takes ${Math.round(live.hoursPerYear)} hours/yr to run manually. With current pricing, adjust the fee sliders below to see when automation becomes net positive.`;

  // ── Smart insight: surface the single biggest savings lever + ROI multiple ──
  const levers = [
    { label: 'reclaimed labor time', value: live.laborSavingsAnnual },
    { label: 'recovered missed-lead revenue', value: live.missedRevenueAnnual },
    { label: 'eliminating costly errors', value: live.errorReductionAnnual },
    { label: 'redeployed team capacity', value: live.opportunityCostAnnual },
  ].sort((a, b) => b.value - a.value);
  const topLever = levers[0];
  const topLeverShare = live.totalAnnualSavings > 0 ? Math.round((topLever.value / live.totalAnnualSavings) * 100) : 0;
  const roiX = (live.roiMultiple ?? 0) >= 1 ? `${live.roiMultiple.toFixed(1)}×` : `${Math.round((live.roiMultiple ?? 0) * 100)}%`;
  const insightLine =
    live.netOngoing > 0 && topLever.value > 0
      ? `Biggest lever: ${topLever.label} — ${fmt(topLever.value)}/yr (${topLeverShare}% of the total). Every $1 invested returns ${roiX} in steady-state savings.`
      : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-4xl mx-auto space-y-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono tracking-widest uppercase mb-1.5" style={{ color: 'rgba(255,107,43,0.6)' }}>
            Analysis Complete
          </p>
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: '#101014' }}>
            {live.inputs.taskName}
          </h2>
        </div>
        <button
          onClick={onReset}
          className="text-xs transition-colors mt-1 whitespace-nowrap"
          style={{ color: '#9a9890' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#55555F')}
          onMouseLeave={e => (e.currentTarget.style.color = '#9a9890')}
        >
          ← New analysis
        </button>
      </div>

      {/* Pitch banner */}
      {live.netOngoing > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl px-5 py-4"
          style={{
            background: 'linear-gradient(135deg, rgba(255,107,43,0.10), rgba(123,97,255,0.08))',
            backdropFilter: 'blur(16px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.5)',
            border: '1px solid rgba(255,107,43,0.22)',
            boxShadow: '0 20px 44px -30px rgba(16,16,20,0.30), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,107,43,0.7)' }}>Your ROI Summary</p>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(16,16,20,0.92)' }}>{pitchLine}</p>
          {insightLine && (
            <p className="text-sm leading-relaxed mt-2 pt-2.5" style={{ color: '#55555F', borderTop: '1px solid rgba(16,16,20,0.08)' }}>
              <span aria-hidden="true">💡 </span>{insightLine}
            </p>
          )}
        </motion.div>
      )}

      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Gross Savings', value: fmt(live.totalAnnualSavings), sub: 'what it costs now', color: 'rgba(16,16,20,0.92)', accent: false },
          { label: 'Net Year 2+', value: fmt(live.netOngoing), sub: 'after NeuralFlow fees', color: netPositive ? '#0B9E5E' : '#C42348', accent: true },
          { label: 'Hours Freed', value: `${Math.round(live.hoursPerYear)}`, sub: `${hoursFreedPerWeek} hrs/wk`, color: 'rgba(16,16,20,0.92)', accent: false },
          { label: 'Automatable', value: `${Math.round(live.automationPotential * 100)}%`, sub: 'of this workflow', color: 'rgba(16,16,20,0.92)', accent: false },
          { label: 'Breakeven', value: breakevenDisplay(live.breakevenMonth), sub: 'to recoup setup', color: 'rgba(16,16,20,0.92)', accent: false },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="rounded-2xl p-4 text-center"
            style={{
              background: card.accent
                ? 'linear-gradient(140deg, rgba(255,107,43,0.14), rgba(123,97,255,0.08))'
                : 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(14px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(14px) saturate(1.5)',
              border: card.accent ? '1px solid rgba(242,90,28,0.3)' : '1px solid rgba(255,255,255,0.7)',
              boxShadow: '0 24px 50px -32px rgba(16,16,20,0.25), inset 0 1px 0 rgba(255,255,255,0.85)',
            }}
          >
            <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: '#9a9890' }}>{card.label}</p>
            <motion.p
              key={card.value}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-base font-mono font-bold"
              style={{ color: card.color, fontFamily: 'var(--font-display)' }}
            >
              {card.value}
            </motion.p>
            <p className="text-[9px] mt-0.5" style={{ color: '#9a9890' }}>{card.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Before vs After */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'rgba(196,35,72,0.05)', border: '1px solid rgba(196,35,72,0.18)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-4" style={{ color: '#C42348' }}>Without Automation</p>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span style={{ color: '#55555F' }}>Annual labor cost</span>
              <span className="font-mono" style={{ color: '#C42348' }}>{fmt(live.laborSavingsAnnual / live.automationPotential)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#55555F' }}>Hours lost per year</span>
              <span className="font-mono" style={{ color: '#C42348' }}>{Math.round(live.hoursPerYear)} hrs</span>
            </div>
            {live.missedRevenueAnnual > 0 && (
              <div className="flex justify-between text-sm">
                <span style={{ color: '#55555F' }}>Missed lead revenue</span>
                <span className="font-mono" style={{ color: '#C42348' }}>{fmt(live.missedRevenueAnnual)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl p-5" style={{ background: 'rgba(255,107,43,0.04)', border: '1px solid rgba(255,107,43,0.2)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-4" style={{ color: 'rgba(255,107,43,0.7)' }}>With NeuralFlow</p>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span style={{ color: '#55555F' }}>Net savings (Year 2+)</span>
              <span className="font-mono font-semibold" style={{ color: netPositive ? '#0B9E5E' : '#C42348' }}>{fmt(live.netOngoing)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#55555F' }}>Hours reclaimed/yr</span>
              <span className="font-mono" style={{ color: '#FF6B2B' }}>{Math.round(live.hoursPerYear * live.automationPotential)} hrs</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: '#55555F' }}>Breakeven</span>
              <span className="font-mono" style={{ color: '#FF6B2B' }}>{breakevenDisplay(live.breakevenMonth)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Savings breakdown */}
      <GlassCard>
        <SectionLabel>Full Savings Breakdown</SectionLabel>
        <div className="space-y-0">
          {[
            { label: 'Labor Savings', value: live.laborSavingsAnnual, color: '#FF6B2B' },
            { label: 'Error Reduction', value: live.errorReductionAnnual, color: '#7B61FF' },
            { label: 'Opportunity Cost Recovery', value: live.opportunityCostAnnual, color: 'rgba(255,107,43,0.7)' },
            ...(live.missedRevenueAnnual > 0 ? [{ label: 'Missed Lead Revenue Recovery', value: live.missedRevenueAnnual, color: '#a78bfa' }] : []),
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(16,16,20,0.08)' }}>
              <span className="text-sm" style={{ color: '#55555F' }}>{row.label}</span>
              <span className="font-mono font-semibold text-sm" style={{ color: row.color }}>{fmt(row.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(16,16,20,0.08)' }}>
            <span className="text-sm font-medium" style={{ color: 'rgba(16,16,20,0.92)' }}>Gross Annual Savings</span>
            <span className="font-mono font-semibold text-sm" style={{ color: '#101014' }}>{fmt(live.totalAnnualSavings)}</span>
          </div>

          <p className="text-[9px] uppercase tracking-widest pt-3 pb-1" style={{ color: '#9a9890' }}>NeuralFlow Investment</p>
          <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(16,16,20,0.08)' }}>
            <span className="text-sm" style={{ color: '#55555F' }}>Monthly Service Fee (×12)</span>
            <span className="font-mono font-semibold text-sm" style={{ color: '#C42348' }}>−{fmt(live.neuralflowMonthlyCost)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(16,16,20,0.08)' }}>
            <span className="text-sm" style={{ color: '#55555F' }}>
              One-time Setup Fee{' '}
              <span className="text-[10px] ml-1" style={{ color: '#9a9890' }}>(Year 1 only)</span>
            </span>
            <span className="font-mono font-semibold text-sm" style={{ color: '#C42348' }}>−{fmt(setupFee)}</span>
          </div>

          <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid rgba(16,16,20,0.08)' }}>
            <span className="text-sm" style={{ color: '#55555F' }}>
              Net Year 1 <span className="text-[10px] ml-1" style={{ color: '#9a9890' }}>(includes setup)</span>
            </span>
            <span className="font-mono font-bold text-base" style={{ color: net1Positive ? '#0B9E5E' : '#f97316' }}>{fmt(live.netYear1)}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm font-semibold" style={{ color: '#101014' }}>Net Annual Savings (Year 2+)</span>
            <motion.span
              key={live.netOngoing}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="font-mono font-bold text-2xl"
              style={{ color: netPositive ? '#0B9E5E' : '#C42348', fontFamily: 'var(--font-display)' }}
            >
              {fmt(live.netOngoing)}
            </motion.span>
          </div>
        </div>
      </GlassCard>

      {/* Chart */}
      <GlassCard>
        <div className="flex items-center justify-between mb-5">
          <SectionLabel>3-Year Net Projection</SectionLabel>
          <p className="text-[10px]" style={{ color: '#9a9890' }}>After all NeuralFlow fees</p>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#FF6B2B" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#FF6B2B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(16,16,20,0.08)" />
            <XAxis dataKey="year" tick={{ fill: '#9a9890', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9a9890', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="savings" stroke="#FF6B2B" strokeWidth={2} fill="url(#savingsGrad)" dot={{ fill: '#FF6B2B', r: 4, strokeWidth: 0 }} activeDot={{ fill: '#FF6B2B', r: 5, strokeWidth: 2, stroke: 'rgba(255,107,43,0.4)' }} />
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Sliders */}
      <GlassCard>
        <SectionLabel>Fine-tune your numbers</SectionLabel>
        <p className="text-xs mb-5" style={{ color: '#9a9890' }}>AI estimated these from your description — drag to correct them and everything recalculates instantly.</p>

        {/* Worker type toggle */}
        <div className="mb-5">
          <p className="text-xs mb-2.5" style={{ color: '#9a9890' }}>How does the person doing this task get paid?</p>
          <div className="flex gap-2" role="group" aria-label="Worker payment type">
            {(['hourly', 'revenue'] as WorkerType[]).map((t) => (
              <button
                key={t}
                onClick={() => setWorkerType(t)}
                aria-pressed={workerType === t}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-medium transition-all"
                style={workerType === t
                  ? { background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.35)', color: '#FF6B2B' }
                  : { background: 'transparent', border: '1px solid rgba(16,16,20,0.08)', color: '#9a9890' }
                }
              >
                {t === 'hourly' ? '💼 Hourly / Salary' : '💅 Revenue per Client'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <SliderRow
            label="Minutes per run"
            value={mins} min={5} max={480} step={5}
            format={(v) => `${v} min`}
            onChange={setMins}
            tooltip="How long does this task take each time it runs?"
            description="For phone interruptions, think total time per day lost to calls and booking."
          />
          <SliderRow
            label="Runs per week"
            value={freq} min={1} max={100} step={1}
            format={(v) => `${v}×`}
            onChange={setFreq}
            tooltip="How many times per week does this task happen?"
            description="Daily = 5×, twice daily = 10×. For phone calls at a busy shop, total weekly call/interruption count."
          />

          {workerType === 'hourly' ? (
            <SliderRow
              label="Hourly rate"
              value={rate} min={12} max={150} step={1}
              format={(v) => `$${v}/hr`}
              onChange={setRate}
              tooltip="Annual salary ÷ 2,080 = hourly rate."
              description="Cost of the person doing this task. NJ average for admin/front desk is $18–$28/hr."
            />
          ) : (
            <>
              <SliderRow
                label="Average revenue per client"
                value={revenuePerClient} min={20} max={500} step={5}
                format={(v) => `$${v}`}
                onChange={setRevenuePerClient}
                tooltip="What does an average client spend per visit?"
                description="e.g. nail full set $65, haircut $45, massage $90, dental cleaning $280"
              />
              <SliderRow
                label="Average service duration"
                value={serviceDuration} min={15} max={240} step={15}
                format={(v) => `${v} min`}
                onChange={setServiceDuration}
                tooltip="How long does serving one client take? Determines your effective hourly earning rate."
              />
              <div className="flex items-center justify-between text-xs py-2 px-3 rounded-xl" style={{ background: 'rgba(255,107,43,0.05)', border: '1px solid rgba(255,107,43,0.15)' }}>
                <span style={{ color: '#9a9890' }}>Effective hourly value</span>
                <span className="font-mono font-semibold" style={{ color: '#FF6B2B' }}>
                  ${Math.round(revenuePerClient / (serviceDuration / 60))}/hr
                </span>
              </div>
            </>
          )}

          {/* Missed revenue */}
          <div className="pt-4 space-y-4" style={{ borderTop: '1px solid rgba(16,16,20,0.08)' }}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'rgba(123,97,255,0.7)' }}>Missed Lead Revenue</p>
              <button
                onClick={() => setIncludeMissed((v) => !v)}
                aria-expanded={includeMissed}
                aria-controls="missed-revenue-section"
                className="text-xs px-3 py-1 rounded-full transition-all"
                style={includeMissed
                  ? { background: 'rgba(123,97,255,0.1)', border: '1px solid rgba(123,97,255,0.35)', color: '#7B61FF' }
                  : { background: 'transparent', border: '1px solid rgba(16,16,20,0.08)', color: '#9a9890' }
                }
              >
                {includeMissed ? 'Included ✓' : 'Add this'}
              </button>
            </div>
            {includeMissed && (
              <motion.div id="missed-revenue-section" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-xs" style={{ color: '#9a9890' }}>
                  Estimate revenue you're losing from missed calls or slow follow-up. We assume 30% of those calls convert if answered instantly.
                </p>
                <SliderRow
                  label="Missed calls / leads per week"
                  value={missedCalls} min={1} max={100} step={1}
                  format={(v) => `${v}×/wk`}
                  onChange={setMissedCalls}
                  tooltip="How many inbound calls or leads go unanswered or receive a slow response each week?"
                />
                <SliderRow
                  label="Average job / ticket value"
                  value={avgJobValue} min={25} max={5000} step={25}
                  format={(v) => fmt(v)}
                  onChange={setAvgJobValue}
                  tooltip="What's the average revenue from a single job, appointment, or client?"
                />
                <div className="flex items-center justify-between text-xs py-2 px-3 rounded-xl" style={{ background: 'rgba(123,97,255,0.05)', border: '1px solid rgba(123,97,255,0.15)' }}>
                  <span style={{ color: '#9a9890' }}>Recoverable monthly revenue</span>
                  <span className="font-mono font-semibold" style={{ color: '#7B61FF' }}>{fmt(missedRevenueMonthly)}/mo</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* NeuralFlow investment */}
          <div className="pt-4 space-y-4" style={{ borderTop: '1px solid rgba(16,16,20,0.08)' }}>
            <SectionLabel>NeuralFlow Investment</SectionLabel>
            <SliderRow
              label="Monthly service fee"
              value={monthlyFee} min={200} max={2000} step={50}
              format={(v) => `$${v}/mo`}
              onChange={setMonthlyFee}
              tooltip="Adjust to match the quote from your NeuralFlow consultation."
            />
            <SliderRow
              label="One-time setup fee"
              value={setupFee} min={1000} max={15000} step={500}
              format={(v) => fmt(v)}
              onChange={setSetupFee}
              tooltip="Every build is scoped individually. Adjust to match your NeuralFlow quote."
            />
          </div>
        </div>
      </GlassCard>

      {/* Phases / Roadmap */}
      {live.suggestedPhases.length > 0 && (
        <GlassCard accent>
          <SectionLabel>Implementation Roadmap</SectionLabel>
          <div className="space-y-3 mt-1">
            {live.suggestedPhases.map((phase, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className="flex gap-3 items-start"
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg, #FF6B2B, #7B61FF)', color: '#fff' }}
                >
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(16,16,20,0.92)' }}>
                  {phase.replace(/^Phase \d+:\s*/, '')}
                </p>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Methodology accordion */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(16,16,20,0.08)' }}>
        <button
          onClick={() => setShowMethod((v) => !v)}
          aria-expanded={showMethod}
          aria-controls="methodology-content"
          className="w-full flex items-center justify-between px-5 py-3.5 text-xs transition-colors"
          style={{ color: '#9a9890' }}
        >
          <span className="uppercase tracking-widest">How we calculate this</span>
          <span aria-hidden="true" style={{ color: '#FF6B2B' }}>{showMethod ? '−' : '+'}</span>
        </button>
        <AnimatePresence>
          {showMethod && (
            <motion.div
              id="methodology-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(16,16,20,0.08)' }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: 'Labor Savings', color: '#FF6B2B', bg: 'rgba(255,107,43,0.05)', border: 'rgba(255,107,43,0.15)', formula: '(minutes × runs/week × 52) ÷ 60 × effective hourly rate × automation potential' },
                    { label: 'Error Reduction', color: '#7B61FF', bg: 'rgba(123,97,255,0.05)', border: 'rgba(123,97,255,0.15)', formula: 'error rate × cost per error × annual runs × automation potential' },
                    { label: 'Opportunity Cost', color: 'rgba(255,107,43,0.8)', bg: 'rgba(255,107,43,0.03)', border: 'rgba(255,107,43,0.1)', formula: 'hours freed × effective rate × 0.5 reallocation premium' },
                    { label: 'Missed Lead Revenue', color: '#a78bfa', bg: 'rgba(167,139,250,0.05)', border: 'rgba(167,139,250,0.15)', formula: 'missed calls/week × 4.33 × avg job value × 30% recovery rate × 12 months' },
                    { label: 'Net Savings', color: '#0B9E5E', bg: 'rgba(16,185,129,0.05)', border: 'rgba(16,185,129,0.15)', formula: 'Gross savings − (monthly fee × 12). Year 1 also subtracts one-time setup cost.' },
                    { label: 'Breakeven', color: '#f97316', bg: 'rgba(249,115,22,0.05)', border: 'rgba(249,115,22,0.15)', formula: 'Setup cost ÷ (monthly gross savings − monthly fee), rounded up. Shown in weeks if under 12.' },
                  ].map((card) => (
                    <div key={card.label} className="rounded-xl p-3.5" style={{ background: card.bg, border: `1px solid ${card.border}` }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: card.color }}>{card.label}</p>
                      <p className="text-xs leading-relaxed" style={{ color: '#55555F' }}>{card.formula}</p>
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
        <a
          href={ariaUrl} target="_blank" rel="noopener noreferrer"
          onClick={() => {
            fetch('https://neuralflowai.io/api/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'aria_handoff', data: { taskName: live.inputs.taskName, netOngoing: Math.round(live.netOngoing), industry: industry ?? 'general' } })
            }).catch(() => {});
          }}
          className="flex-1 flex items-center justify-center gap-2 font-bold text-sm py-3.5 px-6 rounded-xl transition-all"
          style={{ background: 'linear-gradient(135deg, #FF6B2B, #7B61FF)', color: '#fff' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Talk to ARIA About This →
        </a>
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm py-3.5 px-6 rounded-xl transition-all"
          style={{ border: '1px solid rgba(16,16,20,0.08)', color: '#55555F' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.18)'; e.currentTarget.style.color = '#101014'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)'; e.currentTarget.style.color = '#55555F'; }}
        >
          Share on LinkedIn
        </a>
        <a href={xUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm py-3.5 px-6 rounded-xl transition-all"
          style={{ border: '1px solid rgba(16,16,20,0.08)', color: '#55555F' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.18)'; e.currentTarget.style.color = '#101014'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)'; e.currentTarget.style.color = '#55555F'; }}
        >
          Share on X
        </a>
      </div>

      {/* Email report */}
      <div className="pt-6 space-y-3" style={{ borderTop: '1px solid rgba(16,16,20,0.08)' }}>
        {emailStatus === 'sent' ? (
          <p className="text-sm font-mono text-center" style={{ color: '#0B9E5E' }}>Report sent! Check your inbox.</p>
        ) : (
          <>
            <SectionLabel>Email me this report</SectionLabel>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email" value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); setEmailStatus('idle'); }}
                placeholder="Enter your email"
                aria-label="Email address for report"
                className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
                style={{ background: '#F3F2EE', border: '1px solid #E6E4DE', color: '#101014' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(255,107,43,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSubmit(); }}
              />
              <button
                onClick={handleEmailSubmit} disabled={emailStatus === 'sending'}
                aria-busy={emailStatus === 'sending'}
                className="flex items-center justify-center gap-2 text-sm font-semibold py-2.5 px-5 rounded-xl transition-all whitespace-nowrap disabled:opacity-40"
                style={{ background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.3)', color: '#FF6B2B' }}
                onMouseEnter={e => { if (emailStatus !== 'sending') { e.currentTarget.style.background = 'rgba(255,107,43,0.18)'; e.currentTarget.style.borderColor = 'rgba(255,107,43,0.5)'; } }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,107,43,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,107,43,0.3)'; }}
              >
                {emailStatus === 'sending' ? 'Sending…' : 'Email me this report'}
              </button>
            </div>
            {emailError && <p className="text-xs" style={{ color: '#C42348' }}>{emailError}</p>}
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
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [leadName, setLeadName]   = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadError, setLeadError] = useState('');
  const [gateInitialMissedCalls, setGateInitialMissedCalls] = useState<number | undefined>();
  const [gateInitialJobValue, setGateInitialJobValue] = useState<number | undefined>();

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
    const n = leadName.trim(), e = leadEmail.trim(), p = leadPhone.trim();
    if (!n) { setLeadError('Please enter your name.'); return; }
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setLeadError('Please enter a valid email address.'); return; }
    if (!p || p.replace(/\D/g, '').length < 7) { setLeadError('Please enter a valid phone number.'); return; }
    setLeadError('');
    setState('scanning');
    fetch('https://neuralflowai.io/api/roi-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, email: e, phone: p, industry: selectedIndustry ?? 'general' }),
    }).catch(() => {});
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
      const preset = selectedIndustry ? INDUSTRY_PRESETS[selectedIndustry] : null;
      const workflowData: WorkflowData = {
        taskName: data.task_name,
        estimatedMinutes: data.estimated_minutes,
        frequencyPerWeek: data.frequency_per_week,
        hourlyRate: 25,
        errorRate: 0.08,
        costPerError: 200,
        automationPotential: data.automation_potential,
        implementationCost: 3000,
        monthlyFee: 450,
        suggestedPhases: data.suggested_phases ?? [],
      };
      const result = calculateROI(workflowData);
      localStorage.setItem('neuralflow_roi', JSON.stringify(result));
      setRoi(result);
      if (preset) {
        setGateInitialMissedCalls(preset.missedCallsPerWeek);
        setGateInitialJobValue(preset.avgJobValue);
      }
      setState('results');
      try {
        const encoded = btoa(encodeURIComponent(JSON.stringify(result)));
        window.history.replaceState(null, '', `?r=${encoded}`);
      } catch { /* non-critical */ }
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setState('error');
    }
  }, [input, selectedIndustry, leadName, leadEmail, leadPhone]);

  const preset = selectedIndustry ? INDUSTRY_PRESETS[selectedIndustry] : null;
  const canAnalyze = input.trim().length >= 10 && leadName.trim() && leadEmail.trim() && leadPhone.trim();

  return (
    <main className="min-h-screen relative overflow-x-hidden" style={{ background: '#FAFAF7', color: '#101014' }}>

      {/* Ambient background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute rounded-full" style={{ width: 600, height: 600, top: '-10%', left: '-10%', background: 'radial-gradient(circle, rgba(255,107,43,0.07) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute rounded-full" style={{ width: 500, height: 500, top: '30%', right: '-15%', background: 'radial-gradient(circle, rgba(123,97,255,0.07) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute rounded-full" style={{ width: 400, height: 400, bottom: '10%', left: '20%', background: 'radial-gradient(circle, rgba(255,107,43,0.04) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      </div>

      {/* Nav — liquid glass, sticky */}
      <div
        className="sticky top-0 z-30"
        style={{
          background: 'rgba(255,255,255,0.62)',
          backdropFilter: 'blur(22px) saturate(1.7)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.7)',
          borderBottom: '1px solid rgba(255,255,255,0.6)',
          boxShadow: '0 8px 32px -24px rgba(16,16,20,0.35)',
        }}
      >
        <div className="px-6 py-3 flex items-center justify-between max-w-5xl mx-auto">
          <a href="https://neuralflowai.io" className="flex items-center gap-2.5" style={{ fontFamily: 'var(--font-display)' }}>
            {/* Logomark — gradient node badge */}
            <span
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #FF6B2B, #7B61FF)', boxShadow: '0 6px 16px -6px rgba(242,90,28,0.55), inset 0 1px 0 rgba(255,255,255,0.4)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 7 L18 12 M6 17 L18 12 M6 7 L6 17" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
                <circle cx="6" cy="7" r="2.1" fill="#fff" />
                <circle cx="6" cy="17" r="2.1" fill="#fff" />
                <circle cx="18" cy="12" r="2.6" fill="#fff" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight" style={{ letterSpacing: '-0.5px' }}>
              <span style={{ color: '#101014' }}>Neural</span>
              <span style={{ background: 'linear-gradient(135deg, #FF6B2B, #7B61FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Flow</span>
            </span>
          </a>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tracking-widest uppercase hidden sm:block" style={{ color: '#9a9890' }}>ROI Calculator</span>
            <a
              href="https://neuralflowai.io/#contact"
              className="text-xs font-semibold py-2 px-4 rounded-xl transition-all"
              style={{ background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.25)', color: '#F25A1C' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,107,43,0.18)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,107,43,0.1)')}
            >
              Book Free Call
            </a>
          </div>
        </div>
      </div>

      <div className="relative z-10 px-6 py-14 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">

          {/* ── IDLE STATE ── */}
          {state === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-2xl mx-auto text-center space-y-8"
            >
              {/* Eyebrow */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-mono tracking-wider uppercase"
                style={{ border: '1px solid rgba(255,107,43,0.25)', background: 'rgba(255,107,43,0.06)', color: '#FF6B2B' }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#FF6B2B', boxShadow: '0 0 6px rgba(255,107,43,0.8)' }} />
                AI-Powered ROI Analysis
              </motion.div>

              {/* Headline */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="space-y-4"
              >
                <h1
                  className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight"
                  style={{ fontFamily: 'var(--font-display)', letterSpacing: '-1.5px' }}
                >
                  What&apos;s your manual work<br />
                  <span style={{ background: 'linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    actually costing you?
                  </span>
                </h1>
                <p className="text-lg" style={{ color: '#55555F' }}>
                  Describe a repetitive task your team handles. Our AI calculates the real net savings after paying for NeuralFlow — no inflated numbers.
                </p>
              </motion.div>

              {/* Industry selector */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-left space-y-3"
              >
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#9a9890' }}>
                  Select your industry — pre-fills a description
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Select your industry">
                  {(Object.entries(INDUSTRY_PRESETS) as [Industry, IndustryPreset][])
                    .filter(([k]) => k !== 'general')
                    .map(([key, p], i) => (
                      <motion.button
                        key={key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.22 + i * 0.04 }}
                        aria-pressed={selectedIndustry === key}
                        onClick={() => {
                          if (selectedIndustry === key) {
                            setSelectedIndustry(null);
                          } else {
                            setSelectedIndustry(key);
                            if (p.prompt) setInput(p.prompt);
                          }
                        }}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all"
                        style={selectedIndustry === key
                          ? { background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.4)', color: '#FF6B2B', boxShadow: '0 0 20px rgba(255,107,43,0.12)' }
                          : { background: '#FFFFFF', border: '1px solid #E6E4DE', color: '#55555F' }
                        }
                        onMouseEnter={e => { if (selectedIndustry !== key) { e.currentTarget.style.borderColor = 'rgba(255,107,43,0.2)'; e.currentTarget.style.color = 'rgba(16,16,20,0.92)'; } }}
                        onMouseLeave={e => { if (selectedIndustry !== key) { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)'; e.currentTarget.style.color = '#55555F'; } }}
                      >
                        <span className="text-xl">{p.emoji}</span>
                        <span className="text-center leading-tight">{p.label}</span>
                      </motion.button>
                    ))}
                </div>
              </motion.div>

              {/* Textarea */}
              <motion.textarea
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Describe your workflow situation"
                placeholder={`Describe your situation in plain English...\n\nExamples:\n"I own a nail salon. My techs stop mid-service to answer the phone, we miss bookings, and our no-show rate kills us."\n\n"Every Monday we pull sales data from three spreadsheets, reconcile it, and email leadership. Takes 2 hours."`}
                className="w-full h-48 rounded-2xl px-5 py-4 text-sm resize-none outline-none transition-all text-left"
                style={{ background: '#FFFFFF', border: '1px solid #E6E4DE', color: '#101014' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(255,107,43,0.35)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)')}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleAnalyze(); }}
              />

              {/* Lead capture */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.32 }}
                className="space-y-2.5 text-left"
              >
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#9a9890' }}>Where should we send your results?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    { type: 'text', placeholder: 'Your name', value: leadName, onChange: (v: string) => { setLeadName(v); setLeadError(''); } },
                    { type: 'email', placeholder: 'Email address', value: leadEmail, onChange: (v: string) => { setLeadEmail(v); setLeadError(''); } },
                    { type: 'tel', placeholder: 'Phone number', value: leadPhone, onChange: (v: string) => { setLeadPhone(v); setLeadError(''); } },
                  ].map((field) => (
                    <input
                      key={field.placeholder}
                      type={field.type}
                      placeholder={field.placeholder}
                      aria-label={field.placeholder}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
                      style={{ background: '#FFFFFF', border: '1px solid #E6E4DE', color: '#101014' }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'rgba(255,107,43,0.35)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)')}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
                    />
                  ))}
                </div>
                {leadError && <p className="text-xs pl-1" style={{ color: '#C42348' }}>{leadError}</p>}
              </motion.div>

              {/* CTA button */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38 }}
                className="flex flex-col items-center gap-3"
              >
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze}
                  className="w-full sm:w-auto font-bold text-base py-4 px-12 rounded-xl transition-all relative overflow-hidden"
                  style={{
                    background: canAnalyze ? 'linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)' : '#F3F2EE',
                    color: canAnalyze ? '#fff' : '#9a9890',
                    cursor: canAnalyze ? 'pointer' : 'not-allowed',
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '-0.3px',
                    boxShadow: canAnalyze ? '0 0 30px rgba(255,107,43,0.25)' : 'none',
                  }}
                  onMouseEnter={e => { if (canAnalyze) e.currentTarget.style.opacity = '0.88'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                >
                  Analyze My Workflow →
                </button>
                <p className="text-xs" style={{ color: '#9a9890' }}>Net savings shown after NeuralFlow fees · We never spam</p>
              </motion.div>
            </motion.div>
          )}

          {/* ── SCANNING STATE ── */}
          {state === 'scanning' && (
            <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ScanningState />
            </motion.div>
          )}

          {/* ── RESULTS STATE ── */}
          {state === 'results' && roi && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResultsPanel
                roi={roi}
                onReset={() => {
                  setState('idle'); setInput(''); setRoi(null); setSelectedIndustry(null);
                  setLeadName(''); setLeadEmail(''); setLeadPhone('');
                  window.history.replaceState(null, '', window.location.pathname);
                }}
                industry={selectedIndustry ?? undefined}
                initialMissedCalls={gateInitialMissedCalls}
                initialJobValue={gateInitialJobValue}
                leadName={leadName}
                leadEmail={leadEmail}
                leadPhone={leadPhone}
              />
            </motion.div>
          )}

          {/* ── ERROR STATE ── */}
          {state === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-lg mx-auto text-center space-y-6"
            >
              <div className="rounded-2xl p-8 space-y-3" style={{ border: '1px solid rgba(196,35,72,0.18)', background: 'rgba(196,35,72,0.05)' }}>
                <p className="text-3xl">⚠️</p>
                <p className="font-semibold" style={{ color: '#101014' }}>Couldn&apos;t analyze that workflow</p>
                <p className="text-sm" style={{ color: '#55555F' }}>{errorMsg}</p>
              </div>
              <button
                onClick={() => setState('idle')}
                className="text-sm py-2.5 px-6 rounded-xl transition-all"
                style={{ border: '1px solid rgba(16,16,20,0.08)', color: '#55555F' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.2)'; e.currentTarget.style.color = '#101014'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(16,16,20,0.08)'; e.currentTarget.style.color = '#55555F'; }}
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
