'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { createSignInController } from '@/lib/auth/signInController';
import type { AppUser, UserRole } from '@/types/auth';
import { beginStartupTrace, finishStartupStage, markStartup, startStartupStage } from '@/lib/startupTiming';
import { clearCachedRequests } from '@/lib/repositories/requestCache';
import { requestBootstrapWithOneRefresh, type BootstrapRequestDiagnostics } from '@/lib/auth/bootstrap-request';
import { isLocalFirebaseEmulatorMode } from '@/lib/firebase/environment';

type AuthStatus = 'loading' | 'signed-out' | 'active' | 'inactive' | 'disabled' | 'error';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  user: AppUser | null;
  status: AuthStatus;
  error: string | null;
  authenticating: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithLocalUat: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const googleProvider = new GoogleAuthProvider();

function getAppUser(firebaseUser: FirebaseUser, data: Record<string, unknown>): AppUser {
  const role = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER'
    ? data.role
    : 'USER';

  const accountStatus = data.status === 'disabled' ? 'disabled' : data.status === 'inactive' ? 'inactive' : data.status === 'active' || data.active === true ? 'active' : 'pending';

  return {
    uid: firebaseUser.uid,
    name: typeof data.displayName === 'string' ? data.displayName : typeof data.name === 'string' ? data.name : firebaseUser.displayName || 'User',
    email: typeof data.email === 'string' ? data.email : firebaseUser.email || '',
    role: role as UserRole,
    active: data.active === true,
    accountStatus,
  };
}

type BootstrapResponseBody = {
  code?: unknown;
  error?: unknown;
  data?: { profile?: Record<string, unknown> };
  debug?: { stage?: unknown; code?: unknown; message?: unknown; requestId?: unknown };
};

type BootstrapFailure = { status: number; code: string; stage: string; message: string; requestId: string };

async function parseWorkspaceBootstrapResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as BootstrapResponseBody;
  if (response.ok) return body;

  const failure: BootstrapFailure = {
    status: response.status,
    code: typeof body.debug?.code === 'string' ? body.debug.code : typeof body.code === 'string' ? body.code : 'BOOTSTRAP_FAILED',
    stage: typeof body.debug?.stage === 'string' ? body.debug.stage : 'unknown',
    message: typeof body.debug?.message === 'string' ? body.debug.message : typeof body.error === 'string' ? body.error : 'Workspace bootstrap failed.',
    requestId: typeof body.debug?.requestId === 'string' ? body.debug.requestId : response.headers.get('x-bootstrap-request-id') || 'unknown',
  };
  if (process.env.NODE_ENV !== 'production') console.warn(`[workspace-bootstrap] status=${failure.status} stage=${failure.stage} code=${failure.code} requestId=${failure.requestId} message=${failure.message}`);
  return failure;
}

async function requestWorkspaceBootstrap(firebaseUser: FirebaseUser, diagnostics: BootstrapRequestDiagnostics) {
  return parseWorkspaceBootstrapResponse(await requestBootstrapWithOneRefresh(firebaseUser, fetch, diagnostics));
}

