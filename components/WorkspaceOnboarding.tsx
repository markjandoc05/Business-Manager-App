'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { getPlatformSubscriptionService, isPlatformOnboardingEnabled, PlatformIntegrationNotReadyError, PlatformSubscriptionError, type SignupPlan } from '@/lib/subscriptions';
import { clearProvisioningIdempotencyKey, getOrCreateProvisioningIdempotencyKey, ProvisioningIdempotencyStorageError, provisioningFingerprint } from '@/lib/subscriptions/provisioning-idempotency';
import type { BusinessType } from '@/types';

const businessTypes: BusinessType[] = ['Solo Entrepreneur', 'Agency', 'Real Estate', 'Professional Services', 'Retail', 'Other'];
const currencies = ['PHP', 'USD', 'AUD', 'SGD', 'EUR', 'GBP'];
const timezones = ['Asia/Manila', 'UTC', 'Asia/Singapore', 'Australia/Sydney', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];

interface WorkspaceOnboardingInput {
  name: string;
  businessType: BusinessType;
  phone: string;
  website: string;
  currency: string;
  timezone: string;
}

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
  const platformOnboardingEnabled = isPlatformOnboardingEnabled();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupPlans, setSignupPlans] = useState<SignupPlan[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(platformOnboardingEnabled);
  const [planError, setPlanError] = useState<string | null>(null);

  const totalSteps = 3;
  const reviewStep = 3;

  const selectedSignupPlan = signupPlans.find((plan) => plan.code === selectedPlanCode) || null;

  const loadSignupPlans = useCallback(async () => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plans = await getPlatformSubscriptionService().getAvailableSignupPlans();
      setSignupPlans(plans);
      setSelectedPlanCode((current) => plans.some((plan) => plan.code === current) ? current : null);
      if (!plans.length) setPlanError('No signup plan is currently available. Please try again later.');
    } catch (planLoadFailure) {
      const message = planLoadFailure instanceof PlatformIntegrationNotReadyError
        ? 'Plan selection is ready, but the Developer Console plan service is not connected yet.'
        : 'Unable to load the available signup plan. Please try again later.';
      setPlanError(message);
      if (process.env.NODE_ENV !== 'production') console.info('[subscription-onboarding] plan lookup unavailable', { code: errorCode(planLoadFailure) });
    } finally {
      setPlanLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!platformOnboardingEnabled) return undefined;
    void loadSignupPlans();
    return undefined;
  }, [loadSignupPlans, platformOnboardingEnabled]);

  const update = <K extends keyof WorkspaceOnboardingInput>(key: K, value: WorkspaceOnboardingInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const continueFromBusiness = () => {
    if (!form.name.trim()) {
      setError('Enter a business name to continue.');
      return;
    }
    if (!form.currency || !form.timezone.trim()) {
      setError('Choose a currency and timezone to continue.');
      return;
    }
    setError(null);
    setStep(2);
  };

  const continueFromPlan = () => {
    if (!selectedSignupPlan) {
      setError(planError || 'Select an available signup plan to continue.');
      return;
    }
    setError(null);
    setStep(reviewStep);
  };

  const startFreeTrial = async () => {
    if (!user || saving || !selectedSignupPlan) return;
    setSaving(true);
    setError(null);
    try {
      const workspace = { ...form, requestedSlug: normalizeRequestedSlug(form.name) };
      const idempotencyKey = getOrCreateProvisioningIdempotencyKey(user.uid, provisioningFingerprint({ planCode: selectedSignupPlan.code, workspace }));
      await getPlatformSubscriptionService().startTrial({ planCode: selectedSignupPlan.code, idempotencyKey, workspace });
      clearProvisioningIdempotencyKey(user.uid, idempotencyKey);
      refresh();
    } catch (trialFailure) {
      handleTrialFailure(trialFailure, {
        refreshPlans: () => void loadSignupPlans(),
        refreshWorkspace: refresh,
        returnToPlanSelection: () => setStep(2),
        setError,
      });
      if (process.env.NODE_ENV !== 'production') console.info('[subscription-onboarding] trial start unavailable', { code: errorCode(trialFailure) });
      setSaving(false);
    }
  };

  const continueForward = () => {
    if (step === 1) return continueFromBusiness();
    return continueFromPlan();
  };

  // This is an availability gate only. It cannot re-enable the retired
  // browser Firestore bootstrap path; new workspaces are Platform-provisioned
  // or they are not provisioned at all.
  if (!platformOnboardingEnabled) return <OnboardingUnavailable />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6">
      <Card className="w-full max-w-xl space-y-6 p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--app-primary)] text-white"><Building2 size={22} /></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-primary)]">Step {step} of {totalSteps}</p><h1 className="mt-1 text-2xl font-semibold text-[var(--app-text)]">Create your workspace</h1><p className="mt-1 text-sm text-[var(--app-muted)]">Set up your Ventale workspace to start managing your business.</p></div>
        </div>

        <div className="flex gap-2" aria-label="Onboarding progress">
          {Array.from({ length: totalSteps }, (_, index) => index + 1).map((item) => <div key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? 'bg-[var(--app-primary)]' : 'bg-[var(--app-border)]'}`} />)}
        </div>

        {step === 1 && <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Business Name <span className="text-[var(--app-danger)]">*</span></label><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm focus:border-[var(--app-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" placeholder="e.g. Acme Studio" /></div>
          <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Business Type <span className="text-[var(--app-danger)]">*</span></label><select value={form.businessType} onChange={(event) => update('businessType', event.target.value as BusinessType)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm focus:border-[var(--app-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]">{businessTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Phone</label><input value={form.phone} onChange={(event) => update('phone', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm" /></div><div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Website</label><input value={form.website} onChange={(event) => update('website', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm" placeholder="https://" /></div></div>
        </div>}

        {step === 2 && <PlanSelection plans={signupPlans} selectedPlanCode={selectedPlanCode} onSelect={setSelectedPlanCode} loading={planLoading} error={planError} />}

        {step === 1 && <WorkspacePreferences form={form} update={update} />}

        {step === reviewStep && <div className="space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-4 text-sm">
          <p className="font-semibold text-[var(--app-text)]">Review and start your free trial</p>
          <div className="grid gap-3 sm:grid-cols-2"><Review label="Business name" value={form.name} /><Review label="Business type" value={form.businessType} /><Review label="Phone" value={form.phone || 'Not provided'} /><Review label="Website" value={form.website || 'Not provided'} /><Review label="Currency" value={form.currency} /><Review label="Timezone" value={form.timezone} />{selectedSignupPlan && <Review label="Signup plan" value={selectedSignupPlan.name} />}</div>
          <p className="border-t border-[var(--app-border)] pt-3 text-xs text-[var(--app-muted)]">The Platform will validate the selected plan and determine all trial and license details.</p>
        </div>}

        {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] px-3 py-2 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" disabled={saving || step === 1} onClick={() => { setError(null); setStep((current) => current - 1); }} className="gap-2"><ChevronLeft size={16} /> Back</Button>
          {step < totalSteps
            ? <Button type="button" disabled={saving || (step === 2 && !selectedSignupPlan)} onClick={continueForward} className="gap-2">Continue <ChevronRight size={16} /></Button>
            : <Button type="button" onClick={() => void startFreeTrial()} disabled={saving || !selectedSignupPlan} className="gap-2"><Check size={16} />{saving ? 'Starting free trial...' : `Start ${selectedSignupPlan?.trialDays ?? ''}-Day Free Trial`}</Button>}
        </div>
      </Card>
    </div>
  );
}

function OnboardingUnavailable() {
  return <div className="flex min-h-screen items-center justify-center bg-[var(--app-surface-subtle)] p-4 sm:p-6">
    <Card className="w-full max-w-md space-y-4 p-6 text-center sm:p-8">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--app-accent-soft)] text-[var(--app-primary)]"><Building2 size={24} /></div>
      <div><h1 className="text-xl font-semibold text-[var(--app-text)]">Workspace onboarding is unavailable</h1><p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">New workspace provisioning is temporarily unavailable. Please try again later.</p></div>
    </Card>
  </div>;
}

function PlanSelection({ plans, selectedPlanCode, onSelect, loading, error }: { plans: SignupPlan[]; selectedPlanCode: string | null; onSelect: (planCode: string) => void; loading: boolean; error: string | null }) {
  return <div className="space-y-4">
    <div><h2 className="text-base font-semibold text-[var(--app-text)]">Choose your plan</h2><p className="mt-1 text-sm text-[var(--app-muted)]">Choose the plan that fits your business.</p></div>
    {loading && <p className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-4 text-sm text-[var(--app-muted)]">Loading the available signup plan...</p>}
    {error && <p className="rounded-xl border border-[var(--app-warning)] bg-[color-mix(in_srgb,var(--app-warning)_10%,white)] p-4 text-sm text-[var(--app-text)]" role="status">{error}</p>}
    {plans.map((plan) => {
      const selected = selectedPlanCode === plan.code;
      return <button key={plan.code} type="button" aria-pressed={selected} onClick={() => onSelect(plan.code)} className={`w-full rounded-xl border-2 bg-white p-5 text-left shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)] focus:ring-offset-2 ${selected ? 'border-[var(--app-primary)]' : 'border-[var(--app-border)] hover:border-[var(--app-primary)]/60'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--app-primary)]">{selected && <Check aria-hidden="true" size={14} strokeWidth={3} />}{selected ? 'Selected' : 'Available'}</p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--app-text)]">{plan.name}</h3>
          </div>
          <p className="text-right text-2xl font-semibold text-[var(--app-text)]">{formatPlanPrice(plan)}<span className="ml-1 text-sm font-normal text-[var(--app-muted)]">{plan.currency} / {plan.billingInterval}</span></p>
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[var(--app-text)]"><span>{plan.trialDays}-day free trial</span><span aria-hidden="true" className="text-[var(--app-tertiary)]">·</span><span>{plan.noCreditCardRequired ? 'No credit card required' : 'Payment details may be required'}</span></p>
        {plan.marketing && <div className="mt-4 border-t border-[var(--app-border)] pt-4">
          {plan.marketing.badge && <p className="text-sm font-semibold text-[var(--app-primary)]">{plan.marketing.badge}</p>}
          <div className={`${plan.marketing.badge ? 'mt-2' : ''} space-y-1 text-sm leading-6 text-[var(--app-muted)]`}>
            {plan.marketing.messages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
          </div>
        </div>}
      </button>;
    })}
  </div>;
}

