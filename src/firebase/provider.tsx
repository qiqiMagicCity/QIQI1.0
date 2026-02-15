'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth, User, onIdTokenChanged, getIdTokenResult } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener'
import { toNyHmsString } from '@/lib/ny-time';

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

// Internal state for user authentication
interface UserAuthState {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
  claims: Record<string, unknown> | null;
  isAdmin: boolean;
  impersonatedUid: string | null; // [NEW] Impersonation Support
  authTimeout: boolean; // [NEW]
}

// Combined state for the Firebase context
export interface FirebaseContextState {
  areServicesAvailable: boolean; // True if core services (app, firestore, auth instance) are provided
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null; // The Auth service instance
  // User authentication state
  user: User | null;
  isUserLoading: boolean; // True during initial auth check
  userError: Error | null; // Error from auth listener
  claims: Record<string, unknown> | null;
  isAdmin: boolean;
  impersonatedUid: string | null; // [NEW]
  impersonateUser: (uid: string | null) => void; // [NEW]
  authTimeout: boolean; // [NEW]
}

// Return type for useFirebase()
export interface FirebaseServicesAndUser {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
  claims: Record<string, unknown> | null;
  isAdmin: boolean;
  impersonatedUid: string | null; // [NEW]
  impersonateUser: (uid: string | null) => void; // [NEW]
  authTimeout: boolean; // [NEW]
}

// Return type for useUser() - specific to user auth state
export interface UserHookResult {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
  claims: Record<string, unknown> | null;
  isAdmin: boolean;
  impersonatedUid: string | null; // [NEW]
  impersonateUser: (uid: string | null) => void; // [NEW]
  authTimeout: boolean; // [NEW]
}

// [NEW] Hardcoded Admin Emails (Temporary)
const ADMIN_EMAILS = [
  'qiqi_MagicCity@outlook.com',
];

// React Context
export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

/**
 * FirebaseProvider manages and provides Firebase services and user authentication state.
 */
