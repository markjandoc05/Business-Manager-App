import type {Metadata} from 'next';
import './globals.css';
import SidebarLayout from '@/components/SidebarLayout';
import { AppProvider } from '@/context/AppContext';

export const metadata: Metadata = {
  title: 'Business Sales Manager (BSM) App',
  description: 'A simple sales management system for small businesses and solo entrepreneurs.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="antialiased">
        <AppProvider>
          <SidebarLayout>{children}</SidebarLayout>
        </AppProvider>
      </body>
    </html>
  );
}
