import { getApps } from 'firebase-admin/app';

export const PRODUCTION_FIREBASE_PROJECT_ID = 'bsm-client-app-web';
export const EMULATOR_FIREBASE_PROJECT_ID = 'demo-bsm-client-app';

type Environment = Record<string, string | undefined>;

function value(environment: Environment, name: string) {
  const candidate = environment[name]?.trim();
  return candidate || undefined;
}

function firebaseConfigProjectId(environment: Environment) {
  const raw = value(environment, 'FIREBASE_CONFIG');
  if (!raw || !raw.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(raw) as { projectId?: unknown };
    return typeof parsed.projectId === 'string' && parsed.projectId.trim() ? parsed.projectId.trim() : undefined;
  } catch {
    throw new Error('Firebase project identity is invalid: FIREBASE_CONFIG is not valid JSON.');
  }
}

export function resolveFirebaseProjectIdentity(environment: Environment = process.env, existingAppProjectId?: string) {
  const sources: Array<[string, string | undefined]> = [
    ['FIREBASE_ADMIN_PROJECT_ID', value(environment, 'FIREBASE_ADMIN_PROJECT_ID')],
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', value(environment, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID')],
    ['GOOGLE_CLOUD_PROJECT', value(environment, 'GOOGLE_CLOUD_PROJECT')],
    ['GCLOUD_PROJECT', value(environment, 'GCLOUD_PROJECT')],
    ['FIREBASE_CONFIG.projectId', firebaseConfigProjectId(environment)],
    ['Firebase Admin app options', existingAppProjectId?.trim() || undefined],
  ].filter(([, projectId]) => projectId) as Array<[string, string]>;

  const projectIds = [...new Set(sources.map(([, projectId]) => projectId))];
  if (projectIds.length > 1) {
    throw new Error(`Firebase project identity is contradictory across ${sources.map(([source]) => source).join(', ')}.`);
  }

  const hasFirestoreEmulator = Boolean(value(environment, 'FIRESTORE_EMULATOR_HOST'));
  const hasAuthEmulator = Boolean(value(environment, 'FIREBASE_AUTH_EMULATOR_HOST'));
  const hasAnyEmulator = hasFirestoreEmulator || hasAuthEmulator;
  const expectedOverride = value(environment, 'BSM_EXPECTED_PROJECT_ID');
  const authoritativeSources = sources.filter(([source]) =>
    ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIREBASE_CONFIG.projectId', 'Firebase Admin app options'].includes(source),
  );

  if (hasAnyEmulator) {
    if (!hasFirestoreEmulator || !hasAuthEmulator) {
      throw new Error('Firebase emulator configuration is incomplete: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are both required.');
    }
    if (expectedOverride && expectedOverride !== EMULATOR_FIREBASE_PROJECT_ID) {
      throw new Error('Firebase emulator project identity is invalid.');
    }
    if (projectIds.length !== 1 || projectIds[0] !== EMULATOR_FIREBASE_PROJECT_ID) {
      throw new Error(`Firebase emulator tests require project ${EMULATOR_FIREBASE_PROJECT_ID}.`);
    }
    return { projectId: EMULATOR_FIREBASE_PROJECT_ID, mode: 'emulator' as const };
  }

  if (expectedOverride && expectedOverride !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error('Firebase production project expectation is invalid.');
  }
  if (authoritativeSources.length === 0) {
    throw new Error('Firebase production initialization requires an authoritative runtime or app project identity.');
  }
  if (projectIds.length !== 1 || projectIds[0] !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(`Firebase production initialization requires project ${PRODUCTION_FIREBASE_PROJECT_ID}.`);
  }
  return { projectId: PRODUCTION_FIREBASE_PROJECT_ID, mode: 'production' as const };
}

export function assertFirebaseProject() {
  const existingProjectId = getApps()[0]?.options.projectId;
  return resolveFirebaseProjectIdentity(process.env, existingProjectId);
}
