import type {Metadata, Viewport} from 'next';
import {Plus_Jakarta_Sans, Noto_Sans_Bengali, JetBrains_Mono} from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  weight: ['400', '600', '700'],
  variable: '--font-bengali',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

const APP_TITLE = 'AI Shorts Editor';
const APP_DESCRIPTION =
  'Personal AI-powered automatic vertical video editor turning voiceovers, raw footage, images, and scripts into polished 9:16 MP4 videos locally with Gemini and FFmpeg.wasm.';

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#060B16',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${notoBengali.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#060B16] text-slate-100 antialiased selection:bg-blue-600/30 selection:text-blue-200 font-[family-name:var(--font-sans),var(--font-bengali),sans-serif]"
      >
        {children}
      </body>
    </html>
  );
}
