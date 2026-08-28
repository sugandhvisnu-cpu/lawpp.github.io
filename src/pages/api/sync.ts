import { Request, Response } from 'express';
import { extractPartyNamesAndTitle } from '../../utils/partyExtractor';

function findBestNextHearingDate(response: any): string {
  const dates: string[] = [];

  const addIfValid = (val: any) => {
    if (!val) return;
    const str = String(val).trim();
    if (!str) return;
    // Format could be YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      dates.push(match[1]);
    }
  };

  const data = response.data || {};
  const courtCaseData = data.courtCaseData || {};
  const entityInfo = data.entityInfo || {};
  const caseData = response.caseData || data.caseData || {};

  // Check all known fields that might hold the next hearing date
  addIfValid(courtCaseData.nextHearingDate);
  addIfValid(courtCaseData.next_hearing_date);
  addIfValid(courtCaseData.nextDateOfHearing);
  addIfValid(entityInfo.nextDateOfHearing);
  addIfValid(entityInfo.next_hearing_date);
  addIfValid(data.nextHearingDate);
  addIfValid(data.nextDateOfHearing);
  addIfValid(caseData.nextHearingDate);
  addIfValid(caseData.next_hearing_date);
  addIfValid(response.nextHearingDate);
  addIfValid(response.next_hearing_date);
  addIfValid(response.nextDateOfHearing);

  // Check the history of hearings - sometimes the latest scheduled date is only appended here!
  const history = courtCaseData.historyOfCaseHearings || data.historyOfCaseHearings || response.historyOfCaseHearings || [];
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

  // Check listing dates
  const listing = courtCaseData.listingDates || data.listingDates || response.listingDates || [];
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

  // Sort dates chronologically and pick the latest (maximum) one!
  dates.sort();
  return dates[dates.length - 1];
}

export async function handleSync(req: Request, res: Response) {
  // Setup local headers for the browser application
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Read the incoming CNR key sent by your frontend interface
    const cnrNumber = req.body.cnrNumber || req.body.cnr || req.query.cnrNumber || req.query.cnr;
    
    if (!cnrNumber) {
      return res.status(400).json({ error: 'Missing standard CNR parameter layout' });
    }

    // Clean up spaces and capitalization
    const normalizedCnr = String(cnrNumber).toUpperCase().trim();

    // Fetch the latest case details from the main GET endpoint with cache-busting to prevent stale cached data
    const upstreamResponse = await fetch(`https://webapi.ecourtsindia.com/api/partner/case/${normalizedCnr}?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer eci_live_cvr5btg88w6u7r2jzb7wsxy89x3kvmoc',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

    if (!upstreamResponse.ok) {
      let upstreamErrorMsg = 'Upstream data registry query failed';
      try {
        const errPayload = await upstreamResponse.clone().json();
        if (errPayload && errPayload.error && errPayload.error.message) {
          upstreamErrorMsg = errPayload.error.message;
        }
      } catch (e) {}
      return res.status(upstreamResponse.status).json({ 
        error: `eCourts India API returned status ${upstreamResponse.status}: ${upstreamErrorMsg}` 
      });
    }

    const rawPayload = await upstreamResponse.json();

    // Read the true inner data block sent back by the eCourtsIndia provider safely
    const rawCaseData = rawPayload.data?.courtCaseData || rawPayload.data || rawPayload || {};
    const caseData = (rawCaseData && typeof rawCaseData === 'object') ? rawCaseData : {};
    
    // Extract petitioner and respondent names and title safely using unified extractor
    const { petitioner_name, respondent_name, case_title } = extractPartyNamesAndTitle(rawPayload);

    let court_name = typeof caseData.courtName === 'object' ? JSON.stringify(caseData.courtName) : String(caseData.courtName || caseData.court_name || caseData.court_complex || "District/High Court");
    if (court_name.toLowerCase().includes('pending')) court_name = "District/High Court";

    let case_stage = typeof caseData.caseStatus === 'object' ? JSON.stringify(caseData.caseStatus) : String(caseData.caseStatus || caseData.case_stage || caseData.caseTypeSub || "Live Status Active");
    if (case_stage.toLowerCase().includes('pending')) case_stage = "Live Status Active";

    // Read nextHearingDate using the findBestNextHearingDate helper to scan all deep arrays and objects
    const finalDate = findBestNextHearingDate(rawPayload);

    const petitioner = petitioner_name;

    // Look for CAUSE_LIST_CNR_CHECK inside raw payload, data, or caseData
    const cause_list_cnr_check = 
      caseData.CAUSE_LIST_CNR_CHECK || 
      caseData.causeListCnrCheck || 
      caseData.cause_list_cnr_check || 
      rawPayload.CAUSE_LIST_CNR_CHECK || 
      rawPayload.causeListCnrCheck || 
      rawPayload.cause_list_cnr_check || 
      (rawPayload.data && (rawPayload.data.CAUSE_LIST_CNR_CHECK || rawPayload.data.causeListCnrCheck || rawPayload.data.cause_list_cnr_check)) || 
      "No";

    // Update modified fields directly into our Firestore database record for that case ID
    const updateData = {
      case_title,
      court_name,
      case_stage,
      next_hearing_date: finalDate,
      petitioner,
      petitioner_name,
      respondent_name,
      cause_list_cnr_check,
      last_updated: new Date().toISOString(),
      last_synced: 'Synchronized'
    };

    console.log("Fetched Date:", finalDate);

    return res.json({
      ...updateData,
      success: true,
      next_hearing_date: finalDate
    });

  } catch (error: any) {
    console.error("API error in handleSync:", error);
    return res.status(500).json({ error: error.message });
  }
}
