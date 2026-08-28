/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LitigationCase, SyncLog } from '../types';
import { getFreshAccessToken } from '../firebase';

/**
 * Refreshes an expired Google OAuth access token using a refresh token.
 */
export async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  if (!refreshToken) return null;
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

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams,
    });

    if (res.ok) {
      const data = await res.json();
      return data.access_token || null;
    } else {
      console.warn(`[OAuth Refresh] Token endpoint status ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('[OAuth Refresh] Error refreshing token:', err);
  }
  return null;
}

/**
 * Directly patches or inserts the Google Calendar event description when advocate notes are updated.
 */
export async function patchCalendarEventNotes(
  caseData: any,
  accessToken: string,
  newNotes: string,
  refreshToken?: string,
  addLog?: (log: SyncLog) => void
): Promise<{ success: boolean; eventId?: string; newAccessToken?: string; isUnauthorized?: boolean }> {
  const logger = addLog || ((log: SyncLog) => console.log(`[${log.status.toUpperCase()}] ${log.message}`));
  const cnr = String(caseData.id || caseData.cnr || '').toUpperCase().trim();
  const nextHearingDate = caseData.next_hearing_date || caseData.nextHearingDate;

  // Guard against invalid dates
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!nextHearingDate || !dateRegex.test(nextHearingDate)) {
    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'info',
      message: `Calendar notes patch skipped: No valid upcoming hearing date scheduled (${nextHearingDate || 'Awaiting Schedule'})`
    });
    return { success: true };
  }

  let activeToken = accessToken;

  const executePatch = async (token: string): Promise<{ success: boolean; eventId?: string }> => {
    let eventId = caseData.googleEventId || caseData.eventId;

    if (!eventId) {
      // Query Google Calendar API for event matching CNR
      const listUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(cnr)}&showDeleted=false`;
      const listRes = await fetch(listUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (listRes.status === 401) {
        throw new Error('UNAUTHORIZED_TOKEN');
      }

      if (!listRes.ok) {
        const errText = await listRes.text();
        throw new Error(`Calendar List Query Failed (${listRes.status}): ${errText}`);
      }

      const listData = await listRes.json();
      const items: any[] = listData.items || [];
      const matched = items.find((evt: any) => {
        if (evt.status === 'cancelled') return false;
        const startDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.substring(0, 10) : '');
        const summary = evt.summary || '';
        const description = evt.description || '';
        const iCalUID = evt.iCalUID || '';
        return (
          startDate === nextHearingDate &&
          (summary.toUpperCase().includes(cnr) || description.toUpperCase().includes(cnr) || iCalUID.toUpperCase().includes(cnr))
        );
      });

      if (matched) {
        eventId = matched.id;
      }
    }

    const startDateStr = nextHearingDate;
    const startDateObj = new Date(startDateStr);
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endDateStr = endDateObj.toISOString().split('T')[0];

    const title = caseData.case_title || caseData.title || `${caseData.petitioner_name || 'Petitioner'} vs. ${caseData.respondent_name || 'Respondent'}`;
    const stage = caseData.case_stage || caseData.stage || 'Live Litigation';
    const courtName = caseData.court_name || 'District Court';
    const clientName = caseData.client_name || '';

    const formattedDescription = 
      `--- LAWPPORTFOLIO LITIGATION RECORD ---\n` +
      `CNR Number: ${cnr}\n` +
      `Client Reference: ${clientName}\n` +
      `Courtroom: ${courtName}\n` +
      `Current Case Stage: ${stage}\n\n` +
      `ADVOCATE NOTES & SUBMISSIONS BRIEF:\n` +
      `${newNotes}\n\n` +
      `Last Synced: ${new Date().toLocaleString()}\n` +
      `---\n` +
      `Maintained securely via Lawpp terminal.`;

    if (eventId) {
      // Event exists -> PATCH request
      const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: formattedDescription,
          summary: `⚖️ Lawpp: ${title}`,
          location: courtName,
        }),
      });

      if (patchRes.status === 401) {
        throw new Error('UNAUTHORIZED_TOKEN');
      }

      if (!patchRes.ok) {
        const patchErrText = await patchRes.text();
        throw new Error(`Calendar PATCH event failed (${patchRes.status}): ${patchErrText}`);
      }

      const patchedData = await patchRes.json();
      logger({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'success',
        message: `Successfully patched Google Calendar event (${eventId}) with updated advocate notes.`
      });

      return { success: true, eventId: patchedData.id || eventId };
    } else {
      // Event does NOT exist -> INSERT request
      const insertUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
      const insertRes = await fetch(insertUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: `⚖️ Lawpp: ${title}`,
          location: courtName,
          description: formattedDescription,
          start: { date: startDateStr },
          end: { date: endDateStr },
          colorId: '5',
        }),
      });

      if (insertRes.status === 401) {
        throw new Error('UNAUTHORIZED_TOKEN');
      }

      if (!insertRes.ok) {
        const insertErrText = await insertRes.text();
        throw new Error(`Calendar INSERT event failed (${insertRes.status}): ${insertErrText}`);
      }

      const newEvent = await insertRes.json();
      logger({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'success',
        message: `Successfully created new Google Calendar event (${newEvent.id}) with advocate notes.`
      });

      return { success: true, eventId: newEvent.id };
    }
  };

  try {
    if (!activeToken) {
      const freshToken = await getFreshAccessToken();
      if (freshToken) activeToken = freshToken;
    }

    if (!activeToken && refreshToken) {
      const refreshed = await refreshGoogleToken(refreshToken);
      if (refreshed) activeToken = refreshed;
    }

    if (!activeToken) {
      throw new Error('No valid Google Access Token available for Calendar sync.');
    }

    try {
      const res = await executePatch(activeToken);
      return { ...res, newAccessToken: activeToken };
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED_TOKEN' && refreshToken) {
        logger({
          timestamp: new Date().toLocaleTimeString(),
          cnr,
          status: 'info',
          message: 'Access token expired during calendar patch. Attempting token refresh...'
        });
        const refreshed = await refreshGoogleToken(refreshToken);
        if (refreshed) {
          activeToken = refreshed;
          const res = await executePatch(activeToken);
          return { ...res, newAccessToken: activeToken };
        }
      }
      throw err;
    }
  } catch (error: any) {
    const isUnauth = error.message === 'UNAUTHORIZED_TOKEN' || String(error).includes('401');
    logger({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'error',
      message: isUnauth
        ? `patchCalendarEventNotes: Google OAuth access token is invalid or expired (re-authentication required).`
        : `patchCalendarEventNotes failed: ${error.message || String(error)}`
    });
    return { success: false, isUnauthorized: isUnauth };
  }
}

