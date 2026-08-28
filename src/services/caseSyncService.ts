import { Request, Response } from 'express';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDoc,
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { syncCaseToGoogleCalendar, patchCalendarEventNotes } from '../utils/calendarSync';
import { extractPartyNamesAndTitle } from '../utils/partyExtractor';

// Initialize Firebase App & Firestore Web SDK
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

const ECOURTS_AUTH_HEADER = 'Bearer eci_live_cvr5btg88w6u7r2jzb7wsxy89x3kvmoc';

/**
 * Extracts the best next hearing date from raw API response JSON.
 */
export function extractNextHearingDate(response: any): string {
  const dates: string[] = [];

  const addIfValid = (val: any) => {
    if (!val) return;
    const str = String(val).trim();
    if (!str) return;
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      dates.push(match[1]);
    }
  };

  const data = response?.data || {};
  const courtCaseData = data.courtCaseData || {};
  const entityInfo = data.entityInfo || {};
  const caseData = response?.caseData || data.caseData || {};

  addIfValid(courtCaseData.nextHearingDate);
  addIfValid(courtCaseData.next_hearing_date);
  addIfValid(courtCaseData.nextDateOfHearing);
  addIfValid(entityInfo.nextDateOfHearing);
  addIfValid(entityInfo.next_hearing_date);
  addIfValid(data.nextHearingDate);
  addIfValid(data.nextDateOfHearing);
  addIfValid(caseData.nextHearingDate);
  addIfValid(caseData.next_hearing_date);
  addIfValid(response?.nextHearingDate);
  addIfValid(response?.next_hearing_date);
  addIfValid(response?.nextDateOfHearing);

  const history = courtCaseData.historyOfCaseHearings || data.historyOfCaseHearings || response?.historyOfCaseHearings || [];
  if (Array.isArray(history)) {
    history.forEach((h: any) => {
      if (h && typeof h === 'object') {
        addIfValid(h.hearingDate);
        addIfValid(h.hearing_date);
        addIfValid(h.nextHearingDate);
        addIfValid(h.next_hearing_date);
        addIfValid(h.nextDateOfHearing);
        addIfValid(h.businessOnDate);
        addIfValid(h.purpose);
      }
    });
  }

  const listing = courtCaseData.listingDates || data.listingDates || response?.listingDates || [];
  if (Array.isArray(listing)) {
    listing.forEach((l: any) => {
      if (l && typeof l === 'object') {
        addIfValid(l.date);
        addIfValid(l.hearingDate);
        addIfValid(l.hearing_date);
      } else {
        addIfValid(l);
      }
    });
  }

  if (dates.length === 0) {
    return "Awaiting Schedule";
  }

  dates.sort();
  return dates[dates.length - 1];
}

/**
 * Unified Step 1 Execution Handler for Add Case and Resync Case
 */
export async function initiateCaseSync(cnrNumber: string, metadata: Record<string, any> = {}) {
  const normalizedCnr = String(cnrNumber || '').toUpperCase().trim();
  if (!normalizedCnr || normalizedCnr.length !== 16) {
    throw new Error('CNR must be a valid 16-character string.');
  }

  // 1. Trigger POST request to /refresh endpoint
  const refreshUrl = `https://webapi.ecourtsindia.com/api/partner/case/${normalizedCnr}/refresh`;
  try {
    const refreshRes = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Authorization': ECOURTS_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
    });
    console.log(`[Step 1] Triggered POST /refresh for CNR ${normalizedCnr}, status: ${refreshRes.status}`);
  } catch (err) {
    console.warn(`[Step 1] Refresh trigger warning for CNR ${normalizedCnr}:`, err);
  }

  // 2. Write/Merge Firestore case document with syncStatus: 'refresh_requested' & requestedAt
  try {
    const caseRef = doc(db, 'cases', normalizedCnr);
    
    const payload: Record<string, any> = {
      id: normalizedCnr,
      cnr: normalizedCnr,
      syncStatus: 'refresh_requested',
      requestedAt: serverTimestamp(),
      requestedAtMillis: Date.now(),
      last_updated: new Date().toISOString(),
      last_synced: 'Pending Background Processing',
    };

    if (metadata.user_id) payload.user_id = metadata.user_id;
    if (metadata.client_name) payload.client_name = metadata.client_name;
    if (metadata.case_title) payload.case_title = metadata.case_title;
    if (metadata.court_name) payload.court_name = metadata.court_name;
    if (metadata.case_stage) payload.case_stage = metadata.case_stage;
    if (metadata.advocate_notes) payload.advocate_notes = metadata.advocate_notes;
    if (metadata.googleAccessToken) payload.googleAccessToken = metadata.googleAccessToken;

    await setDoc(caseRef, payload, { merge: true });
  } catch (fsErr) {
    console.warn(`[Step 1] Server Firestore write warning for CNR ${normalizedCnr}:`, fsErr);
  }

  return {
    success: true,
    message: "Case tracking initiated. Latest court data will sync automatically in ~12 minutes."
  };
}

