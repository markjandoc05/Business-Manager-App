'use client';

import React, { useEffect } from 'react';
import { ArrowRight, Building2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import WorkspaceOnboarding from '@/components/WorkspaceOnboarding';
import { getNoMembershipDestination, type EntryIntent } from '@/lib/auth/entryFlow';
import { emitStartupTiming, markStartup, markStartupEvent } from '@/lib/startupTiming';
import { isLocalFirebaseEmulatorMode } from '@/lib/firebase/environment';

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] text-sm text-[var(--app-muted)]">Loading your account…</div>;
}

function LoginScreen({ onIntent }: { onIntent: (intent: 'create' | 'signin') => void }) {
  const { firebaseUser, signInWithGoogle, signInWithLocalUat, signOut, retryBootstrap, error, authenticating } = useAuth();
  const [authAction, setAuthAction] = React.useState<'signin' | 'create-workspace' | null>(null);
  const [uatEmail, setUatEmail] = React.useState('');
  const [uatPassword, setUatPassword] = React.useState('');
  const [uatSubmitting, setUatSubmitting] = React.useState(false);
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
  const localUatEnabled = isLocalFirebaseEmulatorMode();
  const submitLocalUat = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uatSubmitting || isAuthenticating) return;
    setUatSubmitting(true);
    try {
      await signInWithLocalUat(uatEmail, uatPassword);
    } catch {
      // AuthContext owns the sanitized user-facing error.
    } finally {
      setUatSubmitting(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6">
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--app-primary)] text-white">
            <ShieldCheck size={25} />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--app-primary)]">BSM</p>
          <h1 className="mx-auto mt-3 max-w-sm text-xl font-semibold leading-7 text-[var(--app-text)] sm:text-2xl">
            Manage your leads, clients, and sales in one place.
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--app-muted)]">
            Keep prospects, clients, follow-ups, deals, and your sales pipeline organized in one simple workspace.
          </p>
        </div>

        <div className="space-y-4">
          <Button type="button" disabled={isAuthenticating} onClick={() => void start('signin')} className="w-full gap-2" size="lg">
            {authAction === 'signin' ? 'Signing in…' : <><LogIn size={17} /> Sign In with Google</>}
          </Button>
          <div className="flex items-center gap-3 text-xs text-[var(--app-tertiary)]" aria-hidden="true">
            <span className="h-px flex-1 bg-[var(--app-border)]" />
            <span>New to BSM?</span>
            <span className="h-px flex-1 bg-[var(--app-border)]" />
          </div>
          <Button type="button" variant="outline" disabled={isAuthenticating} onClick={() => void start('create')} className="w-full" size="lg">
            {authAction === 'create-workspace' ? 'Creating workspace…' : 'Create Your Workspace'}
          </Button>
        </div>

        {localUatEnabled && <form className="space-y-3 rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-4" onSubmit={(event) => void submitLocalUat(event)}>
          <div><p className="text-sm font-semibold text-[var(--app-text)]">Local UAT sign-in</p><p className="mt-1 text-xs text-[var(--app-muted)]">Uses the Firebase Auth Emulator. Enter credentials from your local UAT fixture.</p></div>
          <label className="block text-xs font-medium text-[var(--app-text)]">Email<input aria-label="Local UAT email" type="email" autoComplete="username" value={uatEmail} onChange={(event) => setUatEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm" required /></label>
          <label className="block text-xs font-medium text-[var(--app-text)]">Password<input aria-label="Local UAT password" type="password" autoComplete="current-password" value={uatPassword} onChange={(event) => setUatPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm" required /></label>
          <Button type="submit" disabled={uatSubmitting || isAuthenticating} className="w-full">{uatSubmitting ? 'Signing in…' : 'Sign in for local UAT'}</Button>
        </form>}

        {error && <p className="text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
        {error && firebaseUser && <div className="space-y-2"><Button type="button" onClick={() => void retryBootstrap()} className="w-full">Retry workspace access</Button><Button type="button" variant="outline" onClick={signOut} className="w-full">Sign out</Button></div>}
        <p className="text-center text-[11px] leading-5 text-[var(--app-tertiary)]">
          By using BSM App, you agree to the <span className="underline decoration-[var(--app-border)] underline-offset-2">Terms of Service</span> and <span className="underline decoration-[var(--app-border)] underline-offset-2">Data Processing Agreement</span>.
        </p>
      </Card>
    </div>
  );
}

function NoWorkspaceScreen({ onCreate }: { onCreate: () => void }) {
  const { user, signOut } = useAuth();
  return <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6"><Card className="w-full max-w-md space-y-5 p-6 text-center sm:p-8"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--app-accent-soft)] text-[var(--app-primary)]"><Building2 size={24} /></div><div><h1 className="text-xl font-semibold text-[var(--app-text)]">No workspace found</h1><p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">You don&apos;t currently belong to a BSM workspace.</p></div><Button type="button" onClick={onCreate} className="w-full">Create Your Workspace</Button><Button type="button" variant="outline" onClick={signOut} className="w-full gap-2"><LogOut size={16} /> Sign out</Button><p className="break-words text-xs text-[var(--app-tertiary)]">Signed in as {user?.email}</p></Card></div>;
}

function WorkspacePicker() {
  const { availableOrganizations, membershipSummaries, selectOrganization } = useWorkspace();
  return <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6"><Card className="w-full max-w-lg space-y-5 p-6 sm:p-8"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-primary)]">BSM</p><h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">Select Workspace</h1><p className="mt-2 text-sm text-[var(--app-muted)]">Choose the workspace you want to open.</p></div><div className="space-y-3">{availableOrganizations.map((organization) => { const membership = membershipSummaries.find((item) => item.organizationId === organization.id); return <button key={organization.id} type="button" onClick={() => selectOrganization(organization.id)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-[var(--app-border)] bg-white p-4 text-left transition hover:border-[var(--app-primary)] hover:bg-[var(--app-accent-soft)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"><span className="min-w-0"><span className="block truncate font-semibold text-[var(--app-text)]">{organization.name}</span><span className="mt-1 block text-xs text-[var(--app-muted)]">{membership?.role || 'Member'} · {organization.status}</span></span><ArrowRight className="shrink-0 text-[var(--app-tertiary)]" size={18} /></button>; })}</div></Card></div>;
}

