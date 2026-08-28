/**
 * Unified party name and case title extractor for eCourts India API responses.
 * Ensures petitioner and respondent names and case title are extracted safely,
 * stripping out "Pending..." or placeholder states.
 */

export interface ExtractedPartyInfo {
  petitioner_name: string;
  respondent_name: string;
  case_title: string;
}

export function extractPartyNamesAndTitle(rawPayload: any, existingDocData: Record<string, any> = {}): ExtractedPartyInfo {
  const data = rawPayload?.data || {};
  const courtCaseData = data.courtCaseData || {};
  const entityInfo = data.entityInfo || {};
  const rawCaseData = courtCaseData.caseDetails || courtCaseData || data || rawPayload || {};
  const caseData = (typeof rawCaseData === 'object' && rawCaseData) ? rawCaseData : {};

  // Helper to sanitize individual string fields
  const sanitize = (val: any): string => {
    if (!val || typeof val === 'object') return '';
    let str = String(val).replace(/\s+and\s+Advocate.*/i, '').trim();
    if (
      !str ||
      str.toLowerCase().includes('pending') ||
      str.toLowerCase().includes('information unavailable') ||
      str.toLowerCase() === 'null' ||
      str.toLowerCase() === 'undefined'
    ) {
      return '';
    }
    return str;
  };

  // 1. Extract Petitioner Name
  let petRaw = '';
  if (caseData.petTopic || caseData.petitoner || caseData.petitioner || caseData.petitioner_name || caseData.petitionerName) {
    petRaw = String(caseData.petTopic || caseData.petitoner || caseData.petitioner || caseData.petitioner_name || caseData.petitionerName);
  } else if (Array.isArray(caseData.petitioners) && caseData.petitioners.length > 0) {
    const firstP = caseData.petitioners[0];
    petRaw = typeof firstP === 'object' ? String(firstP.name || firstP.petitioner_name || firstP.partyName || '') : String(firstP);
  } else if (Array.isArray(data.petitioners) && data.petitioners.length > 0) {
    const firstP = data.petitioners[0];
    petRaw = typeof firstP === 'object' ? String(firstP.name || firstP.petitioner_name || firstP.partyName || '') : String(firstP);
  } else if (caseData.petitonerAndAdvocate || caseData.petitionerAndAdvocate) {
    petRaw = String(caseData.petitonerAndAdvocate || caseData.petitionerAndAdvocate).split(/\s+and\s+Advocate/i)[0];
  } else {
    petRaw = String(
      caseData.petName ||
      caseData.pet_name ||
      caseData.petName1 ||
      caseData.petDetails ||
      caseData.pet_details ||
      caseData.petitionerName ||
      caseData.pet_and_adv ||
      caseData.pet_and_adv_name ||
      caseData.pet_adv ||
      caseData.petNameRaw ||
      caseData.pet_name_raw ||
      caseData.plaintiff ||
      entityInfo.petitioner ||
      entityInfo.petitioner_name ||
      data.petitioner_name ||
      data.petitioner ||
      existingDocData.petitioner_name ||
      existingDocData.petitioner ||
      ''
    );
  }

  // 2. Extract Respondent Name
  let resRaw = '';
  if (caseData.resName || caseData.respondent || caseData.respondent_name || caseData.res_name || caseData.respondentName) {
    resRaw = String(caseData.resName || caseData.respondent || caseData.respondent_name || caseData.res_name || caseData.respondentName);
  } else if (Array.isArray(caseData.respondents) && caseData.respondents.length > 0) {
    const firstR = caseData.respondents[0];
    resRaw = typeof firstR === 'object' ? String(firstR.name || firstR.respondent_name || firstR.partyName || '') : String(firstR);
  } else if (Array.isArray(data.respondents) && data.respondents.length > 0) {
    const firstR = data.respondents[0];
    resRaw = typeof firstR === 'object' ? String(firstR.name || firstR.respondent_name || firstR.partyName || '') : String(firstR);
  } else if (caseData.respondentAndAdvocate || caseData.resAndAdvocate) {
    resRaw = String(caseData.respondentAndAdvocate || caseData.resAndAdvocate).split(/\s+and\s+Advocate/i)[0];
  } else {
    resRaw = String(
      caseData.resName1 ||
      caseData.resDetails ||
      caseData.res_details ||
      caseData.respondentName ||
      caseData.res_and_adv ||
      caseData.res_and_adv_name ||
      caseData.res_adv ||
      caseData.resNameRaw ||
      caseData.res_name_raw ||
      caseData.defendant ||
      entityInfo.respondent ||
      entityInfo.respondent_name ||
      data.respondent_name ||
      data.respondent ||
      existingDocData.respondent_name ||
      existingDocData.respondent ||
      ''
    );
  }

  // If petitioner or respondent is empty, try extracting from partyName or party_name
  const partyNameStr = caseData.partyName || caseData.party_name || data.partyName || data.party_name || rawPayload.partyName || rawPayload.party_name;
  if ((!petRaw || !resRaw) && partyNameStr && typeof partyNameStr === 'string') {
    const parts = partyNameStr.split(/\s+(?:vs\.?|v\.?|versus)\s+/i);
    if (parts.length >= 2) {
      if (!petRaw) petRaw = parts[0].trim();
      if (!resRaw) resRaw = parts[1].trim();
    }
  }

  let cleanPet = sanitize(petRaw);
  let cleanRes = sanitize(resRaw);

  const finalPet = cleanPet || "Information Unavailable";
  const finalRes = cleanRes || "Information Unavailable";

  // 3. Extract or Construct Case Title
  let explicitTitle = '';
  const rawTitle =
    caseData.caseTitle ||
    caseData.case_title ||
    caseData.partyName ||
    caseData.party_name ||
    caseData.caseName ||
    caseData.title ||
    caseData.caseNumber ||
    entityInfo.caseTitle ||
    data.caseTitle ||
    data.case_title;

  if (rawTitle && typeof rawTitle !== 'object') {
    const tStr = String(rawTitle).trim();
    if (tStr && !tStr.toLowerCase().includes('pending') && tStr.toLowerCase() !== 'live litigation matter') {
      explicitTitle = tStr;
    }
  }

  let finalTitle = '';
  if (cleanPet && cleanRes) {
    finalTitle = `${cleanPet} v. ${cleanRes}`;
  } else if (explicitTitle) {
    finalTitle = explicitTitle;
  } else if (cleanPet) {
    finalTitle = `${cleanPet} v. Respondent`;
  } else if (cleanRes) {
    finalTitle = `Petitioner v. ${cleanRes}`;
  } else {
    finalTitle = "Live Litigation Matter";
  }

  return {
    petitioner_name: finalPet,
    respondent_name: finalRes,
    case_title: finalTitle,
  };
}