export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    user: null,
    isUserLoading: true, // Start loading until first auth event
    userError: null,
    claims: null,
    isAdmin: false,
    impersonatedUid: null,
    authTimeout: false,
  });

  // [NEW] Persist impersonation state (optional, for refresh convenience)
  useEffect(() => {
    // Only load from session if we are actually admin (handled in effect below)
    // but we can't check admin yet.
    // Actually, let's just keep it simple: Reset on refresh to be safe, 
    // OR use sessionStorage to persist across hot-reloads.
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem('impersonatedUid') : null;
    if (stored) {
      setUserAuthState(prev => ({ ...prev, impersonatedUid: stored }));
    }
  }, []);

  const handleImpersonate = (uid: string | null) => {
    if (uid) {
      sessionStorage.setItem('impersonatedUid', uid);
    } else {
      sessionStorage.removeItem('impersonatedUid');
    }
    // [CRITICAL] 强制刷新页面以重置 Firestore 客户端状态。
    // 使用 setTimeout 给 UI 一点时间处理状态变化（如关闭 Dialog），避免白屏
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };


  // Effect to subscribe to Firebase auth state changes
  useEffect(() => {
    if (!auth) { // If no Auth service instance, cannot determine user state
      setUserAuthState({ user: null, isUserLoading: false, userError: new Error("Auth service not provided."), claims: null, isAdmin: false, impersonatedUid: null, authTimeout: false });
      return;
    }

    // [FIX] Read stored ID immediately to prevent race condition wiping it
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem('impersonatedUid') : null;

    // Reset on auth instance change, but PRESERVE stored impersonation ID
    setUserAuthState({
      user: null,
      isUserLoading: true,
      userError: null,
      claims: null,
      isAdmin: false,
      impersonatedUid: stored,
      authTimeout: false
    });

    const unsubscribe = onIdTokenChanged(
      auth,
      async (firebaseUser) => { // Auth state determined
        if (firebaseUser) {
          try {
            const result = await getIdTokenResult(firebaseUser);
            const claims = (result.claims as Record<string, unknown>) || null;
            // [MODIFIED] Helper check (Case Insensitive)
            const emailIsAdmin = firebaseUser.email && ADMIN_EMAILS.some(e => e.toLowerCase() === firebaseUser.email?.toLowerCase());
            const isAdmin = claims?.admin === true || !!emailIsAdmin;

            setUserAuthState(prev => ({
              ...prev,
              user: firebaseUser,
              claims,
              isAdmin,
              isUserLoading: false,
              userError: null,
              authTimeout: false // Reset on success
            }));
          } catch (error) {
            console.warn("FirebaseProvider: Error getting ID token result:", error);
            setUserAuthState(prev => ({ ...prev, user: firebaseUser, claims: null, isAdmin: false, isUserLoading: false, userError: error as Error, authTimeout: false }));
          }
        } else {
          // User is signed out.
          setUserAuthState({ user: null, claims: null, isAdmin: false, isUserLoading: false, userError: null, impersonatedUid: null, authTimeout: false });
        }
      },
      (error) => { // Auth listener error
        console.error("FirebaseProvider: onIdTokenChanged error:", error);
        setUserAuthState({ user: null, claims: null, isAdmin: false, isUserLoading: false, userError: error, impersonatedUid: null, authTimeout: false });
      }
    );
    return () => unsubscribe(); // Cleanup
  }, [auth]); // Depends on the auth instance

  // Effect to handle slow auth (Guardrail 2) & Safety Valve
  useEffect(() => {
    const startTime = Date.now();
    console.log(`[AuthAudit] 🕒 Timer started at ${toNyHmsString(startTime)}`);

    // Level 1: Warn user after 3s (Interaction available)
    const warnTimer = setTimeout(() => {
      setUserAuthState((prev) => {
        if (prev.isUserLoading) {
          console.warn(`[AuthAudit] ⚠️ Auth Slow Warning (3s)`);
          return { ...prev, authTimeout: true };
        }
        return prev;
      });
    }, 3000);

    // Level 2: Force Fail after 8s (Unblock App)
    const forceFailTimer = setTimeout(() => {
      setUserAuthState((prev) => {
        if (prev.isUserLoading) {
          console.error(`[AuthAudit] 🚨 Auth Critical Timeout (8s) - Forcing Unblock`);
          return {
            ...prev,
            isUserLoading: false,
            user: null,
            userError: new Error("Authentication timed out (Safety Valve)"),
            authTimeout: true
          };
        }
        return prev;
      });
    }, 8000);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(forceFailTimer);
    };
  }, []);

  // Memoize the context value
  const contextValue = useMemo((): FirebaseContextState => {
    const servicesAvailable = !!(firebaseApp && firestore && auth);
    return {
      areServicesAvailable: servicesAvailable,
      firebaseApp: servicesAvailable ? firebaseApp : null,
      firestore: servicesAvailable ? firestore : null,
      auth: servicesAvailable ? auth : null,
      // user prop is below
      user: userAuthState.user, // [REVERTED] Always use real Auth User (Admin)
      isUserLoading: userAuthState.isUserLoading,
      claims: userAuthState.claims,
      isAdmin: userAuthState.isAdmin,
      impersonatedUid: userAuthState.impersonatedUid,
      impersonateUser: handleImpersonate,
      userError: userAuthState.userError,
      authTimeout: userAuthState.authTimeout,
    };
  }, [firebaseApp, firestore, auth, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

/**
 * Hook to access core Firebase services and user authentication state.
 * Throws error if core services are not available or used outside provider.
 */
export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }

  if (!context.areServicesAvailable || !context.firebaseApp || !context.firestore || !context.auth) {
    throw new Error('Firebase core services not available. Check FirebaseProvider props.');
  }

  return {
    firebaseApp: context.firebaseApp,
    firestore: context.firestore,
    auth: context.auth,
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
    claims: context.claims,
    isAdmin: context.isAdmin,
    impersonatedUid: context.impersonatedUid,
    impersonateUser: context.impersonateUser,
    authTimeout: context.authTimeout,
  };
};

/** Hook to access Firebase Auth instance. */
export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

/** Hook to access Firestore instance. */
export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

/** Hook to access Firebase App instance. */
export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

type MemoFirebase<T> = T & { __memo?: boolean };

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T | (MemoFirebase<T>) {
  const memoized = useMemo(factory, deps);

  if (typeof memoized !== 'object' || memoized === null) return memoized;
  (memoized as MemoFirebase<T>).__memo = true;

  return memoized;
}

/**
 * Hook specifically for accessing the authenticated user's state.
 * This provides the User object, loading status, and any auth errors.
 * @returns {UserHookResult} Object with user, isUserLoading, userError.
 */
export const useUser = (): UserHookResult => {
  const { user, isUserLoading, userError, claims, isAdmin, impersonatedUid, impersonateUser, authTimeout } = useFirebase();
  return { user, isUserLoading, userError, claims, isAdmin, impersonatedUid, impersonateUser, authTimeout };
};
