import type { AppUser, OrganizationMembership, OrganizationStatus, PlatformUserProfile, UserRole } from '@/types/auth';

export const isActiveMembership = (membership: OrganizationMembership | null) => membership?.status === 'active';
export const hasOrganizationRole = (membership: OrganizationMembership | null, roles: UserRole[]) => isActiveMembership(membership) && !!membership && roles.includes(membership.role);
export const canManageOrganizationMembers = (membership: OrganizationMembership | null) => hasOrganizationRole(membership, ['ADMIN']);
export const canAccessOrganization = (membership: OrganizationMembership | null, status: OrganizationStatus | null) => isActiveMembership(membership) && (status === 'active' || status === 'trial');
export const isPlatformAdmin = (platformUser: PlatformUserProfile | null) => platformUser?.role === 'PLATFORM_ADMIN' && platformUser.status === 'active';

export const canManageUsers = (user: AppUser | null) => user?.active === true && user.role === 'ADMIN';
export const canManageSettings = (user: AppUser | null) => user?.active === true && user.role === 'ADMIN';
export const canManageClients = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canManageLeads = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canManageTasks = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canViewBusinessData = (user: AppUser | null) => user?.active === true && ['ADMIN', 'MANAGER', 'USER'].includes(user.role);

export function hasRole(user: AppUser | null, roles: UserRole[]) {
  return user?.active === true && roles.includes(user.role);
}
