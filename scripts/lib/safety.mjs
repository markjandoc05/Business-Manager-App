export const PRODUCTION_PROJECT_ID = 'bsm-client-app-web';

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value.trim();
}

function firebaseConfigProjectId(environment) {
  const raw = environment.FIREBASE_CONFIG?.trim();
  if (!raw || !raw.startsWith('{')) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_CONFIG is not valid JSON.');
  }
  return typeof parsed.projectId === 'string' && parsed.projectId.trim() ? parsed.projectId.trim() : undefined;
}

function configuredIdentities(environment) {
  return [
    ['--project', undefined],
    ['GOOGLE_CLOUD_PROJECT', environment.GOOGLE_CLOUD_PROJECT],
    ['GCLOUD_PROJECT', environment.GCLOUD_PROJECT],
    ['FIREBASE_ADMIN_PROJECT_ID', environment.FIREBASE_ADMIN_PROJECT_ID],
    ['FIREBASE_CONFIG.projectId', firebaseConfigProjectId(environment)],
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
  ].filter(([, value]) => typeof value === 'string' && value.trim()).map(([source, value]) => [source, value.trim()]);
}

export function requireProductionProject({ args = process.argv.slice(2), environment = process.env } = {}) {
  if (environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Production mutation scripts refuse Firebase emulator configuration.');
  }

  const cliProject = optionValue(args, '--project');
  const identities = configuredIdentities(environment);
  if (cliProject) identities.unshift(['--project', cliProject]);

  if (identities.length === 0) {
    throw new Error(`An explicit target project is required. Pass --project ${PRODUCTION_PROJECT_ID} or set GOOGLE_CLOUD_PROJECT.`);
  }

  const projectIds = [...new Set(identities.map(([, value]) => value))];
  if (projectIds.length > 1) {
    throw new Error(`Contradictory Firebase project identities: ${identities.map(([source]) => source).join(', ')}.`);
  }
  if (projectIds[0] !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Refusing project ${projectIds[0]}; expected ${PRODUCTION_PROJECT_ID}.`);
  }
  return PRODUCTION_PROJECT_ID;
}

export function assertMutationSafety({ apply, destructive = false, args = process.argv.slice(2), environment = process.env, scope }) {
  const projectId = requireProductionProject({ args, environment });
  if (destructive && apply && !args.includes('--confirm-production-reset')) {
    throw new Error('Destructive apply requires --confirm-production-reset.');
  }
  return {
    projectId,
    mode: apply ? 'apply' : 'dry-run',
    scope,
    writesAllowed: Boolean(apply),
  };
}

export function logMutationSafety(safety) {
  console.log(JSON.stringify({
    operationSafety: {
      projectId: safety.projectId,
      mode: safety.mode,
      scope: safety.scope,
      writesAllowed: safety.writesAllowed,
    },
  }));
}
