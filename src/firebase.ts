/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  setPersistence,
  browserSessionPersistence,
  User 
} from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { app, db, auth } from './lib/firebase';

export { app, db, auth };

// Enforce browserSessionPersistence for strict tab/window close session control
if (typeof window !== 'undefined') {
  setPersistence(auth, browserSessionPersistence).catch((err) => {
    console.warn('[Firebase Auth] Failed to apply browserSessionPersistence:', err);
  });
}

// Test Firestore database connection on boot (Pillar Connection mandate)
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// OAuth Scope list for Google Calendar sync
export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

// Memory cache for Google OAuth Access Token
let cachedAccessToken: string | null = null;
let isSigningIn = false;

/**
 * Custom enum for operation types in Firestore error reporting.
 */
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Structured error information conforming to the Firebase integration skill's requirements.
 */
export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

/**
 * Core error handler for all Firestore operations.
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Initializes authentication listener using browserSessionPersistence. Sets up token cache on sign-out.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  // Check for any redirect sign-in result on initialization
  getRedirectResult(auth)
    .then((result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
          sessionStorage.setItem(`lawpp_google_access_token_${result.user.uid}`, cachedAccessToken);
          if (auth.currentUser && onAuthSuccess) {
            onAuthSuccess(auth.currentUser, cachedAccessToken);
          }
        }
      }
    })
    .catch((error) => {
      if (error && error.code !== 'auth/argument-error') {
        console.error('Error during getRedirectResult on load:', error);
      }
    });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // 1. Try memory cache first
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
        return;
      }

      // 2. Try tab-scoped sessionStorage next (cleared automatically on tab/window close)
      const sessionToken = sessionStorage.getItem(`lawpp_google_access_token_${user.uid}`);
      if (sessionToken) {
        cachedAccessToken = sessionToken;
        if (onAuthSuccess) onAuthSuccess(user, sessionToken);
        return;
      }

      // 3. Fallback: Fetch directly from secure Firestore document if not in session storage
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDocFromServer(userDocRef);
        if (userSnap.exists()) {
          const dbToken = userSnap.data()?.google_access_token || userSnap.data()?.googleAccessToken;
          if (dbToken) {
            cachedAccessToken = dbToken;
            sessionStorage.setItem(`lawpp_google_access_token_${user.uid}`, dbToken);
            if (onAuthSuccess) onAuthSuccess(user, dbToken);
            return;
          }
        }
      } catch (dbErr) {
        console.warn('Error reading token from Firestore during boot check:', dbErr);
      }

      // 4. Try redirect result
      if (!isSigningIn) {
        try {
          const redirectResult = await getRedirectResult(auth);
          if (redirectResult) {
            const credential = GoogleAuthProvider.credentialFromResult(redirectResult);
            if (credential?.accessToken) {
              cachedAccessToken = credential.accessToken;
              sessionStorage.setItem(`lawpp_google_access_token_${user.uid}`, cachedAccessToken);
              if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
              return;
            }
          }
        } catch (err: any) {
          if (err && err.code !== 'auth/argument-error') {
            console.error('getRedirectResult inside auth state change failed:', err);
          }
        }
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Signs in the advocate using official Google Sign-In with popup or redirect.
 * Configured with browserSessionPersistence for strict tab/window close session enforcement.
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    await setPersistence(auth, browserSessionPersistence);
    const provider = new GoogleAuthProvider();
    OAUTH_SCOPES.forEach(scope => provider.addScope(scope));
    
    // Explicitly pass custom auth domain context parameters
    provider.setCustomParameters({
      prompt: 'select_account',
      auth_domain: 'fair-station-hxhgq.firebaseapp.com'
    });
    
    try {
      // Standard Firebase Auth Popup Login
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (!credential?.accessToken) {
        throw new Error('Failed to extract Google Access Token. Please verify permissions.');
      }

      cachedAccessToken = credential.accessToken;
      sessionStorage.setItem(`lawpp_google_access_token_${result.user.uid}`, cachedAccessToken);
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (popupError: any) {
      console.warn('Popup login failed or was blocked. Falling back to signInWithRedirect...', popupError);
      // Fall back to redirect if popup is blocked, closed, or restricted inside an iframe environment
      await signInWithRedirect(auth, provider);
      return null;
    }
  } catch (error) {
    console.error('Advocate Auth Flow Failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Gets currently active Google OAuth Access Token.
 */
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Validates and refreshes current Firebase user session using user.getIdToken(true),
 * returning the active Google OAuth Access Token for Google Calendar operations.
 */
export const getFreshAccessToken = async (): Promise<string | null> => {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  try {
    // Force refresh Firebase ID token to ensure active user session within 1-hour window
    await currentUser.getIdToken(true);
  } catch (err) {
    console.warn('[getFreshAccessToken] Firebase ID token refresh warning:', err);
  }

  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  const sessionToken = sessionStorage.getItem(`lawpp_google_access_token_${currentUser.uid}`);
  if (sessionToken) {
    cachedAccessToken = sessionToken;
    return sessionToken;
  }

  try {
    const userDocRef = doc(db, 'users', currentUser.uid);
    const userSnap = await getDocFromServer(userDocRef);
    if (userSnap.exists()) {
      const dbToken = userSnap.data()?.google_access_token || userSnap.data()?.googleAccessToken;
      if (dbToken) {
        cachedAccessToken = dbToken;
        sessionStorage.setItem(`lawpp_google_access_token_${currentUser.uid}`, dbToken);
        return dbToken;
      }
    }
  } catch (dbErr) {
    console.warn('[getFreshAccessToken] Failed reading token from Firestore:', dbErr);
  }

  return null;
};

/**
 * Signs out the currently authenticated advocate and clears session memory/caches.
 */
export const logout = async () => {
  const currentUid = auth.currentUser?.uid;
  await auth.signOut();
  cachedAccessToken = null;
  if (currentUid) {
    sessionStorage.removeItem(`lawpp_google_access_token_${currentUid}`);
    localStorage.removeItem(`lawpp_google_access_token_${currentUid}`);
  }
};