function WorkspacePreferences({ form, update }: { form: WorkspaceOnboardingInput; update: <K extends keyof WorkspaceOnboardingInput>(key: K, value: WorkspaceOnboardingInput[K]) => void }) {
  return <div className="space-y-4">
    <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Currency <span className="text-[var(--app-danger)]">*</span></label><select value={form.currency} onChange={(event) => update('currency', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></div>
    <div><label className="mb-1 block text-sm font-medium text-[var(--app-text)]">Timezone <span className="text-[var(--app-danger)]">*</span></label><select value={form.timezone} onChange={(event) => update('timezone', event.target.value)} className="w-full rounded-lg border border-[var(--app-border)] px-3 py-2.5 text-sm">{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select><p className="mt-1 text-xs text-[var(--app-tertiary)]">Dates and times will use this IANA timezone.</p></div>
  </div>;
}

function formatPlanPrice(plan: SignupPlan) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.price);
  } catch {
    return `${plan.price} ${plan.currency}`;
  }
}

function errorCode(error: unknown) {
  const candidate = error as { code?: unknown } | null;
  return typeof candidate?.code === 'string' ? candidate.code : undefined;
}

function normalizeRequestedSlug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function handleTrialFailure(
  failure: unknown,
  actions: {
    refreshPlans: () => void;
    refreshWorkspace: () => void;
    returnToPlanSelection: () => void;
    setError: (message: string) => void;
  },
) {
  if (failure instanceof ProvisioningIdempotencyStorageError) {
    actions.setError('Secure retry storage is unavailable. Please enable browser storage before starting your trial.');
    return;
  }
  if (failure instanceof PlatformIntegrationNotReadyError) {
    actions.setError('Free-trial provisioning is not available in this local preview.');
    return;
  }
  const code = failure instanceof PlatformSubscriptionError ? failure.code : errorCode(failure);
  switch (code) {
    case 'UNAUTHENTICATED':
      actions.setError('Your session has expired. Please sign in again before starting your trial.');
      return;
    case 'FORBIDDEN':
      actions.setError('You are not authorized to provision this workspace.');
      return;
    case 'INVALID_PLAN':
      actions.returnToPlanSelection();
      actions.setError('That plan is no longer valid. Select an available plan to continue.');
      return;
    case 'PLAN_UNAVAILABLE':
      actions.refreshPlans();
      actions.returnToPlanSelection();
      actions.setError('The selected plan is no longer available. Choose another plan.');
      return;
    case 'FOUNDING_LIMIT_REACHED':
      actions.refreshPlans();
      actions.returnToPlanSelection();
      actions.setError('The Founding offer is no longer available. Refresh plans and choose another option.');
      return;
    case 'TRIAL_ALREADY_EXISTS':
    case 'WORKSPACE_ALREADY_EXISTS':
      actions.refreshWorkspace();
      actions.setError('We found an existing workspace provisioning result. Refreshing your workspace access now.');
      return;
    case 'IDEMPOTENCY_CONFLICT':
      actions.setError('This provisioning attempt no longer matches your reviewed details. Review your workspace information and start a new attempt.');
      return;
    case 'INVALID_REQUEST':
      actions.setError('Review your workspace information and try again.');
      return;
    case 'LICENSE_NOT_FOUND':
      actions.setError('Your subscription could not be verified. Your workspace was not opened.');
      return;
    case 'PROVISIONING_FAILED':
    case 'INTERNAL_ERROR':
    case 'PLATFORM_UNAVAILABLE':
    case 'INVALID_RESPONSE':
    default:
      actions.setError('Unable to start the free trial. Please try again later.');
  }
}

function Review({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-0.5 break-words font-medium text-[var(--app-text)]">{value}</p></div>;
}
