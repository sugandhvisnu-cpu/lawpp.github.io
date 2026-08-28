/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { initializeAuth, getAuth, browserSessionPersistence, browserPopupRedirectResolver, inMemoryPersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Safe checking of firebase configuration
const isValidConfig = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId;

if (!isValidConfig) {
  console.warn("Firebase configuration is incomplete or missing. Falling back to empty configuration to prevent startup crash.");
}

const safeConfig = isValidConfig ? {
  ...firebaseConfig,
  authDomain: "fair-station-hxhgq.firebaseapp.com"
} : {
  apiKey: "MOCK_KEY_FALLBACK",
  authDomain: "fair-station-hxhgq.firebaseapp.com",
  projectId: "mock-project",
  storageBucket: "mock-bucket.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:mock1234"
};

// Initialize Firebase App
export const app = initializeApp(safeConfig);

// Initialize Firestore with explicit Database ID and optional long polling for iframe compatibility
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, (safeConfig as any).firestoreDatabaseId || '(default)');

// Initialize Auth with browserSessionPersistence in browser, and inMemoryPersistence / getAuth in server Node environment
export const auth = typeof window !== 'undefined'
  ? initializeAuth(app, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    })
  : getAuth(app);
