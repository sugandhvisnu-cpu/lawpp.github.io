/**
 * Helper to construct the display title for litigation cases.
 * Safely extracts party names (petitioner vs. respondent) falling back to case title or status.
 */

import { LitigationCase } from '../types';

export function getCaseDisplayTitle(c: LitigationCase): string {
  const pet = c.petitioner_name || c.petitioner;
  const res = c.respondent_name || c.respondent;

  const cleanP = pet && !pet.toLowerCase().includes('pending') && pet !== 'Information Unavailable' && pet !== 'Not Available' ? pet.trim() : '';
  const cleanR = res && !res.toLowerCase().includes('pending') && res !== 'Information Unavailable' && res !== 'Not Available' ? res.trim() : '';

  if (cleanP && cleanR) {
    return `${cleanP} v. ${cleanR}`;
  }
  if (cleanP) {
    return `${cleanP} v. Respondent`;
  }
  if (cleanR) {
    return `Petitioner v. ${cleanR}`;
  }

  const candidateTitle = c.title || c.case_title;
  if (
    candidateTitle &&
    !candidateTitle.toLowerCase().includes('pending') &&
    candidateTitle !== 'Live Litigation Matter' &&
    candidateTitle !== 'Pending Sync'
  ) {
    return candidateTitle;
  }

  if (c.status === 'failed' || c.syncStatus === 'failed' || c.last_synced === 'Sync Failed') {
    return 'Fetch Failed (Retry)';
  }

  if (c.last_synced === 'Pending Background Processing' || c.syncStatus === 'refresh_requested') {
    return 'Pending Sync...';
  }

  return candidateTitle || 'Pending Sync...';
}
