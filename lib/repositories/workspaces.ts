import { collection, collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, MembershipStatus, Organization, OrganizationMembership, OrganizationRole, OrganizationStatus } from '@/types/auth';
import type { BusinessType, Settings } from '@/types';
import { defaultSettings } from '@/lib/repositories/settings';
import { DEAL_STAGES } from '@/lib/deal-workflow';
import { DEFAULT_LICENSE_FEATURES, DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_MAX_USERS } from '@/lib/licensing/config';
import { cachedRequest } from '@/lib/repositories/requestCache';
import { finishStartupStage, markStartup, startStartupStage } from '@/lib/startupTiming';

const organizationStatuses: OrganizationStatus[] = ['trial', 'active', 'expired', 'suspended'];
const membershipStatuses: MembershipStatus[] = ['pending', 'active', 'inactive', 'suspended', 'archived'];

function toIsoDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : undefined;
}

function mapMembership(data: Record<string, unknown>, organizationId: string): OrganizationMembership | null {
  const role = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER' ? data.role as OrganizationRole : null;
  const status = membershipStatuses.includes(data.status as MembershipStatus) ? data.status as MembershipStatus : null;
  if (!role || !status || typeof data.userId !== 'string') return null;
  return { organizationId, userId: data.userId, email: typeof data.email === 'string' ? data.email : '', displayName: typeof data.displayName === 'string' ? data.displayName : '', role, status, joinedAt: toIsoDate(data.joinedAt), activatedAt: toIsoDate(data.activatedAt), activatedBy: typeof data.activatedBy === 'string' ? data.activatedBy : undefined };
}

function mapOrganization(id: string, data: Record<string, unknown>): Organization | null {
  const status = organizationStatuses.includes(data.status as OrganizationStatus) ? data.status as OrganizationStatus : null;
  if (!status || typeof data.name !== 'string' || typeof data.slug !== 'string') return null;
  return { id, name: data.name, slug: data.slug, businessType: typeof data.businessType === 'string' ? data.businessType : 'Small Business', status, plan: typeof data.plan === 'string' ? data.plan : 'trial', subscriptionStatus: typeof data.subscriptionStatus === 'string' ? data.subscriptionStatus : 'trial', subscriptionStart: toIsoDate(data.subscriptionStart), subscriptionEnd: toIsoDate(data.subscriptionEnd), maxUsers: typeof data.maxUsers === 'number' ? data.maxUsers : 1, gracePeriodEnd: toIsoDate(data.gracePeriodEnd), createdAt: toIsoDate(data.createdAt), updatedAt: toIsoDate(data.updatedAt), licenseStatus: ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(data.licenseStatus as string) ? data.licenseStatus as Organization['licenseStatus'] : undefined, licenseWriteEnabled: typeof data.licenseWriteEnabled === 'boolean' ? data.licenseWriteEnabled : undefined, licenseExpiresAt: toIsoDate(data.licenseExpiresAt) };
}

export async function listUserMemberships(user: Pick<AppUser, 'uid'> | null) {
  if (!user) return [];
  return cachedRequest(`workspace-memberships:${user.uid}`, 5_000, async () => {
    startStartupStage('membership-query');
    const snapshot = await getDocs(query(
      collectionGroup(db, 'members'),
      where('userId', '==', user.uid),
      where('role', 'in', ['ADMIN', 'MANAGER', 'USER']),
      where('status', 'in', ['pending', 'active', 'inactive', 'suspended', 'archived']),
      limit(100),
    ));
    finishStartupStage('membership-query');
    markStartup('membership-complete');
    return snapshot.docs.map((membershipDoc) => mapMembership(membershipDoc.data(), membershipDoc.ref.parent.parent?.id || '')).filter((membership): membership is OrganizationMembership => membership !== null);
  });
}

export async function getOrganization(organizationId: string) {
  const snapshot = await getDoc(doc(db, 'organizations', organizationId));
  return snapshot.exists() ? mapOrganization(snapshot.id, snapshot.data()) : null;
}