function PendingScreen({ disabled = false, inactive = false }: { disabled?: boolean; inactive?: boolean }) {
  const { user, signOut } = useAuth();
  const { refresh } = useWorkspace();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-6">
      <Card className="w-full max-w-md space-y-5 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--app-warning)_20%,white)] text-[var(--app-text)]"><ShieldCheck size={28} /></div>
        <div><h1 className="text-2xl font-bold text-[var(--app-text)]">{disabled ? (inactive ? 'Account Inactive' : 'Account Disabled') : 'Pending Workspace Access'}</h1><p className="mt-2 text-sm text-[var(--app-muted)]">{disabled ? (inactive ? 'This account is inactive at the platform level. Contact support for assistance.' : 'This account has been disabled at the platform level. Contact support for assistance.') : 'An organization ADMIN must activate your organization membership before you can access the dashboard.'}</p></div>
        <div className="rounded-xl bg-[var(--app-surface-subtle)] p-4 text-left text-sm"><p className="font-semibold text-[var(--app-text)]">{user?.name}</p><p className="text-[var(--app-muted)]">{user?.email}</p><p className="mt-2 text-xs text-[var(--app-tertiary)]">Role: {user?.role}</p></div>
        {!disabled && <Button type="button" onClick={refresh} className="w-full">Check access again</Button>}
        <Button type="button" variant="outline" onClick={signOut} className="w-full gap-2"><LogOut size={16} /> Sign out</Button>
      </Card>
    </div>
  );
}

function WorkspaceErrorScreen({ error, refresh }: { error: string; refresh: () => void }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-6">
      <Card className="w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-xl font-bold text-[var(--app-text)]">Unable to load workspace</h1>
        <p className="text-sm text-[var(--app-muted)]">{error}</p>
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
  const { loading: workspaceLoading, ready: workspaceReady, onboardingRequired, hasMembership, membershipCount, activeMembershipCount, membershipSummaries, availableOrganizations, currentOrganizationId, error: workspaceError, refresh } = useWorkspace();
  const [entryIntent, setEntryIntent] = React.useState<EntryIntent | null>(null);
  const lastWorkspaceDiagnosticRef = React.useRef('');
  useEffect(() => {
    if (status === 'active' && workspaceReady) {
      markStartupEvent('AUTH_GATE_RELEASE');
      markStartup('shell-renderable');
      emitStartupTiming();
    }
  }, [status, workspaceReady]);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const workspaceStatus = workspaceError ? 'error' : workspaceLoading ? 'loading' : workspaceReady ? 'ready' : hasMembership ? 'pending' : 'no-membership';
      const routeDecision = status === 'loading'
        ? 'loading'
        : status === 'signed-out' || status === 'error'
          ? 'login'
          : status === 'disabled' || status === 'inactive'
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
      const diagnosticState = {
        uid: firebaseUser?.uid || null,
        workspaceStatus,
        routeDecision,
        activeOrganizationId: currentOrganizationId,
        membershipCount,
        activeMembershipCount,
        membershipStatuses: membershipSummaries.map((summary) => `${summary.organizationId}:${summary.status}`),
        error: workspaceError,
      };
      const diagnosticKey = JSON.stringify(diagnosticState);
      if (diagnosticKey === lastWorkspaceDiagnosticRef.current) return;
      lastWorkspaceDiagnosticRef.current = diagnosticKey;
      console.info('[Workspace Resolution]', {
        ...diagnosticState,
      });
    }
  }, [activeMembershipCount, currentOrganizationId, firebaseUser?.uid, hasMembership, membershipCount, membershipSummaries, onboardingRequired, status, workspaceError, workspaceLoading, workspaceReady]);
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'signed-out' || status === 'error') return <LoginScreen onIntent={setEntryIntent} />;
  if (status === 'disabled' || status === 'inactive') return <PendingScreen disabled inactive={status === 'inactive'} />;
  if (workspaceLoading) return <LoadingScreen />;
  if (workspaceError) return <WorkspaceErrorScreen error={workspaceError} refresh={refresh} />;
  if (activeMembershipCount > 1 && !workspaceReady) return <WorkspacePicker />;
  if (onboardingRequired || !hasMembership) return getNoMembershipDestination(entryIntent) === 'onboarding' ? <WorkspaceOnboarding /> : <NoWorkspaceScreen onCreate={() => setEntryIntent('create')} />;
  if (!workspaceReady) return <PendingScreen />;
  return <>{children}</>;
}
