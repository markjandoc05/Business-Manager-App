#!/usr/bin/env node

import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';

const projectId = 'demo-bsm-client-app';
const credentialsFile = process.env.BSM_UAT_CREDENTIALS_FILE || '/private/tmp/bsm-uat-credentials.json';
const baseEnv = {
  ...process.env,
  GOOGLE_CLOUD_PROJECT: projectId,
  GCLOUD_PROJECT: projectId,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:000000000000:web:bsmuat',
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
  NEXT_PUBLIC_LOCAL_UAT: 'true',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  BSM_UAT_CREDENTIALS_FILE: credentialsFile,
};

function waitForPort(port, host = '127.0.0.1', timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}.`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function waitForHttp(path, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:3000${path}`);
      if (response.status < 500) return;
    } catch {
      // Next.js may still be compiling the route; retry until the bounded timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for a healthy local UAT route: ${path}.`);
}

function child(command, args, env = baseEnv) {
  const processHandle = spawn(command, args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  processHandle.stdout.on('data', (chunk) => process.stdout.write(chunk));
  processHandle.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return processHandle;
}

const firebase = child('./node_modules/.bin/firebase', ['emulators:start', '--project', projectId, '--only', 'auth,firestore,storage'], {
  ...baseEnv,
  FIRESTORE_EMULATOR_HOST: undefined,
  FIREBASE_AUTH_EMULATOR_HOST: undefined,
  FIREBASE_STORAGE_EMULATOR_HOST: undefined,
  STORAGE_EMULATOR_HOST: undefined,
});
let next;
let smoke;
let nextBuild;
const stop = (processHandle) => { if (processHandle && !processHandle.killed) processHandle.kill('SIGTERM'); };
try {
  await Promise.all([waitForPort(9099), waitForPort(8080), waitForPort(9199)]);
  const seed = child(process.execPath, ['scripts/uat/seed-emulator.mjs']);
  const [seedExit] = await once(seed, 'exit');
  if (seedExit !== 0) throw new Error(`UAT seed exited with code ${seedExit}.`);
  // Use a production Next server after an explicitly demo-project build. This
  // avoids dev-server/HMR races while preserving the real authenticated app
  // shell and its emulator-only browser path.
  nextBuild = child(process.execPath, ['node_modules/next/dist/bin/next', 'build']);
  const [buildExit] = await once(nextBuild, 'exit');
  if (buildExit !== 0) throw new Error(`Local UAT Next build exited with code ${buildExit}.`);
  next = child(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000']);
  await waitForPort(3000);
  // Warm each route before Playwright starts. Next dev can briefly return a
  // transient 500 while compiling an RSC route; this prevents that startup
  // compilation window from being reported as an authentication failure.
  for (const path of ['/','/clients','/sales','/reports']) await waitForHttp(path);
  let smokeExit = 1;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    smoke = child('./node_modules/.bin/playwright', ['test', '--config=playwright.config.mjs'], { ...baseEnv, BSM_UAT_BASE_URL: 'http://127.0.0.1:3000' });
    [smokeExit] = await once(smoke, 'exit');
    if (smokeExit === 0) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (smokeExit !== 0) process.exitCode = smokeExit || 1;
} finally {
  stop(smoke);
  stop(next);
  stop(nextBuild);
  stop(firebase);
}
