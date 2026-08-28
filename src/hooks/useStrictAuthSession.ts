/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { User, onIdTokenChanged } from 'firebase/auth';
import { auth, logout } from '../firebase';

const ONE_HOUR_MS = 60 * 60 * 1000; // Strict 60-minute active session limit

export interface StrictAuthSessionResult {
  isSessionValid: boolean;
  sessionRemainingMs: number | null;
  checkSession: () => Promise<boolean>;
}

/**
 * Custom React hook enforcing strict 1-hour session limits based on user.getIdTokenResult().authTime.
 * - Immediately signs out if current time is > 1 hour past authTime.
 * - Sets an active setTimeout that automatically triggers signOut(auth) and alerts when 1-hour is reached.
 */
export function useStrictAuthSession(
  currentUser: User | null,
  onSessionExpired?: () => void
): StrictAuthSessionResult {
  const [isSessionValid, setIsSessionValid] = useState<boolean>(true);
  const [sessionRemainingMs, setSessionRemainingMs] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const checkSession = useCallback(async (): Promise<boolean> => {
    if (!currentUser) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSessionRemainingMs(null);
      setIsSessionValid(false);
      return false;
    }

    try {
      // Fetch latest ID Token Result to inspect authTime claim
      const tokenResult = await currentUser.getIdTokenResult();
      const authTimeStr = tokenResult.authTime; // ISO timestamp string e.g., "2026-07-30T05:30:00Z"
      const authTimeMs = new Date(authTimeStr).getTime();
      const nowMs = Date.now();
      const elapsedMs = nowMs - authTimeMs;

      if (isNaN(authTimeMs) || elapsedMs >= ONE_HOUR_MS) {
        console.warn(`[Strict Session] 1-Hour Session Limit Exceeded (Elapsed: ${Math.round(elapsedMs / 1000)}s). Enforcing sign out...`);
        setIsSessionValid(false);
        setSessionRemainingMs(0);

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        alert('Session Expired: Your 1-hour security limit has been reached. Please log in again.');
        if (onSessionExpiredRef.current) onSessionExpiredRef.current();
        await logout();
        return false;
      }

      const remainingMs = ONE_HOUR_MS - elapsedMs;
      setIsSessionValid(true);
      setSessionRemainingMs(remainingMs);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Active timer to automatically trigger sign out when 1-hour mark is reached while app is open
      timerRef.current = setTimeout(async () => {
        console.warn('[Strict Session] Active 1-Hour Timer Fired. Auto-signing out advocate...');
        setIsSessionValid(false);
        setSessionRemainingMs(0);
        alert('Security Alert: Your 1-hour active session limit has been reached. You have been automatically logged out.');
        if (onSessionExpiredRef.current) onSessionExpiredRef.current();
        await logout();
      }, remainingMs);

      return true;
    } catch (error) {
      console.error('[Strict Session] Error evaluating user.getIdTokenResult():', error);
      return false;
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSessionRemainingMs(null);
      setIsSessionValid(false);
      return;
    }

    checkSession();

    // Listen to token changes / periodic checks
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      if (!user) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setIsSessionValid(false);
        setSessionRemainingMs(null);
      } else {
        checkSession();
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [currentUser?.uid, checkSession]);

  return { isSessionValid, sessionRemainingMs, checkSession };
}
