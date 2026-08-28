/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  doc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { db } from '../firebase';
import { LitigationCase, SyncLog } from '../types';
import { syncCaseToGoogleCalendar } from '../utils/calendarSync';

export interface ScrapedCaseResult {
  id: string; // The 16-character CNR number
  next_hearing_date: string; // Format: YYYY-MM-DD
  case_stage: string; // Case status/stage
  case_title?: string; // Optional updated case title
  court_name?: string; // Optional updated court name
  advocate_notes?: string; // Optional notes to append or update
}

export interface ScraperPayload {
  exporter: string;
  timestamp: string;
  count: number;
  cnrs: string[];
  cases: {
    cnr: string;
    case_title: string;
    client_name: string;
  }[];
}

/**
 * Parses litigation cases from Firestore for a given user and structures
 * an outbound JSON payload containing the 16-character CNR keys ready to interface
 * with the eCourts API synchronization service.
 * 
 * @param userId The UID of the authenticated advocate
 * @returns A structured outbound payload for Python scrapers
 */
export async function prepareScraperPayload(userId: string): Promise<ScraperPayload> {
  const casesPath = 'cases';
  const q = query(collection(db, casesPath), where('user_id', '==', userId));
  const querySnapshot = await getDocs(q);
  
  const cnrs: string[] = [];
  const cases: { cnr: string; case_title: string; client_name: string }[] = [];

  querySnapshot.forEach((document) => {
    const data = document.data() as LitigationCase;
    cnrs.push(data.id);
    cases.push({
      cnr: data.id,
      case_title: data.case_title,
      client_name: data.client_name,
    });
  });

  return {
    exporter: 'ecourts-api-connector',
    timestamp: new Date().toISOString(),
    count: cnrs.length,
    cnrs,
    cases,
  };
}

/**
 * Accepts results from the eCourts API schema, updates the matching
 * Firestore case document, and triggers the Google Calendar 'iCalUID' upsert process smoothly.
 * 
 * @param result The scraped litigation result conforming to the standard schema
 * @param accessToken The optional Google Calendar sync access token
 * @param addLog The callback to log actions to the console/sync-logs
 * @returns A promise resolving to the updated LitigationCase or null if not found
 */
export async function syncScrapedResult(
  result: ScrapedCaseResult,
  accessToken?: string,
  addLog?: (log: SyncLog) => void
): Promise<LitigationCase | null> {
  const cnr = result.id.toUpperCase().trim();
  const logger = addLog || ((log: SyncLog) => console.log(`[${log.status.toUpperCase()}] ${log.message}`));

  if (cnr.length !== 16) {
    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'error',
      message: `Sync rejected: CNR must be exactly 16 characters. Got '${cnr}'`
    });
    return null;
  }

  if (!result.next_hearing_date || !result.case_stage) {
    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'error',
      message: `Sync rejected: Missing standard schema fields (next_hearing_date or case_stage).`
    });
    return null;
  }

  logger({
    timestamp: new Date().toLocaleTimeString(),
    cnr,
    status: 'info',
    message: `Beginning backend synchronization for scraping update...`
  });

  try {
    const caseDocRef = doc(db, 'cases', cnr);
    const caseDocSnap = await getDoc(caseDocRef);

    if (!caseDocSnap.exists()) {
      logger({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'warning',
        message: `No matching record found in Firestore. Ignoring scraper update.`
      });
      return null;
    }

    const existingCase = caseDocSnap.data() as LitigationCase;

    // Build the updated case payload
    const updatedCase: LitigationCase = {
      ...existingCase,
      next_hearing_date: result.next_hearing_date,
      case_stage: result.case_stage,
      last_updated: new Date().toISOString(),
      last_synced: 'Synchronized',
    };

    if (result.case_title) {
      updatedCase.case_title = result.case_title;
    }
    if (result.court_name) {
      updatedCase.court_name = result.court_name;
    }
    if (result.advocate_notes) {
      updatedCase.advocate_notes = result.advocate_notes;
    }

    // Update the document in Firestore
    await updateDoc(caseDocRef, {
      next_hearing_date: updatedCase.next_hearing_date,
      case_stage: updatedCase.case_stage,
      last_updated: updatedCase.last_updated,
      last_synced: 'Synchronized',
      ...(result.case_title ? { case_title: updatedCase.case_title } : {}),
      ...(result.court_name ? { court_name: updatedCase.court_name } : {}),
      ...(result.advocate_notes ? { advocate_notes: updatedCase.advocate_notes } : {}),
    });

    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'success',
      message: `Successfully synchronized eCourts API docket in Firestore database.`
    });

    // Trigger Google Calendar upsert if access token is available
    if (accessToken) {
      logger({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'info',
        message: `Triggering Google Calendar 'iCalUID' upsert process...`
      });
      await syncCaseToGoogleCalendar(updatedCase, accessToken, logger);
    } else {
      logger({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'warning',
        message: `Google Calendar sync skipped: No active OAuth token available.`
      });
    }

    return updatedCase;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'error',
      message: `eCourts API synchronization failed: ${errMsg}`
    });
    return null;
  }
}
