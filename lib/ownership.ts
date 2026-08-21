import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { organizationMemberDocument } from '@/lib/organizations/paths';

export interface RecordAssignment {
  assignedToUid: string;
  assignedToName: string;
}

export function getDefaultAssignment(user: AppUser): RecordAssignment {
  return { assignedToUid: user.uid, assignedToName: user.name };
}

export async function resolveAssignment(user: AppUser, assignedToUid?: string, assignedToName?: string): Promise<RecordAssignment> {
  const targetUid = assignedToUid?.trim() || user.uid;
  if (targetUid !== user.uid && user.role === 'USER') throw new Error('You can only assign records to yourself.');

  const targetSnapshot = await getDoc(doc(db, 'users', targetUid));
  const target = targetSnapshot.data();
  if (!targetSnapshot.exists() || target?.active !== true || !['ADMIN', 'MANAGER', 'USER'].includes(target.role as string)) {
    throw new Error('The selected assignee is not an active user.');
  }

  return {
    assignedToUid: targetUid,
    assignedToName: targetUid === user.uid ? user.name : typeof target.name === 'string' ? target.name : assignedToName?.trim() || '',
  };
}

export async function resolveOrganizationAssignment(user: AppUser, organizationId: string, assignedToUid?: string, assignedToName?: string): Promise<RecordAssignment> {
  const targetUid = assignedToUid?.trim() || user.uid;
  if (targetUid !== user.uid && user.role === 'USER') throw new Error('You can only assign records to yourself.');

  const membershipSnapshot = await getDoc(organizationMemberDocument(db, organizationId, targetUid));
  const membership = membershipSnapshot.data();
  if (!membershipSnapshot.exists() || membership?.status !== 'active' || !['ADMIN', 'MANAGER', 'USER'].includes(membership.role as string)) {
    throw new Error('The selected assignee is not an active member of this organization.');
  }

  const profileSnapshot = await getDoc(doc(db, 'users', targetUid));
  const profile = profileSnapshot.data();
  return {
    assignedToUid: targetUid,
    assignedToName: targetUid === user.uid
      ? user.name
      : typeof membership.displayName === 'string' && membership.displayName
        ? membership.displayName
        : typeof profile?.name === 'string'
          ? profile.name
          : assignedToName?.trim() || '',
  };
}
