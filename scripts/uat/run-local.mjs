#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';

const PROJECT_ID = 'demo-bsm-client-app';
const ROOT = resolve(process.cwd());
const credentialsFile = resolve(process.env.BSM_UAT_CREDENTIALS_FILE || '/private/tmp/ventale-client-uat-credentials.json');
const testFiles = [
  'tests/uat/authenticated-smoke.spec.mjs',
  'tests/uat/deal-client-selector.spec.mjs',
  'tests/uat/mobile-responsiveness.spec.mjs',
];

function assertLocalCredentialPath() {
  const relativePath = relative(ROOT, credentialsFile);
  const insideRepository = relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
  const allowedTemporaryPath = credentialsFile.startsWith('/private/tmp/') || credentialsFile.startsWith(`${tmpdir()}/`);
  if (insideRepository || !allowedTemporaryPath) {
    throw new Error('BSM_UAT_CREDENTIALS_FILE must point to a local temporary path outside the repository.');
  }
}

function assertDemoEnvironment() {
  const inheritedProjectIds = [
    process.env.FIREBASE_ADMIN_PROJECT_ID,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCLOUD_PROJECT,
  ].filter(Boolean);
  if (inheritedProjectIds.some((value) => value !== PROJECT_ID)) {
    throw new Error(`Local authenticated UAT is restricted to Firebase project ${PROJECT_ID}.`);
  }
  const firebaseConfig = process.env.FIREBASE_CONFIG?.trim();
  if (firebaseConfig) {
    if (!firebaseConfig.startsWith('{')) throw new Error('Local authenticated UAT requires FIREBASE_CONFIG to be demo-project JSON when provided.');
    let parsed;
    try { parsed = JSON.parse(firebaseConfig); } catch { throw new Error('Local authenticated UAT requires valid FIREBASE_CONFIG JSON when provided.'); }
    if (parsed.projectId && parsed.projectId !== PROJECT_ID) throw new Error(`Local authenticated UAT is restricted to Firebase project ${PROJECT_ID}.`);
  }
  assertLocalCredentialPath();
}

async function findFreePort(usedPorts) {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else if (!port || usedPorts.has(port)) findFreePort(usedPorts).then(resolvePort, reject);
        else { usedPorts.add(port); resolvePort(port); }
      });
    });
  });
}

function waitForPort(port, timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolvePort, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolvePort(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) reject(new Error(`Timed out waiting for 127.0.0.1:${port}.`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function waitForHttp(port, path, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.status < 500) return;
    } catch {
      // Next may still be compiling the route.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for local UAT route ${path}.`);
}

function child(command, args, env) {
  const handle = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  handle.stdout.on('data', (chunk) => process.stdout.write(chunk));
  handle.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return handle;
}

function stop(handle) {
  if (handle && !handle.killed) handle.kill('SIGTERM');
}

function waitForExit(handle, label) {
  return once(handle, 'exit').then(([code, signal]) => {
    if (code !== 0) throw new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
    return code;
  });
}

assertDemoEnvironment();
const usedPorts = new Set();
const authPort = await findFreePort(usedPorts);
const firestorePort = await findFreePort(usedPorts);
const storagePort = await findFreePort(usedPorts);
const appPort = await findFreePort(usedPorts);
const tempConfigDirectory = join(tmpdir(), `ventale-client-uat-${process.pid}`);
const nextDistDirectory = '.next-uat';
const firebaseConfigPath = join(tempConfigDirectory, 'firebase.json');
mkdirSync(tempConfigDirectory, { recursive: true });
writeFileSync(firebaseConfigPath, `${JSON.stringify({
  firestore: { rules: join(ROOT, 'firestore.rules'), indexes: join(ROOT, 'firestore.indexes.json') },
  storage: { rules: join(ROOT, 'storage.rules') },
  emulators: {
    auth: { host: '127.0.0.1', port: authPort },
    firestore: { host: '127.0.0.1', port: firestorePort },
    storage: { host: '127.0.0.1', port: storagePort },
  },
}, null, 2)}\n`);

const baseEnv = {
  ...process.env,
  FIREBASE_ADMIN_PROJECT_ID: PROJECT_ID,
  FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT_ID }),
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  GCLOUD_PROJECT: PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.firebasestorage.app`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:bsmuat',
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
  NEXT_PUBLIC_LOCAL_UAT: 'true',
  NEXT_PUBLIC_ENABLE_PLATFORM_ONBOARDING: 'false',
  NEXT_DIST_DIR: nextDistDirectory,
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firestorePort}`,
  FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${authPort}`,
  FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${storagePort}`,
  STORAGE_EMULATOR_HOST: `http://127.0.0.1:${storagePort}`,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${authPort}`,
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firestorePort}`,
  NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${storagePort}`,
  BSM_UAT_CREDENTIALS_FILE: credentialsFile,
};
const firebaseEnv = { ...baseEnv, FIRESTORE_EMULATOR_HOST: undefined, FIREBASE_AUTH_EMULATOR_HOST: undefined, FIREBASE_STORAGE_EMULATOR_HOST: undefined, STORAGE_EMULATOR_HOST: undefined };

let firebase;
let nextBuild;
let next;
let playwright;
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  stop(playwright);
  stop(next);
  stop(nextBuild);
  stop(firebase);
  rmSync(tempConfigDirectory, { recursive: true, force: true });
  rmSync(join(ROOT, nextDistDirectory), { recursive: true, force: true });
}
function handleInterrupt(exitCode) {
  cleanup();
  process.exitCode = exitCode;
}
process.once('SIGINT', () => handleInterrupt(130));
process.once('SIGTERM', () => handleInterrupt(143));

try {
  firebase = child('./node_modules/.bin/firebase', ['emulators:start', '--config', firebaseConfigPath, '--project', PROJECT_ID, '--only', 'auth,firestore,storage'], firebaseEnv);
  await Promise.all([waitForPort(authPort), waitForPort(firestorePort), waitForPort(storagePort)]);

  const seed = child(process.execPath, ['scripts/uat/seed-emulator.mjs'], baseEnv);
  await waitForExit(seed, 'UAT seed');
  if (!existsSync(credentialsFile)) throw new Error(`UAT seed did not create ${credentialsFile}.`);
  const fixture = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  if (fixture.projectId !== PROJECT_ID) throw new Error('Generated UAT credentials have an unexpected Firebase project.');

  nextBuild = child('./node_modules/.bin/next', ['build'], baseEnv);
  await waitForExit(nextBuild, 'Local UAT Next.js build');
  next = child('./node_modules/.bin/next', ['start', '--hostname', '127.0.0.1', '--port', String(appPort)], baseEnv);
  await waitForPort(appPort);
  await waitForHttp(appPort, '/');
  playwright = child('./node_modules/.bin/playwright', ['test', '--config=playwright.config.mjs', ...testFiles, ...process.argv.slice(2)], { ...baseEnv, BSM_UAT_BASE_URL: `http://127.0.0.1:${appPort}` });
  await waitForExit(playwright, 'Authenticated UAT');
} finally {
  cleanup();
}
