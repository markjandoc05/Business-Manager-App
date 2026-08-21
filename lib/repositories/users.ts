import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, UserRole } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';

export interface AssignableUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export async function listAssignableOrganizationUsers(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  const snapshot = await getDocs(query(collection(db, 'organizations', organizationId, 'members'), where('status', '==', 'active')));
  const members = snapshot.docs.map((memberDoc) => {
    const membership = memberDoc.data();
    const uid = memberDoc.id;
    const role = membership.role === 'ADMIN' || membership.role === 'MANAGER' || membership.role === 'USER'
      ? membership.role as UserRole
      : null;
    if (!role) return null;
    return {
      uid,
      name: typeof membership.displayName === 'string' && membership.displayName ? membership.displayName : 'Unnamed user',
      email: typeof membership.email === 'string' ? membership.email : '',
      role,
    } satisfies AssignableUser;
  });
  return members.filter((item): item is AssignableUser => item !== null).sort((left, right) => left.name.localeCompare(right.name));
}

export interface ManagedOrganizationMember extends AssignableUser {
  status: 'pending' | 'active' | 'inactive' | 'suspended' | 'archived';
  lastLogin?: unknown;
}

export async function listOrganizationMembers(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN']);
  const snapshot = await getDocs(collection(db, 'organizations', organizationId, 'members'));
  return snapshot.docs.map((memberDoc) => {
    const data = memberDoc.data();
    const role = ['ADMIN', 'MANAGER', 'USER'].includes(data.role as string) ? data.role as UserRole : 'USER';
    const status = ['pending', 'active', 'inactive', 'suspended', 'archived'].includes(data.status as string) ? data.status as ManagedOrganizationMember['status'] : 'pending';
    return {
      uid: memberDoc.id,
      name: typeof data.displayName === 'string' ? data.displayName : 'Unnamed user',
      email: typeof data.email === 'string' ? data.email : '',
      role,
      status,
      lastLogin: data.lastLogin,
    } satisfies ManagedOrganizationMember;
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function updateOrganizationMember(user: AppUser | null, organizationId: string, memberUid: string, changes: { role?: UserRole; status?: ManagedOrganizationMember['status'] }) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN']);
  if (!user || memberUid === user.uid) throw new Error('You cannot change your own organization membership.');
  await updateDoc(doc(db, 'organizations', organizationId, 'members', memberUid), changes);
}
