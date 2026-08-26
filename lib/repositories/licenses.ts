import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, License } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationDocumentInCollection } from '@/lib/organizations/paths';
import { DEFAULT_LEGACY_MAX_USERS } from '@/lib/licensing/config';
import { parseLicense, resolveLicenseState } from '@/lib/licensing/license-evaluator';

export { parseLicense, resolveLicenseState } from '@/lib/licensing/license-evaluator';

export function licenseDocument(organizationId: string) {
  return organizationDocumentInCollection(db, organizationId, 'license', 'current');
}

export async function getOrganizationLicense(organizationId: string) {
  const snapshot = await getDoc(licenseDocument(organizationId));
  return snapshot.exists() ? parseLicense(snapshot.data()) : null;
}

export function subscribeToOrganizationLicense(organizationId: string, onChange: (license: License | null) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(licenseDocument(organizationId), (snapshot) => {
    onChange(snapshot.exists() ? parseLicense(snapshot.data()) : null);
  }, onError);
}

export async function loadOrganizationLicense(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  try {
    return await getOrganizationLicense(organizationId);
  } catch (error) {
    console.error('Unable to load organization license', error);
    throw new Error('Unable to load subscription status. Please try again.');
  }
}

export const legacyMaxUsers = DEFAULT_LEGACY_MAX_USERS;
