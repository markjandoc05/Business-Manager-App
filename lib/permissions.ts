import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, OrganizationMembership, OrganizationStatus, PlatformUserProfile, UserRole } from '@/types/auth';
import { cachedRequest } from '@/lib/repositories/requestCache';

export const isActiveMembership = (membership: OrganizationMembership | null) => membership?.status === 'active';
export const hasOrganizationRole = (membership: OrganizationMembership | null, roles: UserRole[]) => isActiveMembership(membership) && !!membership && roles.includes(membership.role);
export const canManageOrganizationMembers = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN']);
export const canAccessOrganization = (membership: OrganizationMembership | null, status: OrganizationStatus | null) => isActiveMembership(membership) && ['active', 'trial', 'expired', 'suspended'].includes(status || '');
export const isPlatformAdmin = (platformUser: PlatformUserProfile | null) => platformUser?.role === 'PLATFORM_ADMIN' && platformUser.status === 'active';

export const canManageUsers = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN']);
export const canManageSettings = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN']);
export const canManageClients = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN', 'MANAGER']);
export const canManageLeads = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN', 'MANAGER']);
export const canManageDeals = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN', 'MANAGER']);
export const canManageTasks = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN', 'MANAGER']);
export const canAssignOrganizationRecords = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN', 'MANAGER']);
export const canViewBusinessData = (membership: OrganizationMembership | null, status?: OrganizationStatus | null) => canAccessOrganization(membership, status ?? 'active');

export async function requireOrganizationAccess(user: AppUser | null, organizationId: string, roles?: UserRole[]) {
  if (!user) throw new Error('You must be signed in to access this organization.');
  // This is an in-flight/request-turn dedupe only. Firestore rules remain the
  // authority for every read and write; the very short TTL avoids stale UI
  // authorization state while collapsing concurrent page-load checks.
  const access = await cachedRequest(`organization-access:${user.uid}:${organizationId}`, 1, async () => {
    const [membershipSnapshot, organizationSnapshot] = await Promise.all([
      getDoc(doc(db, 'organizations', organizationId, 'members', user.uid)),
      getDoc(doc(db, 'organizations', organizationId)),
    ]);
    const data = membershipSnapshot.data();
    const membership = membershipSnapshot.exists() && data?.userId === user.uid && data.status === 'active' && ['ADMIN', 'MANAGER', 'USER'].includes(data.role as string)
      ? { organizationId, userId: user.uid, email: typeof data.email === 'string' ? data.email : user.email, displayName: typeof data.displayName === 'string' ? data.displayName : user.name, role: data.role as UserRole, status: 'active' as const }
      : null;
    const organizationStatus = organizationSnapshot.data()?.status as OrganizationStatus | undefined;
    if (!membership || !organizationSnapshot.exists() || !['trial', 'active', 'expired', 'suspended'].includes(organizationStatus || '')) {
      throw new Error('You do not have access to this organization.');
    }
    return { membership, organizationStatus };
  });
  if (roles && !roles.includes(access.membership.role)) throw new Error('You do not have permission for this organization action.');
  return access;
}

/** Legacy global profile helper. Use organization membership helpers for tenant authorization. */
export function hasRole(user: AppUser | null, roles: UserRole[]) {
  return user?.active === true && roles.includes(user.role);
}