/**
 * Route Handler for Add Case (POST /api/cases/add)
 */
export async function addCaseHandler(req: Request, res: Response) {
  try {
    const cnrNumber = req.body.cnrNumber || req.body.cnr || req.body.id;
    if (!cnrNumber) {
      return res.status(400).json({ error: 'Missing cnrNumber parameter' });
    }

    const result = await initiateCaseSync(cnrNumber, req.body);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Error in addCaseHandler:", error);
    return res.status(500).json({ error: error.message || "Failed to add case" });
  }
}

/**
 * Route Handler for Resync Case (POST /api/cases/resync)
 */
export async function resyncCaseHandler(req: Request, res: Response) {
  try {
    const cnrNumber = req.body.cnrNumber || req.body.cnr || req.body.id;
    if (!cnrNumber) {
      return res.status(400).json({ error: 'Missing cnrNumber parameter' });
    }

    const result = await initiateCaseSync(cnrNumber, req.body);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Error in resyncCaseHandler:", error);
    return res.status(500).json({ error: error.message || "Failed to resync case" });
  }
}

/**
 * Route Handler for Updating Advocate Notes (POST /api/cases/notes)
 * Updates advocate notes in Firestore and immediately patches the Google Calendar event description.
 */
export async function updateCaseNotesHandler(req: Request, res: Response) {
  try {
    const cnrNumber = req.body.cnrNumber || req.body.cnr || req.body.id;
    const advocateNotes = req.body.advocate_notes ?? req.body.notes ?? '';

    if (!cnrNumber) {
      return res.status(400).json({ error: 'Missing cnrNumber parameter' });
    }

    const normalizedCnr = String(cnrNumber).toUpperCase().trim();
    const caseRef = doc(db, 'cases', normalizedCnr);

    // 1. Fetch current case document
    const caseSnap = await getDoc(caseRef);
    if (!caseSnap.exists()) {
      return res.status(404).json({ error: `Case record ${normalizedCnr} not found.` });
    }

    const caseData = caseSnap.data();

    // 2. Update Firestore document with fresh advocate notes
    const updatePayload = {
      advocate_notes: advocateNotes,
      last_updated: new Date().toISOString(),
    };
    await updateDoc(caseRef, updatePayload);

    // 3. Resolve Google OAuth Tokens (from request body, case doc, or user doc)
    let googleAccessToken = req.body.googleAccessToken || caseData.googleAccessToken || caseData.accessToken || caseData.google_access_token;
    let refreshToken = req.body.refreshToken || caseData.refreshToken || caseData.googleRefreshToken || caseData.google_refresh_token;
    const userId = req.body.user_id || caseData.user_id;

    if ((!googleAccessToken || !refreshToken) && userId) {
      try {
        const userDocRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (!googleAccessToken) {
            googleAccessToken = userData.googleAccessToken || userData.accessToken || userData.google_access_token;
          }
          if (!refreshToken) {
            refreshToken = userData.refreshToken || userData.googleRefreshToken || userData.google_refresh_token;
          }
        }
      } catch (uErr) {
        console.warn(`[Update Notes] Could not fetch user doc for ${userId}:`, uErr);
      }
    }

    // 4. Trigger Immediate Google Calendar Event Patch / Sync
    let calendarSynced = false;
    let eventId = caseData.googleEventId;

    if (googleAccessToken || refreshToken) {
      const patchResult = await patchCalendarEventNotes(
        { ...caseData, id: normalizedCnr },
        googleAccessToken,
        advocateNotes,
        refreshToken,
        (log) => console.log(`[Calendar Note Patch] [${normalizedCnr}]: ${log.message}`)
      );

      calendarSynced = patchResult.success;
      if (patchResult.eventId) {
        eventId = patchResult.eventId;
        await updateDoc(caseRef, { googleEventId: eventId });
      }
      if (patchResult.newAccessToken && patchResult.newAccessToken !== googleAccessToken) {
        await updateDoc(caseRef, { googleAccessToken: patchResult.newAccessToken, google_access_token: patchResult.newAccessToken });
        if (userId) {
          try {
            await updateDoc(doc(db, 'users', userId), { googleAccessToken: patchResult.newAccessToken, google_access_token: patchResult.newAccessToken });
          } catch (uUpdateErr) {
            console.warn(`[Update Notes] Failed updating refreshed token in user doc:`, uUpdateErr);
          }
        }
      }
    } else {
      console.warn(`[Update Notes] No Google Access Token or Refresh Token found for CNR ${normalizedCnr}`);
    }

    return res.status(200).json({
      success: true,
      message: calendarSynced 
        ? 'Notes updated in Firestore and synchronized to Google Calendar' 
        : 'Notes updated in Firestore (Google Calendar sync skipped or pending token)',
      cnr: normalizedCnr,
      advocate_notes: advocateNotes,
      calendarSynced,
      googleEventId: eventId || null
    });
  } catch (error: any) {
    console.error('Error in updateCaseNotesHandler:', error);
    return res.status(500).json({ error: error.message || 'Failed to update case notes' });
  }
}

