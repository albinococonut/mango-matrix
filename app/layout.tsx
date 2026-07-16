import './globals.css';
import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import ScrollRestorer from '@/components/ScrollRestorer';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['400', '500', '600'] });
const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'The Mango Matrix',
  description: 'Mango Automotive multi-shop performance dashboard',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{ __html: `
          .c2disp { font-family: var(--font-display), Georgia, 'Times New Roman', serif; font-weight: 500; }
          .c2ui { font-family: var(--font-ui), -apple-system, system-ui, sans-serif; }
        ` }} />
      </head>
      <body>
        <ScrollRestorer />
        {children}
      </body>
    </html>
  );
}
