'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
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
import { requestBootstrapWithOneRefresh } from '@/lib/auth/bootstrap-request';

type AuthStatus = 'loading' | 'signed-out' | 'active' | 'inactive' | 'disabled' | 'error';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  user: AppUser | null;
  status: AuthStatus;
  error: string | null;
  authenticating: boolean;
  signInWithGoogle: () => Promise<void>;
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
  debug?: { stage?: unknown; code?: unknown; message?: unknown; requestId?: unknown };
};

type BootstrapFailure = { status: number; code: string; stage: string; message: string; requestId: string };

async function parseWorkspaceBootstrapResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as BootstrapResponseBody;
  if (response.ok) return;

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

async function requestWorkspaceBootstrap(firebaseUser: FirebaseUser) {
  return parseWorkspaceBootstrapResponse(await requestBootstrapWithOneRefresh(firebaseUser));
}

async function syncUser(firebaseUser: FirebaseUser): Promise<AppUser> {
  startStartupStage('root-user');
  const bootstrapFailure = await requestWorkspaceBootstrap(firebaseUser);
  if (bootstrapFailure) throw new Error('We could not prepare your BSM workspace access yet.');
  const userRef = doc(db, 'users', firebaseUser.uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    throw new Error('Your BSM account profile is not available yet. Please try again.');
  }

  const nextName = firebaseUser.displayName || snapshot.data().name || 'User';
  const nextEmail = firebaseUser.email || snapshot.data().email || '';
  const appUser = getAppUser(firebaseUser, { ...snapshot.data(), name: nextName, displayName: nextName, email: nextEmail });

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

  const completeBootstrap = React.useCallback(async (nextFirebaseUser: FirebaseUser, authEvent: number) => {
    try {
      const nextUser = await syncUser(nextFirebaseUser);
      if (authEvent !== authEventRef.current || auth.currentUser?.uid !== nextFirebaseUser.uid) return;
      setUser(nextUser);
      setStatus(nextUser.accountStatus === 'disabled' ? 'disabled' : nextUser.accountStatus === 'inactive' ? 'inactive' : 'active');
    } catch (syncError) {
      if (authEvent !== authEventRef.current || auth.currentUser?.uid !== nextFirebaseUser.uid) return;
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

      beginStartupTrace(nextFirebaseUser.uid);
      markStartup('auth-ready');
      setStatus('loading');
      await completeBootstrap(nextFirebaseUser, authEvent);
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

  const signOut = () => firebaseSignOut(auth);

  const retryBootstrap = async () => {
    const nextFirebaseUser = auth.currentUser;
    if (!nextFirebaseUser) return;
    const authEvent = ++authEventRef.current;
    setFirebaseUser(nextFirebaseUser);
    setError(null);
    setStatus('loading');
    await completeBootstrap(nextFirebaseUser, authEvent);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, user, status, error, authenticating, signInWithGoogle, signOut, retryBootstrap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
