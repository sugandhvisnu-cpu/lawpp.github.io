import { extractPartyNamesAndTitle } from '../utils/partyExtractor';

export interface LiveCourtDetails {
  next_hearing_date: string;
  case_stage: string;
  case_title?: string;
  court_name?: string;
  petitioner?: string;
  petitioner_name?: string;
  respondent_name?: string;
  cause_list_cnr_check?: string;
}

function extractNextHearingDate(responsePayload: any): string {
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

  const data = responsePayload?.data || {};
  const courtCaseData = data.courtCaseData || {};
  const entityInfo = data.entityInfo || {};
  const caseData = responsePayload?.caseData || data.caseData || {};

  addIfValid(courtCaseData.nextHearingDate);
  addIfValid(courtCaseData.next_hearing_date);
  addIfValid(courtCaseData.nextDateOfHearing);
  addIfValid(entityInfo.nextDateOfHearing);
  addIfValid(entityInfo.next_hearing_date);
  addIfValid(data.nextHearingDate);
  addIfValid(data.nextDateOfHearing);
  addIfValid(caseData.nextHearingDate);
  addIfValid(caseData.next_hearing_date);
  addIfValid(responsePayload?.nextHearingDate);
  addIfValid(responsePayload?.next_hearing_date);
  addIfValid(responsePayload?.nextDateOfHearing);

  const history = courtCaseData.historyOfCaseHearings || data.historyOfCaseHearings || responsePayload?.historyOfCaseHearings || [];
  if (Array.isArray(history)) {
    history.forEach((h: any) => {
      if (h && typeof h === 'object') {
        addIfValid(h.hearingDate);
        addIfValid(h.hearing_date);
        addIfValid(h.nextHearingDate);
        addIfValid(h.next_hearing_date);
        addIfValid(h.nextDateOfHearing);
        addIfValid(h.businessOnDate);
      }
    });
  }

  const listing = courtCaseData.listingDates || data.listingDates || responsePayload?.listingDates || [];
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
    return "Not Scheduled";
  }

  dates.sort();
  return dates[dates.length - 1];
}

export async function addCaseLive(cnrNumber: string, metadata: Record<string, any> = {}) {
  const normalizedCnr = cnrNumber.toUpperCase().trim();
  if (normalizedCnr.length !== 16) {
    throw new Error('Invalid CNR format. Must be exactly 16 characters.');
  }

  const response = await fetch('/api/cases/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ cnrNumber: normalizedCnr, ...metadata })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Add case failed (${response.status}): ${errText}`);
  }

  return await response.json();
}

export async function resyncCaseLive(cnrNumber: string, metadata: Record<string, any> = {}) {
  const normalizedCnr = cnrNumber.toUpperCase().trim();
  if (normalizedCnr.length !== 16) {
    throw new Error('Invalid CNR format. Must be exactly 16 characters.');
  }

  const response = await fetch('/api/cases/resync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ cnrNumber: normalizedCnr, ...metadata })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resync case failed (${response.status}): ${errText}`);
  }

  return await response.json();
}

export async function fetchLiveCourtData(cnrNumber: string): Promise<LiveCourtDetails> {
  const normalizedCnr = cnrNumber.toUpperCase().trim();
  
  if (normalizedCnr.length !== 16) {
    throw new Error('Invalid CNR format. Must be exactly 16 characters.');
  }

  try {
    // Call local /api/sync endpoint (initiates refresh requested step)
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ cnrNumber: normalizedCnr })
    });

    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json();
      return {
        next_hearing_date: data.next_hearing_date || 'Awaiting Schedule (~12m sync)',
        case_stage: data.case_stage || 'Refresh Requested',
        case_title: data.case_title || 'Live Litigation Matter',
        court_name: data.court_name || 'District/High Court',
        petitioner: data.petitioner || 'Not Available',
        petitioner_name: data.petitioner_name || 'Information Unavailable',
        respondent_name: data.respondent_name || 'Information Unavailable',
        cause_list_cnr_check: data.cause_list_cnr_check || 'No'
      };
    }

    console.warn('/api/sync did not return JSON. Attempting direct eCourts API query...');

    // Fallback: Query live eCourts India API directly from client if /api/sync is unreachable
    const upstreamRes = await fetch(`https://webapi.ecourtsindia.com/api/partner/case/${normalizedCnr}?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer eci_live_cvr5btg88w6u7r2jzb7wsxy89x3kvmoc',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!upstreamRes.ok) {
      throw new Error(`eCourts API query failed with status ${upstreamRes.status}`);
    }

    const rawPayload = await upstreamRes.json();
    const rawCaseData = rawPayload.data?.courtCaseData || rawPayload.data || rawPayload || {};
    const caseData = (rawCaseData && typeof rawCaseData === 'object') ? rawCaseData : {};

    const { petitioner_name: petName, respondent_name: resName, case_title: title } = extractPartyNamesAndTitle(rawPayload);

    const nextHearingDate = extractNextHearingDate(rawPayload);

    return {
      next_hearing_date: nextHearingDate,
      case_stage: String(caseData.caseStatus || caseData.case_stage || 'Live Status Active'),
      case_title: title,
      court_name: String(caseData.courtName || caseData.court_name || 'District/High Court'),
      petitioner: petName,
      petitioner_name: petName,
      respondent_name: resName,
      cause_list_cnr_check: String(caseData.cause_list_cnr_check || 'No')
    };

  } catch (error: any) {
    console.error("Live fetch execution failure:", error);
    throw new Error(error?.message || "Unable to fetch live court details. Please check connection.");
  }
}


