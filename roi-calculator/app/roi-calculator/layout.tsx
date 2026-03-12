import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ROI Calculator | NeuralFlow AI — Automation Savings Estimator',
  description:
    'Discover exactly how much your manual workflows are costing you. Describe a process and our AI instantly calculates your potential automation savings.',
  openGraph: {
    title: 'NeuralFlow AI ROI Calculator',
    description: 'Find out how much your team could save with AI automation.',
    url: 'https://neuralflowai.io/roi-calculator',
    siteName: 'NeuralFlow AI',
    images: [{ url: 'https://neuralflowai.io/og-roi.png', width: 1200, height: 630 }],
    type: 'website',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
