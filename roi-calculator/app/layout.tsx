import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

export const metadata: Metadata = {
  title: 'NeuralFlow AI — Free ROI Calculator',
  description:
    'Find out exactly what your manual workflows are costing you. AI analysis returns real dollar savings, breakeven timeline, and a custom 3-phase automation roadmap — in 60 seconds.',
  metadataBase: new URL('https://neuralflowai.io'),
  openGraph: {
    title: 'NeuralFlow AI — Free ROI Calculator',
    description:
      'Discover exactly how much your manual work is costing you. Get annual savings, breakeven month, and a custom roadmap in 60 seconds.',
    url: 'https://roi.neuralflowai.io/roi-calculator',
    siteName: 'NeuralFlow AI',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'NeuralFlow AI ROI Calculator' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NeuralFlow AI — Free ROI Calculator',
    description: 'Find out exactly what your manual workflows are costing you. 60-second AI analysis.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics — replace G-PGWCHZ95J9 with your GA4 Measurement ID */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-PGWCHZ95J9" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-PGWCHZ95J9');`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${inter.className}`}>{children}</body>
    </html>
  );
}
