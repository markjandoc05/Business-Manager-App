import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { organizationMemberDocument } from '@/lib/organizations/paths';
import { requireOrganizationAccess } from '@/lib/permissions';

export interface RecordAssignment {
  assignedToUid: string;
  assignedToName: string;
}

export function getDefaultAssignment(user: AppUser): RecordAssignment {
  return { assignedToUid: user.uid, assignedToName: user.name };
}

export async function resolveAssignment(user: AppUser, organizationId: string, assignedToUid?: string, assignedToName?: string): Promise<RecordAssignment> {
  const targetUid = assignedToUid?.trim() || user.uid;
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (targetUid !== user.uid && membership.role === 'USER') throw new Error('You can only assign records to yourself.');

  const targetSnapshot = await getDoc(organizationMemberDocument(db, organizationId, targetUid));
  const target = targetSnapshot.data();
  if (!targetSnapshot.exists() || target?.status !== 'active' || !['ADMIN', 'MANAGER', 'USER'].includes(target.role as string)) {
    throw new Error('The selected assignee is not an active user.');
  }

  return {
    assignedToUid: targetUid,
    assignedToName: targetUid === user.uid ? user.name : typeof target.displayName === 'string' ? target.displayName : assignedToName?.trim() || '',
  };
}

export async function resolveOrganizationAssignment(user: AppUser, organizationId: string, assignedToUid?: string, assignedToName?: string): Promise<RecordAssignment> {
  const targetUid = assignedToUid?.trim() || user.uid;
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (targetUid !== user.uid && membership.role === 'USER') throw new Error('You can only assign records to yourself.');

  const membershipSnapshot = await getDoc(organizationMemberDocument(db, organizationId, targetUid));
  const targetMembership = membershipSnapshot.data();
  if (!membershipSnapshot.exists() || targetMembership?.status !== 'active' || !['ADMIN', 'MANAGER', 'USER'].includes(targetMembership.role as string)) {
    throw new Error('The selected assignee is not an active member of this organization.');
  }

  return {
    assignedToUid: targetUid,
    assignedToName: targetUid === user.uid
      ? user.name
      : typeof targetMembership?.displayName === 'string' && targetMembership.displayName
        ? targetMembership.displayName
        : assignedToName?.trim() || '',
  };
}