export const updateCaseNotes = updateCaseNotesHandler;

/**
 * Frontend API client function to update case notes via /api/cases/notes
 */
export async function saveCaseNotes(cnrNumber: string, advocateNotes: string, extraData: Record<string, any> = {}) {
  const response = await fetch('/api/cases/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cnrNumber,
      advocate_notes: advocateNotes,
      ...extraData,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to update notes (${response.status}): ${errText}`);
  }

  return await response.json();
}

/**
 * Unified Step 2: Background Polling Worker Function (checkAndFetchUpdatedDetails)
 * Queries Firestore for cases with syncStatus == 'refresh_requested' older than 12 minutes,
 * fetches details, extracts fresh date, updates Firestore & Google Calendar.
 */
export async function checkAndFetchUpdatedDetails(): Promise<number> {
  console.log('[Step 2 Worker] Checking for cases awaiting 12-minute delayed sync...');
  
  try {
    const casesRef = collection(db, 'cases');
    const q = query(casesRef, where('syncStatus', '==', 'refresh_requested'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log('[Step 2 Worker] No cases currently awaiting sync.');
      return 0;
    }

    const now = Date.now();
    const TWELVE_MINUTES_MS = 12 * 60 * 1000;
    let processedCount = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const normalizedCnr = docSnap.id;

      // Check requestedAt timestamp
      let requestedTime = 0;
      if (data.requestedAtMillis) {
        requestedTime = Number(data.requestedAtMillis);
      } else if (data.requestedAt) {
        if (typeof data.requestedAt.toMillis === 'function') {
          requestedTime = data.requestedAt.toMillis();
        } else if (data.requestedAt.seconds) {
          requestedTime = data.requestedAt.seconds * 1000;
        } else {
          requestedTime = new Date(data.requestedAt).getTime();
        }
      }

      if (!requestedTime || isNaN(requestedTime) || requestedTime <= 0) {
        console.log(`[Step 2 Worker] Skipping CNR ${normalizedCnr}: requestedAt timestamp is missing or pending resolution.`);
        continue;
      }

      const elapsed = now - requestedTime;
      if (elapsed < TWELVE_MINUTES_MS) {
        console.log(`[Step 2 Worker] Skipping CNR ${normalizedCnr}: requested ${Math.round(elapsed / 1000 / 60)} mins ago (must be >= 12 mins).`);
        continue;
      }

      console.log(`[Step 2 Worker] Fetching official court details for CNR ${normalizedCnr}...`);

      try {
        const detailsUrl = `https://webapi.ecourtsindia.com/api/partner/case/${normalizedCnr}`;
        const response = await fetch(detailsUrl, {
          method: 'GET',
          headers: {
            'Authorization': ECOURTS_AUTH_HEADER,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        });

        if (!response.ok) {
          console.warn(`[Step 2 Worker] Details endpoint returned status ${response.status} for CNR ${normalizedCnr}`);
          const caseDocRef = doc(db, 'cases', normalizedCnr);
          await updateDoc(caseDocRef, {
            title: 'Fetch Failed (Retry)',
            case_title: 'Fetch Failed (Retry)',
            status: 'failed',
            syncStatus: 'failed',
            last_synced: 'Sync Failed',
            last_updated: new Date().toISOString(),
            updatedAt: new Date()
          });
          continue;
        }

        const rawPayload = await response.json();
        const freshDate = extractNextHearingDate(rawPayload);

        const rawCaseData = rawPayload.data?.courtCaseData || rawPayload.data || rawPayload || {};
        const caseData = (rawCaseData && typeof rawCaseData === 'object') ? rawCaseData : {};

        // Client Name & Case Title Formatting via unified partyExtractor
        const { petitioner_name: petName, respondent_name: resName, case_title: title } = extractPartyNamesAndTitle(rawPayload, data);

        // client_name is a user-provided field. If missing or "pending...", fallback to petitioner name or advocate input
        let clientName = String(data.client_name || '').trim();
        if (!clientName || clientName.toLowerCase().includes('pending')) {
          clientName = petName !== 'Information Unavailable' ? petName : 'Valued Client';
        }

        let caseStage = String(caseData.caseStatus || caseData.case_stage || caseData.purpose || data.case_stage || 'Live Status Active');
        if (caseStage.toLowerCase().includes('pending')) {
          caseStage = 'Live Status Active';
        }

        let courtName = String(caseData.courtName || caseData.court_name || caseData.court_complex || data.court_name || 'District/High Court');
        if (courtName.toLowerCase().includes('pending')) {
          courtName = 'District/High Court';
        }

        const updateData: Record<string, any> = {
          title: title,
          case_title: title,
          petitioner: petName,
          petitioner_name: petName,
          respondent: resName,
          respondent_name: resName,
          next_hearing_date: freshDate,
          case_stage: caseStage,
          court_name: courtName,
          client_name: clientName,
          status: 'synced',
          syncStatus: 'completed',
          last_updated: new Date().toISOString(),
          last_synced: 'Synchronized',
          lastSyncedAt: serverTimestamp(),
          updatedAt: new Date(),
        };

        const caseDocRef = doc(db, 'cases', normalizedCnr);
        await updateDoc(caseDocRef, updateData);
        processedCount++;

        console.log(`[Step 2 Worker] Successfully updated CNR ${normalizedCnr}: Hearing Date = ${freshDate}, Client = ${clientName}, Stage = ${caseStage}`);

        // Google Calendar Token Resolution & User Fallback
        let googleAccessToken = data.googleAccessToken || data.accessToken || data.google_access_token;
        let refreshToken = data.refreshToken || data.googleRefreshToken || data.google_refresh_token;
        const userId = data.user_id;

        // Fallback: If access token missing or user_id present, look up user document
        if ((!googleAccessToken || !refreshToken) && userId) {
          try {
            const userDocRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userDocRef);
            if (userSnap.exists()) {
              const userData = userSnap.data();
              if (!googleAccessToken) {
                googleAccessToken = userData.googleAccessToken || userData.accessToken || userData.google_access_token;
              }
              if (!refreshToken) {
                refreshToken = userData.refreshToken || userData.googleRefreshToken || userData.google_refresh_token;
              }
            }
          } catch (uErr) {
            console.warn(`[Step 2 Worker] Could not fetch user doc for ${userId}:`, uErr);
          }
        }

        // Auto-refresh access token if refresh_token is present
        if (refreshToken) {
          try {
            const tokenParams = new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
            });
            if (process.env.GOOGLE_CLIENT_ID) {
              tokenParams.append('client_id', process.env.GOOGLE_CLIENT_ID);
            }
            if (process.env.GOOGLE_CLIENT_SECRET) {
              tokenParams.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
            }

            const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenParams,
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                googleAccessToken = refreshData.access_token;
                console.log(`[Step 2 Worker] Successfully refreshed access token for user ${userId || 'unknown'}`);
              }
            } else {
              const refreshErrText = await refreshRes.text();
              console.warn(`[Step 2 Worker] Refresh token endpoint returned ${refreshRes.status}: ${refreshErrText}`);
            }
          } catch (rErr) {
            console.error(`[Step 2 Worker] Error calling OAuth2 refresh token endpoint:`, rErr);
          }
        }

        // Google Calendar Integration Execution & Logging
        if (googleAccessToken) {
          console.log(`[Step 2 Worker] Initiating Google Calendar sync for CNR ${normalizedCnr}...`);
          
          const fullCaseObj = {
            id: normalizedCnr,
            case_title: title,
            court_name: courtName,
            next_hearing_date: freshDate,
            case_stage: caseStage,
            client_name: clientName,
            advocate_notes: data.advocate_notes || '',
            last_updated: updateData.last_updated,
            last_synced: 'Synchronized',
            user_id: userId || '',
          };

          const logBuffer: any[] = [];
          const calendarSynced = await syncCaseToGoogleCalendar(
            fullCaseObj as any,
            googleAccessToken,
            (log) => {
              logBuffer.push(log);
              if (log.status === 'error') {
                console.error(`[Step 2 Worker] [Calendar Error] [${normalizedCnr}]: ${log.message}`);
              } else {
                console.log(`[Step 2 Worker] [Calendar Info] [${normalizedCnr}]: ${log.message}`);
              }
            },
            refreshToken
          );

          if (!calendarSynced) {
            console.error(`[Step 2 Worker] Calendar sync failed for CNR ${normalizedCnr}. See logs above for details.`);
          } else {
            console.log(`[Step 2 Worker] Calendar sync completed successfully for CNR ${normalizedCnr}.`);
          }
        } else {
          console.warn(`[Step 2 Worker] Skipped Google Calendar sync for CNR ${normalizedCnr}: No valid Google Access Token found.`);
        }
      } catch (docErr) {
        console.error(`[Step 2 Worker] Error processing doc ${normalizedCnr}:`, docErr);
      }
    }

    return processedCount;
  } catch (err) {
    console.error('[Step 2 Worker] Failed to run checkAndFetchUpdatedDetails worker:', err);
    return 0;
  }
}
