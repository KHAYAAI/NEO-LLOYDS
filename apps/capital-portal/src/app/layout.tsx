import type { Metadata } from 'next';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import './globals.css';

export const metadata: Metadata = {
  title: 'Neo-Lloyds — Capital Provider Portal',
  description: 'SIMULATION / TEST ENVIRONMENT — NOT INSURANCE',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthKitProvider>
          <div className="nl-notice">{SIMULATION_NOTICE}</div>
          {children}
        </AuthKitProvider>
      </body>
    </html>
  );
}
