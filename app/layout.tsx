import type {Metadata, Viewport} from 'next';
import './globals.css';
import SidebarLayout from '@/components/SidebarLayout';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider } from '@/context/AuthContext';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import AuthGate from '@/components/AuthGate';

export const metadata: Metadata = {
  title: 'Ventale — Simple CRM for Growing Businesses',
  description: 'Manage leads, clients, deals, follow-ups, and sales in one simple CRM.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f6f5',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="antialiased">
        <AuthProvider>
          <WorkspaceProvider>
            <AuthGate>
              <AppProvider>
                <SidebarLayout>{children}</SidebarLayout>
              </AppProvider>
            </AuthGate>
          </WorkspaceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
