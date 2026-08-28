'use client';

import React, { useState } from 'react';
import { Building2, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { createWorkspace, WorkspaceAlreadyExistsError, type WorkspaceOnboardingInput } from '@/lib/repositories/workspaces';
import type { BusinessType } from '@/types';

const businessTypes: BusinessType[] = ['Solo Entrepreneur', 'Agency', 'Real Estate', 'Professional Services', 'Retail', 'Other'];
const currencies = ['PHP', 'USD', 'AUD', 'SGD', 'EUR', 'GBP'];
const timezones = ['Asia/Manila', 'UTC', 'Asia/Singapore', 'Australia/Sydney', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];

const initialForm: WorkspaceOnboardingInput = {
  name: '',
  businessType: 'Solo Entrepreneur',
  phone: '',
  website: '',
  currency: 'PHP',
  timezone: 'Asia/Manila',
};

export default function WorkspaceOnboarding() {
  const { user } = useAuth();
  const { refresh } = useWorkspace();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof WorkspaceOnboardingInput>(key: K, value: WorkspaceOnboardingInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const continueToPreferences = () => {
    if (!form.name.trim()) {
      setError('Enter a business name to continue.');
      return;
    }
    setError(null);
    setStep(2);
  };

  const create = async () => {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createWorkspace(user, form);
      refresh();
    } catch (createError) {
      const code = (createError as { code?: string }).code;
      console.error('Unable to create workspace', createError);
      if (createError instanceof WorkspaceAlreadyExistsError || code === 'workspace-already-exists') {
        setSaving(false);
        refresh();
        return;
      }
      setError(code === 'permission-denied'
        ? 'Unable to create your workspace. Please check your account access.'
        : code === 'failed-precondition' || code === 'workspace-slug-error'
          ? 'That workspace name is already in use. Please try another name.'
          : 'Unable to create your workspace. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6">
      <Card className="w-full max-w-xl space-y-6 p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--app-primary)] text-white"><Building2 size={22} /></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-primary)]">Step {step} of 3</p><h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">Create your workspace</h1><p className="mt-1 text-sm text-[var(--app-muted)]">Set up your BSM workspace to start managing your business.</p></div>
        </div>

        <div className="flex gap-2" aria-label="Onboarding progress">
          {[1, 2, 3].map((item) => <div key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? 'bg-[var(--app-primary)]' : 'bg-[var(--app-border)]'}`} />)}
        </div>

        {step === 1 && <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Business Name <span className="text-[var(--app-danger)]">*</span></label><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm focus:border-[var(--app-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" placeholder="e.g. Acme Studio" /></div>
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Business Type <span className="text-[var(--app-danger)]">*</span></label><select value={form.businessType} onChange={(event) => update('businessType', event.target.value as BusinessType)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm focus:border-[var(--app-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]">{businessTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Phone</label><input value={form.phone} onChange={(event) => update('phone', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm" /></div><div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Website</label><input value={form.website} onChange={(event) => update('website', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm" placeholder="https://" /></div></div>
        </div>}

        {step === 2 && <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Currency <span className="text-[var(--app-danger)]">*</span></label><select value={form.currency} onChange={(event) => update('currency', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></div>
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Timezone <span className="text-[var(--app-danger)]">*</span></label><select value={form.timezone} onChange={(event) => update('timezone', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm">{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select><p className="mt-1 text-xs text-[var(--app-tertiary)]">Dates and times will use this IANA timezone.</p></div>
        </div>}

        {step === 3 && <div className="space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-4 text-sm"><p className="font-semibold text-[var(--app-text)]">Review your workspace</p><div className="grid gap-3 sm:grid-cols-2"><Review label="Business name" value={form.name} /><Review label="Business type" value={form.businessType} /><Review label="Phone" value={form.phone || 'Not provided'} /><Review label="Website" value={form.website || 'Not provided'} /><Review label="Currency" value={form.currency} /><Review label="Timezone" value={form.timezone} /></div></div>}

        {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] px-3 py-2 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button type="button" variant="outline" disabled={saving || step === 1} onClick={() => { setError(null); setStep((current) => current - 1); }} className="gap-2"><ChevronLeft size={16} /> Back</Button>{step < 3 ? <Button type="button" onClick={() => step === 1 ? continueToPreferences() : setStep(3)} className="gap-2">Continue <ChevronRight size={16} /></Button> : <Button type="button" onClick={() => void create()} disabled={saving} className="gap-2"><Check size={16} />{saving ? 'Creating workspace...' : 'Create Workspace'}</Button>}</div>
      </Card>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-0.5 break-words font-medium text-[var(--app-text)]">{value}</p></div>;
}
