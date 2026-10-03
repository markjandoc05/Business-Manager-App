import { collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, MembershipStatus, Organization, OrganizationMembership, OrganizationRole, OrganizationStatus } from '@/types/auth';
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
  return {
    organizationId,
    userId: data.userId,
    email: typeof data.email === 'string' ? data.email : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    role,
    status,
    joinedAt: toIsoDate(data.joinedAt),
    activatedAt: toIsoDate(data.activatedAt),
    activatedBy: typeof data.activatedBy === 'string' ? data.activatedBy : undefined,
    lastLoginAt: toIsoDate(data.lastLoginAt),
    lastLoginStatus: data.lastLoginStatus === 'SUCCESS' || data.lastLoginStatus === 'FAILED' ? data.lastLoginStatus : undefined,
    lastSuccessfulLoginAt: toIsoDate(data.lastSuccessfulLoginAt),
    lastFailedLoginAt: toIsoDate(data.lastFailedLoginAt),
    lastLoginFailureCode: ['BOOTSTRAP_FAILED', 'MEMBERSHIP_INACTIVE', 'LICENSE_BLOCKED', 'WORKSPACE_ACCESS_FAILED'].includes(data.lastLoginFailureCode as string) ? data.lastLoginFailureCode as OrganizationMembership['lastLoginFailureCode'] : undefined,
  };
}

function mapOrganization(id: string, data: Record<string, unknown>): Organization | null {
  const status = organizationStatuses.includes(data.status as OrganizationStatus) ? data.status as OrganizationStatus : null;
  if (!status || typeof data.name !== 'string' || typeof data.slug !== 'string') return null;
  return { id, name: data.name, slug: data.slug, businessType: typeof data.businessType === 'string' ? data.businessType : 'Small Business', status, plan: typeof data.plan === 'string' ? data.plan : 'trial', subscriptionStatus: typeof data.subscriptionStatus === 'string' ? data.subscriptionStatus : 'trial', subscriptionStart: toIsoDate(data.subscriptionStart), subscriptionEnd: toIsoDate(data.subscriptionEnd), maxUsers: typeof data.maxUsers === 'number' ? data.maxUsers : 1, gracePeriodEnd: toIsoDate(data.gracePeriodEnd), createdAt: toIsoDate(data.createdAt), updatedAt: toIsoDate(data.updatedAt), licenseStatus: ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(data.licenseStatus as string) ? data.licenseStatus as Organization['licenseStatus'] : undefined, licenseWriteEnabled: typeof data.licenseWriteEnabled === 'boolean' ? data.licenseWriteEnabled : undefined, licenseExpiresAt: toIsoDate(data.licenseExpiresAt) };
}

export async function listUserMemberships(user: Pick<AppUser, 'uid'> | null) {
  if (!user) return [];
  return cachedRequest(`workspace-memberships:${user.uid}`, 5_000, async () => {
    // Firestore correctly denies collection-group membership queries until the
    // caller's root profile is active. Read the caller's own profile first so
    // first-login onboarding resolves to an empty workspace list instead of a
    // permission error while the pending profile is being prepared.
    const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists() || profile?.status !== 'active' || profile.active === false) return [];
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

export function subscribeToOrganizationMembership(organizationId: string, userId: string, onChange: (membership: OrganizationMembership | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'organizations', organizationId, 'members', userId), (snapshot) => {
    onChange(snapshot.exists() ? mapMembership(snapshot.data(), organizationId) : null);
  }, onError);
}
