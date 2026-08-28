/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  bar_id: string;
  created_at: string;
}

export interface LitigationCase {
  id: string; // 16-char CNR Number
  user_id: string;
  client_name: string;
  title?: string;
  case_title: string;
  court_name: string;
  next_hearing_date: string; // YYYY-MM-DD
  case_stage: string;
  petitioner?: string;
  petitioner_name?: string;
  respondent?: string;
  respondent_name?: string;
  status?: string;
  syncStatus?: string;
  cause_list_cnr_check?: string;
  advocate_notes: string;
  last_updated: string; // ISO String
  last_synced?: string;
  updatedAt?: any;
}

export interface SyncLog {
  timestamp: string;
  cnr: string;
  status: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
