import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectStorageEmulator } from 'firebase/storage';
import { isLocalFirebaseEmulatorMode } from '@/lib/firebase/environment';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

function emulatorEndpoint(value: string | undefined, fallbackHost: string, fallbackPort: number) {
  const rawValue = value?.trim();
  const candidate = rawValue ? (rawValue.includes('://') ? rawValue : `http://${rawValue}`) : `http://${fallbackHost}:${fallbackPort}`;
  try {
    const url = new URL(candidate);
    const port = Number(url.port) || fallbackPort;
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid emulator port.');
    return { host: url.hostname, port };
  } catch {
    return { host: fallbackHost, port: fallbackPort };
  }
}

// Keep direct process.env references so Next.js can inline these public,
// local-only overrides into the browser bundle. Defaults preserve the existing
// emulator behavior for the standard 9099/8080/9199 setup.
const authEmulator = emulatorEndpoint(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1', 9099);
const firestoreEmulator = emulatorEndpoint(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST, '127.0.0.1', 8080);
const storageEmulator = emulatorEndpoint(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1', 9199);

// Emulator connections are browser-only because this module is also imported
// by server-rendered components. The global marker keeps Fast Refresh from
// attempting to connect the same SDK instances twice.
const emulatorConnections = globalThis as typeof globalThis & { __bsmFirebaseEmulatorsConnected?: boolean };
if (typeof window !== 'undefined' && isLocalFirebaseEmulatorMode()) {
  if (!emulatorConnections.__bsmFirebaseEmulatorsConnected) {
    connectAuthEmulator(auth, `http://${authEmulator.host}:${authEmulator.port}`, { disableWarnings: true });
    connectFirestoreEmulator(db, firestoreEmulator.host, firestoreEmulator.port);
    connectStorageEmulator(storage, storageEmulator.host, storageEmulator.port);
    emulatorConnections.__bsmFirebaseEmulatorsConnected = true;
  }
}

export default app;
