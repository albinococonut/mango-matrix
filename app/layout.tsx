import './globals.css';
import type { Metadata } from 'next';
import ScrollRestorer from '@/components/ScrollRestorer';

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ScrollRestorer />
        {children}
      </body>
    </html>
  );
}
