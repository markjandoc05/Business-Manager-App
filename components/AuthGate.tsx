'use client';

import React, { useEffect } from 'react';
import { ArrowRight, Building2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import WorkspaceOnboarding from '@/components/WorkspaceOnboarding';
import { getNoMembershipDestination, type EntryIntent } from '@/lib/auth/entryFlow';

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading your account…</div>;
}

function LoginScreen({ onIntent }: { onIntent: (intent: 'create' | 'signin') => void }) {
  const { signInWithGoogle, error, authenticating } = useAuth();
  const [authAction, setAuthAction] = React.useState<'signin' | 'create-workspace' | null>(null);
  const isAuthenticating = authenticating || authAction !== null;

  const start = async (intent: 'create' | 'signin') => {
    if (isAuthenticating) return;
    onIntent(intent);
    setAuthAction(intent === 'signin' ? 'signin' : 'create-workspace');
    try {
      await signInWithGoogle();
    } catch {
      // AuthContext owns the user-facing error state; this keeps the CTA state recoverable.
    } finally {
      setAuthAction(null);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6">
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShieldCheck size={25} />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">BSM</p>
          <h1 className="mx-auto mt-3 max-w-sm text-xl font-semibold leading-7 text-slate-900 sm:text-2xl">
            Manage your leads, clients, and sales in one place.
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
            Keep prospects, clients, follow-ups, deals, and your sales pipeline organized in one simple workspace.
          </p>
        </div>

        <div className="space-y-4">
          <Button type="button" disabled={isAuthenticating} onClick={() => void start('signin')} className="w-full gap-2" size="lg">
            {authAction === 'signin' ? 'Signing in…' : <><LogIn size={17} /> Sign In with Google</>}
          </Button>
          <div className="flex items-center gap-3 text-xs text-slate-400" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span>New to BSM?</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <Button type="button" variant="outline" disabled={isAuthenticating} onClick={() => void start('create')} className="w-full" size="lg">
            {authAction === 'create-workspace' ? 'Creating workspace…' : 'Create Your Workspace'}
          </Button>
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <p className="text-center text-[11px] leading-5 text-slate-400">
          By using BSM App, you agree to the <span className="underline decoration-slate-300 underline-offset-2">Terms of Service</span> and <span className="underline decoration-slate-300 underline-offset-2">Data Processing Agreement</span>.
        </p>
      </Card>
    </div>
  );
}

function NoWorkspaceScreen({ onCreate }: { onCreate: () => void }) {
  const { user, signOut } = useAuth();
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6"><Card className="w-full max-w-md space-y-5 p-6 text-center sm:p-8"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><Building2 size={24} /></div><div><h1 className="text-xl font-semibold text-slate-900">No workspace found</h1><p className="mt-2 text-sm leading-6 text-slate-500">You don&apos;t currently belong to a BSM workspace.</p></div><Button type="button" onClick={onCreate} className="w-full">Create Your Workspace</Button><Button type="button" variant="outline" onClick={signOut} className="w-full gap-2"><LogOut size={16} /> Sign out</Button><p className="break-words text-xs text-slate-400">Signed in as {user?.email}</p></Card></div>;
}

function WorkspacePicker() {
  const { availableOrganizations, membershipSummaries, selectOrganization } = useWorkspace();
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6"><Card className="w-full max-w-lg space-y-5 p-6 sm:p-8"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">BSM</p><h1 className="mt-1 text-2xl font-semibold text-slate-900">Select Workspace</h1><p className="mt-2 text-sm text-slate-500">Choose the workspace you want to open.</p></div><div className="space-y-3">{availableOrganizations.map((organization) => { const membership = membershipSummaries.find((item) => item.organizationId === organization.id); return <button key={organization.id} type="button" onClick={() => selectOrganization(organization.id)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-200"><span className="min-w-0"><span className="block truncate font-semibold text-slate-900">{organization.name}</span><span className="mt-1 block text-xs text-slate-500">{membership?.role || 'Member'} · {organization.status}</span></span><ArrowRight className="shrink-0 text-slate-400" size={18} /></button>; })}</div></Card></div>;
}

function PendingScreen({ disabled = false }: { disabled?: boolean }) {
  const { user, signOut } = useAuth();
  const { refresh } = useWorkspace();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md space-y-5 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700"><ShieldCheck size={28} /></div>
        <div><h1 className="text-2xl font-bold text-slate-900">{disabled ? 'Account Disabled' : 'Pending Workspace Access'}</h1><p className="mt-2 text-sm text-slate-500">{disabled ? 'This account has been disabled at the platform level. Contact support for assistance.' : 'An organization ADMIN must activate your organization membership before you can access the dashboard.'}</p></div>
        <div className="rounded-xl bg-slate-50 p-4 text-left text-sm"><p className="font-semibold text-slate-900">{user?.name}</p><p className="text-slate-500">{user?.email}</p><p className="mt-2 text-xs text-slate-400">Role: {user?.role}</p></div>
        {!disabled && <Button type="button" onClick={refresh} className="w-full">Check access again</Button>}
        <Button type="button" variant="outline" onClick={signOut} className="w-full gap-2"><LogOut size={16} /> Sign out</Button>
      </Card>
    </div>
  );
}

function WorkspaceErrorScreen({ error, refresh }: { error: string; refresh: () => void }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">Unable to load workspace</h1>
        <p className="text-sm text-slate-500">{error}</p>
        <div className="flex justify-center gap-3">
          <Button type="button" onClick={refresh}>Retry</Button>
          <Button type="button" variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </Card>
    </div>
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, firebaseUser } = useAuth();
  const { loading: workspaceLoading, ready: workspaceReady, onboardingRequired, hasMembership, membershipCount, activeMembershipCount, membershipSummaries, availableOrganizations, currentOrganizationId, membership, error: workspaceError, refresh } = useWorkspace();
  const [entryIntent, setEntryIntent] = React.useState<EntryIntent | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const workspaceStatus = workspaceError ? 'error' : workspaceLoading ? 'loading' : workspaceReady ? 'ready' : hasMembership ? 'pending' : 'no-membership';
      const routeDecision = status === 'loading'
        ? 'loading'
        : status === 'signed-out' || status === 'error'
          ? 'login'
          : status === 'disabled'
            ? 'blocked'
            : workspaceLoading
              ? 'loading'
              : workspaceError
                ? 'workspace-error'
                : onboardingRequired || !hasMembership
                  ? 'onboarding'
                  : workspaceReady
                    ? 'dashboard'
                    : 'pending';
      console.info('[Workspace Resolution]', {
        uid: firebaseUser?.uid || null,
        email: firebaseUser?.email || null,
        workspaceLoading,
        membershipCount,
        activeMembershipCount,
        organizationIds: membershipSummaries.map((summary) => summary.organizationId),
        membershipStatuses: membershipSummaries.map((summary) => `${summary.organizationId}:${summary.status}`),
        activeOrganizationId: currentOrganizationId,
        workspaceStatus,
        routeDecision,
      });
    }
  }, [activeMembershipCount, currentOrganizationId, firebaseUser?.email, firebaseUser?.uid, hasMembership, membership, membershipCount, membershipSummaries, onboardingRequired, status, workspaceError, workspaceLoading, workspaceReady]);
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'signed-out' || status === 'error') return <LoginScreen onIntent={setEntryIntent} />;
  if (status === 'disabled') return <PendingScreen disabled />;
  if (workspaceLoading) return <LoadingScreen />;
  if (workspaceError) return <WorkspaceErrorScreen error={workspaceError} refresh={refresh} />;
  if (activeMembershipCount > 1 && !workspaceReady) return <WorkspacePicker />;
  if (onboardingRequired || !hasMembership) return getNoMembershipDestination(entryIntent) === 'onboarding' ? <WorkspaceOnboarding /> : <NoWorkspaceScreen onCreate={() => setEntryIntent('create')} />;
  if (!workspaceReady) return <PendingScreen />;
  return <>{children}</>;
}
