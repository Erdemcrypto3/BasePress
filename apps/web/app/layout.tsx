import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });

export const metadata: Metadata = {
  title: 'BasePress — Multichain Decentralized Blog',
  description:
    'Read articles on BasePress and mint them as NFTs on Base, Ink, or any supported chain. Authors publish off-chain; readers mint on-chain.',
  openGraph: {
    title: 'BasePress',
    description: 'Multichain decentralized blog. Read free, mint anywhere.',
    url: 'https://basepress.app',
    siteName: 'BasePress',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