async function syncUser(firebaseUser: FirebaseUser, diagnostics: BootstrapRequestDiagnostics): Promise<AppUser> {
  startStartupStage('root-user');
  const bootstrapResult = await requestWorkspaceBootstrap(firebaseUser, diagnostics);
  if (!bootstrapResult || 'status' in bootstrapResult) throw new Error('We could not prepare your BSM workspace access yet.');
  const userRef = doc(db, 'users', firebaseUser.uid);
  let profileData = bootstrapResult.data?.profile;

  // Older/self-hosted API responses may not include the transaction profile;
  // retain the scoped Firestore fallback for compatibility.
  if (!profileData) {
    const snapshot = await getDoc(userRef);
    if (!snapshot.exists()) {
      throw new Error('Your BSM account profile is not available yet. Please try again.');
    }
    profileData = snapshot.data();
  }

  const nextName = firebaseUser.displayName || profileData.name || 'User';
  const nextEmail = firebaseUser.email || (typeof profileData.email === 'string' ? profileData.email : '');
  const appUser = getAppUser(firebaseUser, { ...profileData, name: nextName, displayName: nextName, email: nextEmail });

  // Do not make app-shell rendering wait for the audit write.
  void updateDoc(userRef, {
    uid: firebaseUser.uid,
    name: nextName,
    email: nextEmail,
    displayName: nextName,
    photoURL: firebaseUser.photoURL || '',
    status: appUser.accountStatus,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[auth-profile] unable to update login metadata message=${message}`);
  });

  markStartup('root-user-complete');
  return appUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const lastAuthUidRef = useRef<string | null>(null);
  const authEventRef = useRef(0);
  const bootstrapInFlightRef = useRef<{ uid: string; promise: Promise<AppUser> } | null>(null);

  const completeBootstrap = React.useCallback(async (nextFirebaseUser: FirebaseUser, diagnostics: BootstrapRequestDiagnostics) => {
    let bootstrapPromise = bootstrapInFlightRef.current?.uid === nextFirebaseUser.uid
      ? bootstrapInFlightRef.current.promise
      : null;
    if (!bootstrapPromise) {
      bootstrapPromise = syncUser(nextFirebaseUser, diagnostics);
      bootstrapInFlightRef.current = { uid: nextFirebaseUser.uid, promise: bootstrapPromise };
      // Clear only the request that this invocation owns. A second auth-state
      // callback for the same UID can safely reuse the promise (React Strict
      // Mode and Firebase persistence can both emit an initial repeat).
      bootstrapPromise.then(
        () => { if (bootstrapInFlightRef.current?.promise === bootstrapPromise) bootstrapInFlightRef.current = null; },
        () => { if (bootstrapInFlightRef.current?.promise === bootstrapPromise) bootstrapInFlightRef.current = null; },
      );
    }
    try {
      const nextUser = await bootstrapPromise;
      if (diagnostics.authEvent !== authEventRef.current || auth.currentUser?.uid !== nextFirebaseUser.uid) return;
      setUser(nextUser);
      setStatus(nextUser.accountStatus === 'disabled' ? 'disabled' : nextUser.accountStatus === 'inactive' ? 'inactive' : 'active');
    } catch (syncError) {
      if (diagnostics.authEvent !== authEventRef.current || auth.currentUser?.uid !== nextFirebaseUser.uid) return;
      const message = syncError instanceof Error ? syncError.message : 'Unknown bootstrap error';
      if (process.env.NODE_ENV !== 'production') console.warn(`[auth-bootstrap] handled failure message=${message}`);
      setUser(null);
      setStatus('error');
      setError("We couldn't prepare your workspace access. Please try again.");
    } finally {
      finishStartupStage('root-user');
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextFirebaseUser) => {
      const authEvent = ++authEventRef.current;
      const previousUid = lastAuthUidRef.current;
      setFirebaseUser(nextFirebaseUser);
      setError(null);
      // Do not retain display/startup data across an auth boundary.
      const nextUid = nextFirebaseUser?.uid || null;
      if (lastAuthUidRef.current !== nextUid) clearCachedRequests();
      lastAuthUidRef.current = nextUid;

      if (!nextFirebaseUser) {
        setUser(null);
        setStatus('signed-out');
        return;
      }

      const diagnostics: BootstrapRequestDiagnostics = {
        trigger: authEvent === 1
          ? 'auth-state-initial'
          : previousUid === nextFirebaseUser.uid
            ? 'auth-state-repeat'
            : 'auth-state-user-change',
        authEvent,
      };
      beginStartupTrace(nextFirebaseUser.uid);
      markStartup('auth-ready');
      setStatus('loading');
      await completeBootstrap(nextFirebaseUser, diagnostics);
    });
  }, [completeBootstrap]);

  const signInController = useMemo(() => createSignInController({
      signInWithPopup: async () => { await signInWithPopup(auth, googleProvider); },
      hasCurrentUser: () => Boolean(auth.currentUser),
      setAuthenticating,
      clearError: () => setError(null),
      setError,
      logError: (signInError) => console.error('Google sign-in failed', signInError),
    }), []);

  const signInWithGoogle = async () => {
    beginStartupTrace();
    await signInController.signIn();
  };

  const signInWithLocalUat = async (email: string, password: string) => {
    if (!isLocalFirebaseEmulatorMode()) throw new Error('Local UAT sign-in is unavailable.');
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) throw new Error('Enter the local UAT email and password.');
    setError(null);
    setAuthenticating(true);
    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch {
      setError('Local UAT sign-in failed. Check the supplied credentials.');
      throw new Error('Local UAT sign-in failed.');
    } finally {
      setAuthenticating(false);
    }
  };

  const signOut = () => firebaseSignOut(auth);

  const retryBootstrap = async () => {
    const nextFirebaseUser = auth.currentUser;
    if (!nextFirebaseUser) return;
    const authEvent = ++authEventRef.current;
    setFirebaseUser(nextFirebaseUser);
    setError(null);
    setStatus('loading');
    await completeBootstrap(nextFirebaseUser, { trigger: 'manual-retry', authEvent });
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, user, status, error, authenticating, signInWithGoogle, signInWithLocalUat, signOut, retryBootstrap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
