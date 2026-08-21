'use client';

import React from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { useAuth } from '@/context/AuthContext';

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading your account…</div>;
}

function LoginScreen() {
  const { signInWithGoogle, error } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md space-y-6 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg"><ShieldCheck size={28} /></div>
        <div><h1 className="text-2xl font-bold text-slate-900">Sign in to BSM</h1><p className="mt-2 text-sm text-slate-500">Use your Google account to access the Business Sales Manager.</p></div>
        <Button type="button" onClick={signInWithGoogle} className="w-full gap-2" size="lg">Continue with Google</Button>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </Card>
    </div>
  );
}

function PendingScreen() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md space-y-5 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700"><ShieldCheck size={28} /></div>
        <div><h1 className="text-2xl font-bold text-slate-900">Pending Activation</h1><p className="mt-2 text-sm text-slate-500">Your account was created, but an ADMIN must activate it before you can access the dashboard.</p></div>
        <div className="rounded-xl bg-slate-50 p-4 text-left text-sm"><p className="font-semibold text-slate-900">{user?.name}</p><p className="text-slate-500">{user?.email}</p><p className="mt-2 text-xs text-slate-400">Role: {user?.role}</p></div>
        <Button type="button" variant="outline" onClick={signOut} className="w-full gap-2"><LogOut size={16} /> Sign out</Button>
      </Card>
    </div>
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'signed-out' || status === 'error') return <LoginScreen />;
  if (status === 'pending') return <PendingScreen />;
  return <>{children}</>;
}
