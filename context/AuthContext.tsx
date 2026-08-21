'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import type { AppUser, UserRole } from '@/types/auth';

type AuthStatus = 'loading' | 'signed-out' | 'pending' | 'active' | 'error';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  user: AppUser | null;
  status: AuthStatus;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const googleProvider = new GoogleAuthProvider();

function getAppUser(firebaseUser: FirebaseUser, data: Record<string, unknown>): AppUser {
  const role = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER'
    ? data.role
    : 'USER';

  return {
    uid: firebaseUser.uid,
    name: typeof data.name === 'string' ? data.name : firebaseUser.displayName || 'User',
    email: typeof data.email === 'string' ? data.email : firebaseUser.email || '',
    role: role as UserRole,
    active: data.active === true,
  };
}

async function syncUser(firebaseUser: FirebaseUser): Promise<AppUser> {
  const userRef = doc(db, 'users', firebaseUser.uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    const name = firebaseUser.displayName || 'User';
    const email = firebaseUser.email || '';
    await setDoc(userRef, {
      name,
      email,
      role: 'USER',
      active: false,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    });
    return { uid: firebaseUser.uid, name, email, role: 'USER', active: false };
  }

  const nextName = firebaseUser.displayName || snapshot.data().name || 'User';
  const nextEmail = firebaseUser.email || snapshot.data().email || '';
  const appUser = getAppUser(firebaseUser, { ...snapshot.data(), name: nextName, email: nextEmail });

  // Do not make app-shell rendering wait for the audit write.
  void updateDoc(userRef, {
    name: nextName,
    email: nextEmail,
    lastLogin: serverTimestamp(),
  }).catch((error) => console.error('Unable to update user login metadata', error));

  return appUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextFirebaseUser) => {
      setFirebaseUser(nextFirebaseUser);
      setError(null);

      if (!nextFirebaseUser) {
        setUser(null);
        setStatus('signed-out');
        return;
      }

      setStatus('loading');
      try {
        const nextUser = await syncUser(nextFirebaseUser);
        setUser(nextUser);
        setStatus(nextUser.active ? 'active' : 'pending');
      } catch (syncError) {
        console.error('Unable to load the authenticated Firestore user', syncError);
        setUser(null);
        setStatus('error');
        setError('We could not load your account. Please try again.');
      }
    });
  }, []);

  const signInWithGoogle = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (signInError) {
      if ((signInError as { code?: string }).code === 'auth/popup-closed-by-user') return;
      console.error('Google sign-in failed', signInError);
      setError('Google sign-in failed. Please try again.');
    }
  };

  const signOut = () => firebaseSignOut(auth);

  return (
    <AuthContext.Provider value={{ firebaseUser, user, status, error, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
