export type UserRole = 'ADMIN' | 'MANAGER' | 'USER';
export type OrganizationRole = UserRole;
export type OrganizationStatus = 'trial' | 'active' | 'expired' | 'suspended';
export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'archived';
export type PlatformRole = 'PLATFORM_ADMIN';

export interface GlobalUserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  status: 'pending' | 'active' | 'disabled';
  createdAt?: string;
  lastLoginAt?: string;
  /** Legacy fields retained only during the Phase 1 compatibility period. */
  role?: UserRole;
  active?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  status: OrganizationStatus;
  plan: string;
  subscriptionStatus: string;
  subscriptionStart?: string;
  subscriptionEnd?: string;
  maxUsers: number;
  gracePeriodEnd?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
  status: MembershipStatus;
  joinedAt?: string;
  activatedAt?: string;
  activatedBy?: string;
}

export interface PlatformUserProfile {
  uid: string;
  role: PlatformRole;
  status: 'active' | 'inactive';
  createdAt?: string;
}

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  /** Legacy global profile fields retained for login/pending-account compatibility only. */
  role: UserRole;
  active: boolean;
  /** Global account state. Organization access is controlled by membership status. */
  accountStatus: 'pending' | 'active' | 'disabled';
}
