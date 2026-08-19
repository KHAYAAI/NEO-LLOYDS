import type { Metadata } from 'next';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import './globals.css';

export const metadata: Metadata = {
  title: 'Neo-Lloyds — Claims Administrator Portal',
  description: 'SIMULATION / TEST ENVIRONMENT — NOT INSURANCE',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="nl-notice">{SIMULATION_NOTICE}</div>
        {children}
      </body>
    </html>
  );
}
