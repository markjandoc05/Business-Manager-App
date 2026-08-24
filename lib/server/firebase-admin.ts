import 'server-only';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { assertFirebaseProject } from './firebase-project';

let app = getApps()[0];
let auth: ReturnType<typeof getAuth> | undefined;
let db: ReturnType<typeof getFirestore> | undefined;
let storage: ReturnType<typeof getStorage> | undefined;

function getAdminApp() {
  const identity = assertFirebaseProject();
  app ??= initializeApp({ projectId: identity.projectId, credential: applicationDefault() });
  return app;
}

function getAdminAuth() {
  auth ??= getAuth(getAdminApp());
  return auth;
}

function getAdminDb() {
  db ??= getFirestore(getAdminApp());
  return db;
}

function getAdminStorage() {
  storage ??= getStorage(getAdminApp());
  return storage;
}

export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, property) {
    const value = getAdminAuth()[property as keyof ReturnType<typeof getAuth>];
    return typeof value === 'function' ? value.bind(getAdminAuth()) : value;
  },
});

export const adminDb = new Proxy({} as ReturnType<typeof getFirestore>, {
  get(_target, property) {
    const value = getAdminDb()[property as keyof ReturnType<typeof getFirestore>];
    return typeof value === 'function' ? value.bind(getAdminDb()) : value;
  },
});

export function adminStorageBucket() {
  const identity = assertFirebaseProject();
  return getAdminStorage().bucket(`${identity.projectId}.firebasestorage.app`);
}
