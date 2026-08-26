import { getDoc, runTransaction } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { BusinessType, Settings } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationDocumentInCollection } from '@/lib/organizations/paths';
import { DEAL_STAGES } from '@/lib/deal-workflow';
import { activityData, activityRef } from '@/lib/repositories/activityEvents';
import { cachedRequest, invalidateCachedRequest } from '@/lib/repositories/requestCache';

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
    ...DEAL_STAGES.map((name) => ({ name, isActive: true })),
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

interface SettingsPersistenceDiagnostics {
  firebaseErrorName?: string;
  firebaseCode?: string;
  firebaseMessage?: string;
  path: string;
  activityPath: string;
  activityType: 'settings_update';
  operation: 'set';
  merge: true;
  transactional: true;
  batchOperationCount: 2;
  authenticatedUid?: string;
  organizationId: string;
  resolvedRole?: string;
  changedFields: string[];
}

interface SettingsLoadDiagnostics {
  firebaseErrorName?: string;
  firebaseCode?: string;
  firebaseMessage?: string;
  path: string;
  operation: 'get';
  sourceFunction: 'loadSettings';
  projectId?: string;
  authResolved: boolean;
  currentUserPresent: boolean;
  navigatorOnline?: boolean;
  durationMs: number;
  authenticatedUid?: string;
  organizationId: string;
}

function safeFirebaseError(error: unknown) {
  const firebaseError = error as { name?: unknown; code?: unknown; message?: unknown };
  return {
    firebaseErrorName: typeof firebaseError.name === 'string' ? firebaseError.name : undefined,
    firebaseCode: typeof firebaseError.code === 'string' ? firebaseError.code : undefined,
    firebaseMessage: typeof firebaseError.message === 'string' ? firebaseError.message : undefined,
  };
}

export class SettingsPersistenceError extends Error {
  readonly diagnostics: SettingsPersistenceDiagnostics;

  constructor(diagnostics: SettingsPersistenceDiagnostics, cause?: unknown) {
    super('Unable to save business settings. Please try again.');
    this.name = 'SettingsPersistenceError';
    this.diagnostics = diagnostics;
    if (cause !== undefined) this.cause = cause;
  }
}

export class SettingsLoadError extends Error {
  readonly diagnostics: SettingsLoadDiagnostics;

  constructor(diagnostics: SettingsLoadDiagnostics, cause?: unknown) {
    super('Unable to load business settings. Please try again.');
    this.name = 'SettingsLoadError';
    this.diagnostics = diagnostics;
    if (cause !== undefined) this.cause = cause;
  }
}

async function requireSettingsManager(user: AppUser | null, organizationId: string) {
  return requireOrganizationAccess(user, organizationId, ['ADMIN']);
}

function isBusinessType(value: unknown): value is BusinessType {
  return ['Real Estate', 'Insurance', 'Agency', 'Freelancer/Consultant', 'Small Business', 'Solo Entrepreneur', 'Professional Services', 'Retail', 'Other'].includes(value as string);
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

function valuesMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesMatch(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key) && valuesMatch(leftRecord[key], rightRecord[key]));
}

function changedSettings(existing: Record<string, unknown>, changes: Partial<PersistedSettings>) {
  return Object.fromEntries(
    Object.entries(changes).filter(([key, value]) => !valuesMatch(existing[key], value)),
  ) as Partial<PersistedSettings>;
}

export async function loadSettings(user: AppUser | null, organizationId: string) {
  const path = settingsDocument(organizationId).path;
  const startedAt = Date.now();
  try {
    if (!user) throw new Error('You must be signed in to access business settings.');
    // WorkspaceContext has already resolved the active tenant. Firestore Rules remain
    // authoritative for this read; the short cache only deduplicates startup/UI reads.
    const snapshot = await cachedRequest(`settings:${user.uid}:${organizationId}`, 30_000, () => getDoc(settingsDocument(organizationId)));
    // Defaults are returned in memory only; an absent document is never overwritten automatically.
    return snapshot.exists() ? mapSettings(snapshot.data()) : defaultSettings;
  } catch (error) {
    throw new SettingsLoadError({
      ...safeFirebaseError(error),
      path,
      operation: 'get',
      sourceFunction: 'loadSettings',
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      authResolved: Boolean(auth.currentUser),
      currentUserPresent: Boolean(auth.currentUser),
      navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      durationMs: Date.now() - startedAt,
      authenticatedUid: user?.uid,
      organizationId,
    }, error);
  }
}

export async function updateSettings(user: AppUser | null, organizationId: string, changes: Partial<Settings>) {
  const persistedChanges = pickPersistedSettings(changes);
  if (Object.keys(persistedChanges).length === 0) return;
  const settingsRef = settingsDocument(organizationId);
  let resolvedRole: string | undefined;

  try {
    if (!user) throw new Error('You must be signed in to update business settings.');
    const access = await requireSettingsManager(user, organizationId);
    resolvedRole = access.membership.role;
    await runTransaction(db, async (transaction) => {
      const existingSnapshot = await transaction.get(settingsRef);
      const existingSettings = existingSnapshot.exists() ? existingSnapshot.data() : {};
      const effectiveChanges = changedSettings(existingSettings, persistedChanges);
      if (Object.keys(effectiveChanges).length === 0) return;

      const writeData = existingSnapshot.exists()
        ? effectiveChanges
        : { ...pickPersistedSettings(defaultSettings), ...effectiveChanges };
      transaction.set(settingsRef, writeData, { merge: true });
      transaction.set(activityRef(organizationId), activityData(user, {
        type: 'settings_update',
        description: 'Business settings updated',
        entityType: 'Settings',
      }));
    });
    invalidateCachedRequest(`settings:${user.uid}:${organizationId}`);
  } catch (error) {
    const diagnostics: SettingsPersistenceDiagnostics = {
      ...safeFirebaseError(error),
      path: settingsRef.path,
      activityPath: activityRef(organizationId).path,
      activityType: 'settings_update',
      operation: 'set',
      merge: true,
      transactional: true,
      batchOperationCount: 2,
      authenticatedUid: user?.uid,
      organizationId,
      resolvedRole,
      changedFields: Object.keys(persistedChanges),
    };
    throw new SettingsPersistenceError(diagnostics, error);
  }
}
