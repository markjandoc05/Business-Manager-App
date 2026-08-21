import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, UserRole } from '@/types/auth';
import { canViewBusinessData } from '@/lib/permissions';

export interface AssignableUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export async function listAssignableOrganizationUsers(user: AppUser | null, organizationId: string) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to users.');
  const snapshot = await getDocs(query(collection(db, 'organizations', organizationId, 'members'), where('status', '==', 'active')));
  const members = await Promise.all(snapshot.docs.map(async (memberDoc) => {
    const membership = memberDoc.data();
    const uid = memberDoc.id;
    const profileSnapshot = await getDoc(doc(db, 'users', uid));
    const profile = profileSnapshot.data() || {};
    const role = membership.role === 'ADMIN' || membership.role === 'MANAGER' || membership.role === 'USER'
      ? membership.role as UserRole
      : null;
    if (!role) return null;
    return {
      uid,
      name: typeof membership.displayName === 'string' && membership.displayName ? membership.displayName : typeof profile.name === 'string' ? profile.name : 'Unnamed user',
      email: typeof membership.email === 'string' && membership.email ? membership.email : typeof profile.email === 'string' ? profile.email : '',
      role,
    } satisfies AssignableUser;
  }));
  return members.filter((item): item is AssignableUser => item !== null).sort((left, right) => left.name.localeCompare(right.name));
}
