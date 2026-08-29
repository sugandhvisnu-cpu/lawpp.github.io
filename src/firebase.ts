import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  signOut as fbSignOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

// Your existing Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "lawppog.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "lawppog",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "lawppog.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/calendar');

export enum OperationType {
  GET = 'GET',
  LIST = 'LIST',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE'
}

export function handleFirestoreError(error: unknown, op: OperationType, path: string) {
  console.error(`Firestore error [${op}] on ${path}:`, error);
}

export async function googleSignIn() {
  if (Capacitor.isNativePlatform()) {
    const googleUser = await GoogleAuth.signIn();
    return {
      user: auth.currentUser!,
      accessToken: googleUser.authentication.accessToken
    };
  } else {
    const isMobileBrowser = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileBrowser) {
      await signInWithRedirect(auth, provider);
      return null;
    } else {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      return {
        user: result.user,
        accessToken: credential?.accessToken || null
      };
    }
  }
}

export async function checkRedirectResult() {
  if (!Capacitor.isNativePlatform()) {
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        return {
          user: result.user,
          accessToken: credential?.accessToken || null
        };
      }
    } catch (error) {
      console.error("Redirect login resolution error:", error);
    }
  }
  return null;
}

export function initAuth(
  onUser: (user: User, token: string | null) => void,
  onSignedOut: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onUser(user, null);
    } else {
      onSignedOut();
    }
  });
}

export async function logout() {
  await fbSignOut(auth);
}

export function getAccessToken(): string | null {
  return null;
}
