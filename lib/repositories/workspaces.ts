import { collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { MembershipStatus, Organization, OrganizationMembership, OrganizationRole, OrganizationStatus } from '@/types/auth';

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
  return { id, name: data.name, slug: data.slug, businessType: typeof data.businessType === 'string' ? data.businessType : 'Small Business', status, plan: typeof data.plan === 'string' ? data.plan : 'trial', subscriptionStatus: typeof data.subscriptionStatus === 'string' ? data.subscriptionStatus : 'trial', subscriptionStart: toIsoDate(data.subscriptionStart), subscriptionEnd: toIsoDate(data.subscriptionEnd), maxUsers: typeof data.maxUsers === 'number' ? data.maxUsers : 1, gracePeriodEnd: toIsoDate(data.gracePeriodEnd), createdAt: toIsoDate(data.createdAt), updatedAt: toIsoDate(data.updatedAt) };
}

export async function listUserMemberships(user: AppUser | null) {
  if (!user) return [];
  const snapshot = await getDocs(query(collectionGroup(db, 'members'), where('userId', '==', user.uid), where('status', '==', 'active')));
  return snapshot.docs.map((membershipDoc) => mapMembership(membershipDoc.data(), membershipDoc.ref.parent.parent?.id || '')).filter((membership): membership is OrganizationMembership => membership !== null && membership.status === 'active');
}

export async function getOrganization(organizationId: string) {
  const snapshot = await getDoc(doc(db, 'organizations', organizationId));
  return snapshot.exists() ? mapOrganization(snapshot.id, snapshot.data()) : null;
}