export function subscribeToOrganization(organizationId: string, onChange: (organization: Organization | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'organizations', organizationId), (snapshot) => {
    onChange(snapshot.exists() ? mapOrganization(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export class WorkspaceSlugError extends Error {
  code = 'workspace-slug-error' as const;
  constructor() {
    super('That workspace name is already in use. Please try another name.');
    this.name = 'WorkspaceSlugError';
  }
}

export class WorkspaceAlreadyExistsError extends Error {
  code = 'workspace-already-exists' as const;
  constructor() {
    super('A workspace already exists for this account.');
    this.name = 'WorkspaceAlreadyExistsError';
  }
}

function normalizeSlug(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new WorkspaceSlugError();
  return slug.slice(0,  sixtyFour);
}

const sixtyFour = 64;
const onboardingBusinessTypes: BusinessType[] = ['Solo Entrepreneur', 'Agency', 'Real Estate', 'Professional Services', 'Retail', 'Other'];
const onboardingCurrencies = ['PHP', 'USD', 'AUD', 'SGD', 'EUR', 'GBP'];

export interface WorkspaceOnboardingInput {
  name: string;
  businessType: BusinessType;
  phone: string;
  website: string;
  currency: string;
  timezone: string;
}

export async function createWorkspace(user: AppUser, input: WorkspaceOnboardingInput) {
  const name = input.name.trim();
  if (!name || !onboardingBusinessTypes.includes(input.businessType) || !onboardingCurrencies.includes(input.currency) || !input.timezone.trim()) {
    throw new Error('Please complete the required workspace information.');
  }

  const organizationRef = doc(collection(db, 'organizations'));
  const baseSlug = normalizeSlug(name);
  const settingsRef = doc(db, 'organizations', organizationRef.id, 'settings', 'settings');
  const licenseRef = doc(db, 'organizations', organizationRef.id, 'license', 'current');
  const membershipRef = doc(db, 'organizations', organizationRef.id, 'members', user.uid);
  const userRef = doc(db, 'users', user.uid);
  const bootstrapGuardRef = doc(db, 'workspaceBootstrap', user.uid);
  const timestamp = serverTimestamp();
  const trialEndsAt = Timestamp.fromMillis(Date.now() + DEFAULT_TRIAL_DAYS * 86_400_000);
  const pipelineStages: Settings['pipelineStages'] = DEAL_STAGES.map((name) => ({ name, isActive: true }));

  await runTransaction(db, async (transaction) => {
    const existingGuard = await transaction.get(bootstrapGuardRef);
    if (existingGuard.exists()) throw new WorkspaceAlreadyExistsError();
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists()) throw new Error('Your account profile is not ready yet. Please try again.');
    // Slug records are an internal uniqueness index and are intentionally not
    // readable by browser clients. The create rule atomically rejects a slug
    // that already exists; do not pre-read the index from the client.
    const slug = baseSlug;
    const slugRef = doc(db, 'organizationSlugs', slug);

    transaction.set(organizationRef, {
      name,
      slug,
      businessType: input.businessType,
      status: 'trial',
      plan: 'trial',
      subscriptionStatus: 'trial',
      maxUsers: DEFAULT_TRIAL_MAX_USERS,
      licenseStatus: 'TRIAL',
      licenseWriteEnabled: true,
      licenseExpiresAt: trialEndsAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUid: user.uid,
    });
    transaction.set(slugRef, { organizationId: organizationRef.id, slug, createdAt: timestamp, createdByUid: user.uid });
    transaction.set(membershipRef, {
      userId: user.uid,
      email: user.email,
      displayName: user.name,
      role: 'ADMIN',
      status: 'active',
      joinedAt: timestamp,
      activatedAt: timestamp,
      activatedBy: user.uid,
    });
    transaction.update(userRef, { status: 'active', active: true });
    transaction.set(settingsRef, {
      businessName: name,
      businessType: input.businessType,
      email: user.email,
      phone: input.phone.trim(),
      website: input.website.trim(),
      address: '',
      currency: input.currency,
      timezone: input.timezone.trim(),
      logoUrl: '',
      accentColor: defaultSettings.accentColor,
      pipelineStages,
      leadSources: defaultSettings.leadSources,
    });
    transaction.set(licenseRef, {
      plan: 'TRIAL',
      status: 'TRIAL',
      trialStartedAt: timestamp,
      trialEndsAt,
      maxUsers: DEFAULT_TRIAL_MAX_USERS,
      features: DEFAULT_LICENSE_FEATURES,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: user.uid,
    });
    transaction.set(bootstrapGuardRef, { organizationId: organizationRef.id, createdAt: timestamp, createdByUid: user.uid });
  });

  return organizationRef.id;
}
