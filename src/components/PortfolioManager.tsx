/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Search, 
  AlertTriangle, 
  Sparkles, 
  Scale, 
  Calendar, 
  RefreshCw,
  ExternalLink,
  MapPin,
  CheckCircle,
  HelpCircle,
  Download,
  Upload,
  Terminal,
  Copy,
  FileCode
} from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { LitigationCase, SyncLog } from '../types';
import { addCaseLive, resyncCaseLive, fetchLiveCourtData } from '../services/courtApi';
import { syncCaseToGoogleCalendar } from '../utils/calendarSync';
import { getCaseDisplayTitle } from '../utils/caseDisplay';

interface PortfolioManagerProps {
  cases: LitigationCase[];
  setCases: React.Dispatch<React.SetStateAction<LitigationCase[]>>;
  refreshCases: () => Promise<void>;
  userId: string;
  accessToken: string | null;
  addLog: (log: SyncLog) => void;
}

export default function PortfolioManager({ 
  cases, 
  setCases,
  refreshCases, 
  userId, 
  accessToken, 
  addLog 
}: PortfolioManagerProps) {
  const [cnr, setCnr] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Local validation of CNR Number
  const validateCnr = (input: string): string | null => {
    const trimmed = input.trim();
    if (trimmed.length !== 16) {
      return 'CNR Number must be exactly 16 characters long.';
    }
    const alphanumeric = /^[a-zA-Z0-9]+$/;
    if (!alphanumeric.test(trimmed)) {
      return 'CNR Number must be purely alphanumeric (no spaces or special symbols).';
    }
    return null;
  };

  // Add Case Submit
  const handleAddCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg({ type: '', text: '' });

    // Validate CNR number
    const validationError = validateCnr(cnr);
    if (validationError) {
      setStatusMsg({ type: 'error', text: validationError });
      return;
    }

    // Validate Client name
    if (!clientName.trim()) {
      setStatusMsg({ type: 'error', text: 'Please specify an Internal Client Name or Tags.' });
      return;
    }

    const uppercaseCnr = cnr.toUpperCase().trim();

    // Check if CNR is already tracked
    if (cases.some(c => c.id === uppercaseCnr)) {
      setStatusMsg({ type: 'error', text: `Matter ${uppercaseCnr} is already in your tracked portfolio.` });
      return;
    }

    if (!auth.currentUser) {
      setStatusMsg({ type: 'error', text: 'You must be fully authenticated via Google Sign-In to track cases.' });
      alert("Please sign in with Google first to add and track cases on your secure litigation terminal.");
      return;
    }

    setIsSubmitting(true);
    setStatusMsg({ type: 'success', text: 'Registering matter and preparing live eCourtsIndia docket sync...' });

    try {
      // Prepare exact requested case structure with Pending state
      const caseData = {
        id: uppercaseCnr,
        user_id: auth.currentUser.uid || userId, // Ensure this exact key matches our rules
        client_name: clientName.trim(),
        case_title: "Pending Sync",
        court_name: "Pending Sync",
        next_hearing_date: "Pending Sync",
        case_stage: "Pending Sync",
        advocate_notes: "",
        syncStatus: 'refresh_requested',
        requestedAtMillis: Date.now(),
        googleAccessToken: accessToken || '',
        last_updated: new Date().toISOString(),
        last_synced: 'Pending Background Processing'
      };

      console.log("Current Authenticated User right before Firestore setDoc write:", auth.currentUser);

      // Save directly to the advocate's portfolio in Firestore
      const caseDocRef = doc(db, 'cases', uppercaseCnr);
      await setDoc(caseDocRef, caseData);

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: uppercaseCnr,
        status: 'success',
        message: `Registered new litigation portfolio case matching CNR: ${uppercaseCnr}`
      });

      // Fetch refreshed database list (shows the syncing row spinner immediately)
      await refreshCases();

      setStatusMsg({ type: 'success', text: 'Case tracking initiated. Latest court data will sync automatically in ~12 minutes.' });

      try {
        const liveRes = await addCaseLive(uppercaseCnr, {
          user_id: auth.currentUser?.uid || userId,
          client_name: clientName.trim(),
          case_title: "Pending Sync",
          court_name: "Pending Sync",
          advocate_notes: "",
          googleAccessToken: accessToken
        });
        
        await refreshCases();

        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: uppercaseCnr,
          status: 'success',
          message: liveRes.message || `Case tracking initiated for ${uppercaseCnr}. Auto-syncing in ~12 minutes.`
        });

        setStatusMsg({ type: 'success', text: liveRes.message || 'Case tracking initiated (~12m delayed sync)' });
      } catch (apiErr) {
        const apiErrMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.error("Live court API initiation failed:", apiErr);
        
        await setDoc(caseDocRef, {
          last_synced: 'Sync Failed',
          advocate_notes: `Sync initiation failed: ${apiErrMsg}`
        }, { merge: true });

        await refreshCases();

        setStatusMsg({ type: 'error', text: `Sync initiation failed: ${apiErrMsg}` });
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: uppercaseCnr,
          status: 'error',
          message: `Live sync failed: ${apiErrMsg}`
        });
      }

      // Reset Form fields
      setCnr('');
      setClientName('');
      setTimeout(() => setStatusMsg({ type: '', text: '' }), 6000);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setStatusMsg({ type: 'error', text: `Failed to commit litigation case to Firestore database: ${errMsg}` });
      handleFirestoreError(error, OperationType.CREATE, `cases/${uppercaseCnr}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete/Archive Case (removes the case record from Lawpp and primary Firestore collection)
  const handleDeleteCase = async (c: LitigationCase) => {
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: c.id,
      status: 'info',
      message: `De-registering case from advocate portfolio...`
    });

    try {
      // 1. Delete Firestore Document
      await deleteDoc(doc(db, "cases", c.id));

      // Immediately update local frontend state to remove the row from the advocate's screen
      setCases(prev => prev.filter(item => item.id !== c.id));

      // 2. Clear Google Calendar event if authenticated
      if (accessToken) {
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: c.id,
          status: 'info',
          message: `Locating Google Calendar event for purging...`
        });

        const listUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?iCalUID=${c.id}`;
        const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (listRes.ok) {
          const listData = await listRes.json();
          const existingEvents = listData.items || [];
          const matchedEvent = existingEvents.find((evt: any) => evt.iCalUID === c.id || evt.id === c.id.toLowerCase());
          if (matchedEvent) {
            const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${matchedEvent.id}`;
            const delRes = await fetch(deleteUrl, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (delRes.ok) {
              addLog({
                timestamp: new Date().toLocaleTimeString(),
                cnr: c.id,
                status: 'success',
                message: `Purged synced calendar event from calendar feed.`
              });
            }
          }
        }
      }

      await refreshCases();
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: c.id,
        status: 'success',
        message: `Case successfully de-registered and archived.`
      });
    } catch (error) {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: c.id,
        status: 'error',
        message: `Error archiving case: ${error instanceof Error ? error.message : String(error)}`
      });
      handleFirestoreError(error, OperationType.DELETE, `cases/${c.id}`);
    }
  };

  // Manual Trigger for Individual Case Live Sync and Google Calendar Sync
  const handleSingleSync = async (c: LitigationCase) => {
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: c.id,
      status: 'info',
      message: `Triggering manual resync via eCourts refresh endpoint...`
    });

    try {
      const res = await resyncCaseLive(c.id, {
        googleAccessToken: accessToken,
        user_id: c.user_id,
        client_name: c.client_name,
        case_title: c.case_title,
        court_name: c.court_name,
        advocate_notes: c.advocate_notes
      });

      await refreshCases();

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: c.id,
        status: 'success',
        message: res.message || `Resync requested for ${c.id}. Latest data will sync automatically in ~12 minutes.`
      });
    } catch (apiErr) {
      const apiErrMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error("Manual resync initiation failed:", apiErr);
      
      await setDoc(doc(db, 'cases', c.id), {
        last_synced: 'Sync Failed',
        advocate_notes: `Manual resync failed: ${apiErrMsg}`
      }, { merge: true });

      await refreshCases();

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: c.id,
        status: 'error',
        message: `Manual resync failed: ${apiErrMsg}`
      });
    }
  };

  // Filter cases on search
  const filteredCases = cases.filter(c => 
    c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.client_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.case_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.court_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8 p-6">
      {/* Grid: Left Column (Add Case Panel), Right Column (Tracked Portfolio Table) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* Left Column: Add Case Panel */}
        <div className="xl:col-span-4 space-y-6">
          <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-gold-amber/10 border border-gold-amber/20 flex items-center justify-center text-gold-amber">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-white">Track New Matter</h3>
                <p className="text-xs text-gray-500 font-mono">Add via 16-Character CNR</p>
              </div>
            </div>

            <form onSubmit={handleAddCase} className="space-y-4">
              {/* CNR Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 block" htmlFor="cnr-input">
                  CNR Number (e.g. DLHC010012342026)
                </label>
                <input
                  id="cnr-input"
                  type="text"
                  maxLength={16}
                  value={cnr}
                  onChange={(e) => setCnr(e.target.value.toUpperCase())}
                  placeholder="ENTER 16-CHAR ALPHANUMERIC"
                  disabled={isSubmitting}
                  className="w-full bg-black/50 border border-terminal-border focus:border-gold-amber/60 text-sm font-mono text-white p-3 rounded-lg placeholder-neutral-700 uppercase tracking-widest focus:outline-none"
                />
                <span className="text-[10px] text-gray-500 block leading-normal font-mono">
                  State (2) + District (2) + Complex (2) + Ref (6) + Year (4)
                </span>
              </div>

              {/* Client Tag/Name Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 block" htmlFor="client-input">
                  Internal Client Name/Tags
                </label>
                <input
                  id="client-input"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Anil Sharma (Defense)"
                  disabled={isSubmitting}
                  className="w-full bg-black/50 border border-terminal-border focus:border-gold-amber/60 text-sm text-white p-3 rounded-lg placeholder-neutral-700 focus:outline-none"
                />
              </div>

              {/* Status Alert Banner */}
              {statusMsg.text && (
                <div className={`p-3 rounded-lg border text-xs leading-normal flex items-start gap-2 ${
                  statusMsg.type === 'error'
                    ? 'bg-red-500/5 border-red-500/20 text-red-400'
                    : statusMsg.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-gold-amber/5 border-gold-amber/20 text-gold-amber'
                }`}>
                  {statusMsg.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="font-mono text-[11px]">{statusMsg.text}</span>
                </div>
              )}

              {/* Action Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full py-3 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  isSubmitting
                    ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed'
                    : 'bg-gold-amber hover:bg-gold-dark text-black shadow-lg shadow-gold-amber/10'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmitting ? 'Syncing eCourts...' : 'Register litigation & Sync'}</span>
              </button>
            </form>
          </div>

          {/* eCourts API Standard Information Card */}
          <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5 text-xs text-gray-400 space-y-3">
            <div className="flex gap-2 items-center text-gray-300 font-semibold border-b border-terminal-border/50 pb-2">
              <Scale className="w-4 h-4 text-gold-amber" />
              <span>eCourts API Standard Schema</span>
            </div>
            <p className="leading-relaxed text-[11px] text-gray-400">
              Lawpp parses litigation case metadata against the structured Case Number Record (CNR) format established under India's National Judicial Data Grid (NJDG). 
            </p>
            <div className="space-y-1.5 font-mono text-[10px] bg-black/30 p-2.5 rounded-lg border border-terminal-border/40">
              <p className="text-gray-300 flex justify-between">
                <span>API Channel:</span>
                <span className="text-gold-amber">Public NJDG Mirror</span>
              </p>
              <p className="text-gray-300 flex justify-between">
                <span>Auth Protocol:</span>
                <span className="text-gold-amber">Zero Credentials Required</span>
              </p>
              <p className="text-gray-300 flex justify-between">
                <span>Security Sandbox:</span>
                <span className="text-gold-amber">Direct User RLS</span>
              </p>
            </div>
          </div>


        </div>

        {/* Right Column: Tracked Cases Table */}
        <div className="xl:col-span-8 space-y-4">
          <div className="bg-terminal-surface border border-terminal-border rounded-xl shadow-xl overflow-hidden">
            {/* Header / Search bar */}
            <div className="p-6 border-b border-terminal-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-semibold text-lg text-white">Litigation Portfolio ({filteredCases.length})</h3>
                <p className="text-xs text-gray-500">Real-time docket sync matching public records</p>
              </div>

              {/* Search input */}
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search CNR, title, court..."
                  className="w-full bg-black/40 border border-terminal-border focus:border-gold-amber/40 text-xs text-white pl-9 pr-4 py-2 rounded-lg placeholder-neutral-700 focus:outline-none"
                />
              </div>
            </div>

            {/* Cases Table */}
            {filteredCases.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-black/40 text-gray-500 uppercase font-mono tracking-wider border-b border-terminal-border text-[10px]">
                    <tr>
                      <th className="px-6 py-3.5 font-semibold">CNR ID</th>
                      <th className="px-6 py-3.5 font-semibold">Case Title / Client</th>
                      <th className="px-6 py-3.5 font-semibold">Court Complex</th>
                      <th className="px-6 py-3.5 font-semibold">Next Date</th>
                      <th className="px-6 py-3.5 font-semibold text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-terminal-border/60 bg-black/10">
                    {filteredCases.map((c) => (
                      <tr key={c.id} className="hover:bg-white/5 transition-all group relative">
                        {/* 'Syncing' Status Overlay */}
                        {c.last_synced === 'Pending Background Processing' && (
                          <td colSpan={5} className="absolute inset-0 bg-black/85 backdrop-blur-[1px] flex items-center justify-between px-6 z-20 pointer-events-none border-y border-gold-amber/20 animate-pulse">
                            <div className="flex items-center gap-2.5">
                              <RefreshCw className="w-3.5 h-3.5 text-gold-amber animate-spin" />
                              <div className="flex flex-col">
                                <span className="font-mono text-[10px] text-gold-amber font-semibold uppercase tracking-wider">Syncing with eCourts Live API</span>
                                <span className="text-[9px] text-gray-400 font-mono">Contacting direct live API registry</span>
                              </div>
                            </div>
                            <span className="font-mono text-[10px] text-gold-amber/80 bg-black border border-gold-amber/20 px-2.5 py-1 rounded">
                              Pending Background Processing
                            </span>
                          </td>
                        )}

                        {/* CNR Number (Monospaced display) */}
                        <td className="px-6 py-4 font-mono text-gold-amber font-semibold tracking-wider whitespace-nowrap">
                          {c.id}
                        </td>

                        {/* Title and Client tag */}
                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-white font-medium line-clamp-1 leading-normal font-display">
                            {getCaseDisplayTitle(c)}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-gray-400">
                            <p className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-gold-amber inline-block"></span>
                              <span>Client Ref: {c.client_name}</span>
                            </p>
                            {c.petitioner && (
                              <p className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block"></span>
                                <span className="text-cyan-400">Petitioner: {c.petitioner}</span>
                              </p>
                            )}
                            {c.cause_list_cnr_check && (
                              <p className="flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  c.cause_list_cnr_check.toLowerCase() === 'yes' || c.cause_list_cnr_check.toLowerCase() === 'true'
                                    ? 'bg-emerald-400'
                                    : 'bg-amber-400'
                                } inline-block`}></span>
                                <span className={
                                  c.cause_list_cnr_check.toLowerCase() === 'yes' || c.cause_list_cnr_check.toLowerCase() === 'true'
                                    ? 'text-emerald-400 font-semibold'
                                    : 'text-amber-400'
                                }>
                                  Cause List: {c.cause_list_cnr_check}
                                </span>
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Court Name details */}
                        <td className="px-6 py-4 text-gray-300 max-w-xs">
                          <p className="line-clamp-1 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                            <span>{c.court_name}</span>
                          </p>
                        </td>

                        {/* Next Hearing Date with Calendar marker */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-mono text-gray-300">
                            <Calendar className="w-3.5 h-3.5 text-gold-amber" />
                            <span>{c.next_hearing_date}</span>
                          </div>
                        </td>

                        {/* Active table actions */}
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* Calendar Push sync trigger */}
                            <button
                              onClick={() => handleSingleSync(c)}
                              className="p-1.5 text-gray-400 hover:text-gold-amber hover:bg-gold-amber/10 rounded transition-all"
                              title="Push sync to Google Calendar"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>

                            {/* Case Archive/Purge trigger */}
                            <button
                              onClick={() => handleDeleteCase(c)}
                              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                              title="Deregister & purge"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center">
                <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-gray-600 mx-auto mb-3">
                  <Plus className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-white">No litigation cases matched your criteria</p>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Use the Add Case module on the left to track litigation matters using their Case Number Record.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
