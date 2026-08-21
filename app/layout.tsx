import type {Metadata} from 'next';
import './globals.css';
import SidebarLayout from '@/components/SidebarLayout';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider } from '@/context/AuthContext';
import AuthGate from '@/components/AuthGate';

export const metadata: Metadata = {
  title: 'Business Sales Manager (BSM) App',
  description: 'A simple sales management system for small businesses and solo entrepreneurs.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="antialiased">
        <AuthProvider>
          <AuthGate>
            <AppProvider>
              <SidebarLayout>{children}</SidebarLayout>
            </AppProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
