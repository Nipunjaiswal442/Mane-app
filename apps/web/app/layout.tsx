import type { Metadata } from 'next';
import '@fontsource/anton/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Mane — Same people. Deeper work.',
  description:
    'Private collaboration and meeting minutes, powered by local AI. Self-hosted. No cloud. Your rules.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
