import { getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { BusinessType, Settings } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationDocumentInCollection } from '@/lib/organizations/paths';

function settingsDocument(organizationId: string) {
  return organizationDocumentInCollection(db, organizationId, 'settings', 'settings');
}

export const defaultSettings: Settings = {
  businessName: 'Your Business',
  businessType: 'Small Business',
  email: '',
  phone: '',
  website: '',
  address: '',
  currency: 'USD',
  timezone: 'UTC',
  logoUrl: '',
  accentColor: '#3b82f6',
  pipelineStages: [
    { name: 'Opportunity', isActive: true },
    { name: 'Qualified', isActive: true },
    { name: 'Proposal', isActive: true },
    { name: 'Negotiation', isActive: true },
    { name: 'Won', isActive: true },
    { name: 'Lost', isActive: true },
  ],
  leadSources: [
    { name: 'Website', isActive: true },
    { name: 'Referral', isActive: true },
    { name: 'LinkedIn', isActive: true },
  ],
  customFields: [],
  users: [],
};

const persistedKeys = [
  'businessName', 'businessType', 'email', 'phone', 'website', 'address',
  'currency', 'timezone', 'logoUrl', 'accentColor', 'pipelineStages', 'leadSources',
] as const;

type PersistedSettings = Pick<Settings, typeof persistedKeys[number]>;

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireSettingsManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN']);
}

function isBusinessType(value: unknown): value is BusinessType {
  return ['Real Estate', 'Insurance', 'Agency', 'Freelancer/Consultant', 'Small Business', 'Other'].includes(value as string);
}

function mapSettings(data: Record<string, unknown>): Settings {
  return {
    ...defaultSettings,
    ...data,
    businessType: isBusinessType(data.businessType) ? data.businessType : defaultSettings.businessType,
    pipelineStages: Array.isArray(data.pipelineStages) ? data.pipelineStages as Settings['pipelineStages'] : defaultSettings.pipelineStages,
    leadSources: Array.isArray(data.leadSources) ? data.leadSources as Settings['leadSources'] : defaultSettings.leadSources,
    customFields: [],
    users: [],
  };
}

function pickPersistedSettings(changes: Partial<Settings>): Partial<PersistedSettings> {
  return Object.fromEntries(
    persistedKeys
      .filter((key) => changes[key] !== undefined)
      .map((key) => [key, changes[key]]),
  ) as Partial<PersistedSettings>;
}

export async function loadSettings(user: AppUser | null, organizationId: string) {
  await requireActiveUser(user, organizationId);
  try {
    const snapshot = await getDoc(settingsDocument(organizationId));
    // Defaults are returned in memory only; an absent document is never overwritten automatically.
    return snapshot.exists() ? mapSettings(snapshot.data()) : defaultSettings;
  } catch (error) {
    console.error('Unable to load Firestore business settings', error);
    throw new Error('Unable to load business settings. Please try again.');
  }
}

export async function updateSettings(user: AppUser | null, organizationId: string, changes: Partial<Settings>) {
  await requireSettingsManager(user, organizationId);
  const persistedChanges = pickPersistedSettings(changes);
  if (Object.keys(persistedChanges).length === 0) return;

  try {
    await setDoc(settingsDocument(organizationId), persistedChanges, { merge: true });
  } catch (error) {
    console.error('Unable to update Firestore business settings', error);
    throw new Error('Unable to save business settings. Please try again.');
  }
}