/**
 * Syncs a single litigation case to the advocate's Google Calendar.
 * Cross-references the 16-character CNR number against Google Calendar's 'iCalUID' property.
 * Overwrites existing events if found to prevent duplication (System Processing Law).
 */
export async function syncCaseToGoogleCalendar(
  caseData: LitigationCase,
  accessToken: string,
  addLog: (log: SyncLog) => void,
  refreshToken?: string
): Promise<boolean> {
  const cnr = caseData.id.toUpperCase();

  // Guard against invalid or un-scheduled dates
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!caseData.next_hearing_date || !dateRegex.test(caseData.next_hearing_date)) {
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'info',
      message: `Calendar sync skipped: no valid upcoming hearing date scheduled (${caseData.next_hearing_date || 'Awaiting Schedule'})`
    });
    return true;
  }

  addLog({
    timestamp: new Date().toLocaleTimeString(),
    cnr,
    status: 'info',
    message: `Starting Google Calendar sync for matter: ${cnr}`
  });

  let activeToken = accessToken;

  const performSync = async (token: string): Promise<boolean> => {
    // Step 1: Query Google Calendar API for existing active events for this case (CNR)
    const listUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(cnr)}&showDeleted=false`;
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (listResponse.status === 401) {
      throw new Error('UNAUTHORIZED_TOKEN');
    }

    if (!listResponse.ok) {
      const errText = await listResponse.text();
      throw new Error(`Calendar List Query Failed: ${listResponse.statusText} (${errText})`);
    }

    const listData = await listResponse.json();
    const allItems: any[] = listData.items || [];

    // Filter to active, non-cancelled events belonging to this CNR
    const matchedEvents = allItems.filter((evt: any) => {
      if (evt.status === 'cancelled') return false;
      const summary = evt.summary || '';
      const description = evt.description || '';
      const iCalUID = evt.iCalUID || '';
      return (
        summary.toUpperCase().includes(cnr) ||
        description.toUpperCase().includes(cnr) ||
        iCalUID.toUpperCase().includes(cnr)
      );
    });

    const getEventStartDate = (evt: any): string => {
      const startObj = evt.start || {};
      if (startObj.date) return startObj.date;
      if (startObj.dateTime) return startObj.dateTime.substring(0, 10);
      return '';
    };

    const existingSameDateEvent = matchedEvents.find(
      (evt) => getEventStartDate(evt) === caseData.next_hearing_date
    );

    // For a proper 1-day all-day event in Google Calendar, the end date is exclusive (the day after the start date)
    const startDateStr = caseData.next_hearing_date;
    const startDateObj = new Date(startDateStr);
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endDateStr = endDateObj.toISOString().split('T')[0];

    // Prepare calendar event payload
    const eventBody = {
      summary: `⚖️ Lawpp: ${caseData.case_title}`,
      location: caseData.court_name,
      description: `--- LAWPPORTFOLIO LITIGATION RECORD ---\n` +
                   `CNR Number: ${caseData.id}\n` +
                   `Client Reference: ${caseData.client_name || ''}\n` +
                   `Courtroom: ${caseData.court_name}\n` +
                   `Current Case Stage: ${caseData.case_stage}\n\n` +
                   `ADVOCATE NOTES & SUBMISSIONS BRIEF:\n` +
                   `${caseData.advocate_notes || ''}\n\n` +
                   `Last Synced: ${new Date().toLocaleString()}\n` +
                   `---\n` +
                   `Maintained securely via Lawpp terminal.`,
      start: {
        date: startDateStr,
      },
      end: {
        date: endDateStr,
      },
      colorId: '5', // Yellow/Gold calendar theme identifier
    };

    if (existingSameDateEvent) {
      // Event for this specific date already exists. Do NOT add a new event to prevent duplicate creation.
      // Update existing event details in-place to keep notes/stage updated.
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'info',
        message: `Calendar entry for date ${caseData.next_hearing_date} already exists. Updating details...`
      });

      const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingSameDateEvent.id}`;
      const patchResponse = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      });

      if (patchResponse.status === 401) {
        throw new Error('UNAUTHORIZED_TOKEN');
      }

      if (!patchResponse.ok) {
        console.warn('Calendar PATCH failed:', await patchResponse.text());
      } else {
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr,
          status: 'success',
          message: `Calendar entry for date ${caseData.next_hearing_date} verified and updated (no duplicate added).`
        });
      }
    } else {
      // Event doesn't exist for this date - insert a new calendar event
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'info',
        message: `New hearing date discovered (${caseData.next_hearing_date}). Creating new calendar event...`
      });

      const insertUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
      const insertResponse = await fetch(insertUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      });

      if (insertResponse.status === 401) {
        throw new Error('UNAUTHORIZED_TOKEN');
      }

      if (!insertResponse.ok) {
        const errText = await insertResponse.text();
        throw new Error(`Calendar INSERT failed: ${insertResponse.statusText} (${errText})`);
      }

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'success',
        message: `Successfully created and added new litigation event for ${caseData.next_hearing_date}.`
      });
    }

    // Step 2: Clean up any old/past scheduled events for this case that are on other dates due to rescheduling
    const oldEvents = matchedEvents.filter(
      (evt) => getEventStartDate(evt) !== caseData.next_hearing_date
    );

    for (const oldEvt of oldEvents) {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr,
        status: 'info',
        message: `Cleaning up obsolete rescheduled calendar event for date: ${getEventStartDate(oldEvt) || 'Unknown'}`
      });

      const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${oldEvt.id}`;
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    return true;
  };

  try {
    if (!activeToken) {
      const freshToken = await getFreshAccessToken();
      if (freshToken) activeToken = freshToken;
    }

    if (!activeToken && refreshToken) {
      const refreshed = await refreshGoogleToken(refreshToken);
      if (refreshed) activeToken = refreshed;
    }

    if (!activeToken) {
      throw new Error('Google Calendar access token is missing or invalid.');
    }

    try {
      return await performSync(activeToken);
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED_TOKEN' && refreshToken) {
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr,
          status: 'info',
          message: 'Google Calendar token expired. Attempting refresh token fallback...'
        });
        const refreshed = await refreshGoogleToken(refreshToken);
        if (refreshed) {
          activeToken = refreshed;
          return await performSync(activeToken);
        }
      }
      throw err;
    }
  } catch (error) {
    const isUnauth = error instanceof Error && (error.message === 'UNAUTHORIZED_TOKEN' || error.message.includes('401'));
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr,
      status: 'error',
      message: isUnauth
        ? `Calendar sync paused: Google OAuth token expired or invalid (re-authentication required).`
        : `Calendar sync failed: ${error instanceof Error ? error.message : String(error)}`
    });
    return false;
  }
}
