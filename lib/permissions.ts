import type { AppUser, UserRole } from '@/types/auth';

export const canManageUsers = (user: AppUser | null) => user?.active === true && user.role === 'ADMIN';
export const canManageSettings = (user: AppUser | null) => user?.active === true && user.role === 'ADMIN';
export const canManageClients = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canManageLeads = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canManageTasks = (user: AppUser | null) => user?.active === true && (user.role === 'ADMIN' || user.role === 'MANAGER');
export const canViewBusinessData = (user: AppUser | null) => user?.active === true && ['ADMIN', 'MANAGER', 'USER'].includes(user.role);

export function hasRole(user: AppUser | null, roles: UserRole[]) {
  return user?.active === true && roles.includes(user.role);
}
