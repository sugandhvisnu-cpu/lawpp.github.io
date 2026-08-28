/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  FileText, 
  MapPin, 
  Scale, 
  Clock, 
  Save, 
  Sparkles,
  RefreshCw,
  X,
  AlertCircle
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { LitigationCase, SyncLog } from '../types';
import { syncCaseToGoogleCalendar, patchCalendarEventNotes } from '../utils/calendarSync';
import { saveCaseNotes } from '../services/caseSyncService';
import { resyncCaseLive } from '../services/courtApi';
import { getCaseDisplayTitle } from '../utils/caseDisplay';

interface DashboardCalendarProps {
  cases: LitigationCase[];
  refreshCases: () => Promise<void>;
  accessToken: string | null;
  addLog: (log: SyncLog) => void;
}

export default function DashboardCalendar({ 
  cases, 
  refreshCases, 
  accessToken, 
  addLog 
}: DashboardCalendarProps) {
  // Set default calendar month to July 2026 as per local time metadata
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 6, 1)); // Month 6 is July
  const [selectedDay, setSelectedDay] = useState<number | null>(1);
  const [activeCaseIndex, setActiveCaseIndex] = useState<number>(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  
  // Note edit state
  const [editedNotes, setEditedNotes] = useState<string>('');
  const [lastSelectedCaseId, setLastSelectedCaseId] = useState<string>('');

  // Track cases already background-triggered in this session to prevent duplicate execution
  const triggeredCasesRef = React.useRef<Set<string>>(new Set());

  // Automated background trigger for past-date cases (nextDate < currentDate)
  React.useEffect(() => {
    if (!cases || cases.length === 0) return;

    const todayStr = new Date().toISOString().split('T')[0];

    cases.forEach((c) => {
      if (!c.id || triggeredCasesRef.current.has(c.id)) return;

      const nextDate = c.next_hearing_date;
      if (!nextDate || nextDate === 'Not Scheduled' || nextDate.includes('Failed') || nextDate.includes('Awaiting')) {
        return;
      }

      // Check single condition: nextDate < currentDate
      if (nextDate < todayStr) {
        triggeredCasesRef.current.add(c.id);

        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: c.id,
          status: 'info',
          message: `Past-date detected (${nextDate} < ${todayStr}). Triggering background re-sync for CNR ${c.id}...`
        });

        // Invoke existing unmodified case sync function in the background
        resyncCaseLive(c.id, {
          user_id: c.user_id,
          client_name: c.client_name,
          googleAccessToken: accessToken || undefined
        }).catch((err) => {
          console.warn(`[Background Auto Sync] Background resync failed for case ${c.id}:`, err);
        });
      }
    });
  }, [cases, accessToken, addLog]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Calendar calculations
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  // Handlers for month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Format date key to YYYY-MM-DD
  const formatDateString = (day: number) => {
    const formattedMonth = String(month + 1).padStart(2, '0');
    const formattedDay = String(day).padStart(2, '0');
    return `${year}-${formattedMonth}-${formattedDay}`;
  };

  // Get cases for a specific day
  const getCasesForDay = (day: number): LitigationCase[] => {
    const dateStr = formatDateString(day);
    return cases.filter(c => c.next_hearing_date === dateStr);
  };

  // Deterministic item/cause list number based on case details (Pillar 8 Requirement)
  const getDeterministicItemNumber = (cnr: string): number => {
    let sum = 0;
    for (let i = 0; i < cnr.length; i++) {
      sum += cnr.charCodeAt(i);
    }
    return (sum % 40) + 1; // Item 1 to 40
  };

  const selectedDateStr = selectedDay ? formatDateString(selectedDay) : '';
  const selectedDayCases = selectedDay ? getCasesForDay(selectedDay) : [];
  const activeCase = selectedDayCases[activeCaseIndex];

  // Sync edited notes field if case changes
  React.useEffect(() => {
    if (activeCase && activeCase.id !== lastSelectedCaseId) {
      setEditedNotes(activeCase.advocate_notes || '');
      setLastSelectedCaseId(activeCase.id);
      setSaveStatus('');
    }
  }, [activeCase, lastSelectedCaseId]);

  // Handle Note Save (Committing notes straight to Firestore)
  const handleSaveNotes = async () => {
    if (!activeCase) return;
    setIsSaving(true);
    setSaveStatus('Saving notes to litigation record...');
    
    const caseRef = doc(db, 'cases', activeCase.id);
    try {
      // 1. Update Firestore document directly
      await updateDoc(caseRef, {
        advocate_notes: editedNotes,
        last_updated: new Date().toISOString()
      });

      // Local success log
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: activeCase.id,
        status: 'success',
        message: `Committed advocate notes update straight to Firestore record for ${activeCase.id}.`
      });

      setSaveStatus('Notes saved. Broadcasting update to Google Calendar...');

      // 2. Send POST request to /api/cases/notes
      let syncSuccess = false;
      let newEventId: string | null = null;

      try {
        const apiData = await saveCaseNotes(activeCase.id, editedNotes, {
          googleAccessToken: accessToken || undefined,
          user_id: activeCase.user_id || undefined,
        });

        syncSuccess = Boolean(apiData.calendarSynced);
        if (apiData.googleEventId) {
          newEventId = apiData.googleEventId;
        }
      } catch (apiErr) {
        console.warn('API /api/cases/notes warning:', apiErr);
      }

      // If client has direct accessToken and API didn't sync, perform direct client patch fallback
      if (!syncSuccess && accessToken) {
        const updatedCase = {
          ...activeCase,
          advocate_notes: editedNotes,
          last_updated: new Date().toISOString()
        };
        const patchRes = await patchCalendarEventNotes(updatedCase, accessToken, editedNotes, undefined, addLog);
        syncSuccess = patchRes.success;
        if (patchRes.eventId) {
          newEventId = patchRes.eventId;
        }
      }

      // Update local case state with new googleEventId if returned
      if (newEventId) {
        await updateDoc(caseRef, { googleEventId: newEventId });
      }

      // Re-fetch all litigation records
      await refreshCases();

      // 3. UI Status Toast Messaging
      if (syncSuccess) {
        setSaveStatus('Notes updated & synced to Google Calendar');
      } else {
        setSaveStatus('Notes saved to Lawpp (Google Calendar token re-auth required)');
      }
      
      setTimeout(() => setSaveStatus(''), 5000);
    } catch (error) {
      setSaveStatus('Failed to save notes.');
      handleFirestoreError(error, OperationType.UPDATE, `cases/${activeCase.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Manual trigger for google calendar sync
  const handleManualSync = async (c: LitigationCase) => {
    if (!accessToken) {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: c.id,
        status: 'warning',
        message: 'Google Calendar API not authenticated. Please log in first.'
      });
      return;
    }
    await syncCaseToGoogleCalendar(c, accessToken, addLog);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
      {/* 1. Main Calendar Widget (Black Tile Layout) */}
      <div className="lg:col-span-7 bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl flex flex-col justify-between">
        <div>
          {/* Calendar Header with Prev/Next Month selectors */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold-amber/10 border border-gold-amber/20 flex items-center justify-center text-gold-amber">
                <CalendarIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-lg text-white">
                  {monthNames[month]} {year}
                </h2>
                <p className="text-xs text-gray-400">Monthly Causelist View</p>
              </div>
            </div>

            <div className="flex gap-1.5 bg-black/40 p-1 rounded-lg border border-terminal-border">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {daysOfWeek.map(d => (
              <span key={d} className="text-xs font-mono font-medium text-gray-500 py-1">
                {d}
              </span>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {/* Prev month padding days */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => {
              const dayNum = prevMonthTotalDays - firstDayOfWeek + i + 1;
              return (
                <div
                  key={`prev-${i}`}
                  className="aspect-square bg-black/10 border border-terminal-border/30 rounded-lg flex items-center justify-center text-gray-600 text-xs select-none"
                >
                  {dayNum}
                </div>
              );
            })}

            {/* Current month days */}
            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const hasHearings = getCasesForDay(dayNum).length > 0;
              const isSelected = selectedDay === dayNum;
              const isToday = new Date().getDate() === dayNum && new Date().getMonth() === month && new Date().getFullYear() === year;

              return (
                <button
                  key={`day-${dayNum}`}
                  onClick={() => {
                    setSelectedDay(dayNum);
                    setActiveCaseIndex(0);
                  }}
                  className={`aspect-square relative rounded-lg border flex flex-col items-center justify-center transition-all duration-150 group cursor-pointer ${
                    isSelected
                      ? 'bg-gold-amber/20 border-gold-amber text-gold-amber font-semibold scale-102 shadow-lg shadow-gold-amber/10'
                      : isToday
                      ? 'bg-neutral-800 border-neutral-700 text-white font-semibold'
                      : 'bg-black/30 border-terminal-border/50 text-gray-300 hover:bg-white/5 hover:border-gray-700'
                  }`}
                >
                  {/* Day Number */}
                  <span className="text-sm">{dayNum}</span>

                  {/* High-Contrast Gold/Yellow Hearing Marker Point */}
                  {hasHearings && (
                    <span className="absolute bottom-1.5 w-1.5 h-1.5 rounded-full bg-gold-amber shadow-sm shadow-gold-amber animate-pulse"></span>
                  )}
                </button>
              );
            })}

            {/* Next month padding days */}
            {Array.from({ length: (42 - (totalDays + firstDayOfWeek)) % 7 }).map((_, i) => (
              <div
                key={`next-${i}`}
                className="aspect-square bg-black/10 border border-terminal-border/30 rounded-lg flex items-center justify-center text-gray-600 text-xs select-none"
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Legend Indicator */}
        <div className="mt-6 pt-4 border-t border-terminal-border flex justify-between items-center text-xs text-gray-500">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-gold-amber inline-block"></span>
              <span>Court Hearing Scheduled</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-neutral-800 border border-neutral-700 inline-block"></span>
              <span>Today</span>
            </span>
          </div>
          <span className="font-mono text-[10px]">JULY 2026 CALENDAR LOCK</span>
        </div>
      </div>

      {/* 2. Slide-out Detail Drawer / Info Tiles */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        {selectedDay ? (
          <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl flex flex-col flex-1 h-full min-h-[500px]">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-terminal-border pb-4 mb-4">
              <div>
                <span className="text-[10px] font-mono text-gold-amber font-semibold uppercase tracking-wider bg-gold-amber/10 border border-gold-amber/20 px-2.5 py-1 rounded">
                  {selectedDateStr}
                </span>
                <h3 className="font-display font-semibold text-lg text-white mt-1.5">
                  Scheduled Matters ({selectedDayCases.length})
                </h3>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cases List for Selected Day */}
            {selectedDayCases.length > 0 ? (
              <div className="flex-1 flex flex-col h-full justify-between gap-4">
                <div className="space-y-4">
                  {/* Tab list for multiple cases scheduled on same day */}
                  {selectedDayCases.length > 1 && (
                    <div className="flex gap-2 border-b border-terminal-border/40 pb-2 overflow-x-auto">
                      {selectedDayCases.map((c, idx) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setActiveCaseIndex(idx);
                            setSaveStatus('');
                          }}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium shrink-0 transition-all ${
                            activeCaseIndex === idx
                              ? 'bg-gold-amber text-black'
                              : 'bg-black/30 text-gray-400 border border-terminal-border hover:text-white'
                          }`}
                        >
                          Matter #{idx + 1} ({c.id.substring(0, 4)})
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Active Case Details Layout */}
                  <div className="space-y-3">
                    <div className="p-4 bg-black/40 rounded-lg border border-terminal-border/80">
                      <span className="text-[9px] font-mono text-gray-500 uppercase">Litigation Title</span>
                      <h4 className="text-white font-semibold text-base mt-0.5 font-display">
                        {getCaseDisplayTitle(activeCase)}
                      </h4>
                      <p className="text-xs text-gold-amber font-semibold mt-1">Client: {activeCase.client_name}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-3 bg-black/20 rounded-lg border border-terminal-border/40 flex items-start gap-2 min-h-[64px]">
                        <Scale className="w-4 h-4 text-gold-amber shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[9px] font-mono text-gray-500 uppercase block">Case Stage</span>
                          <span className="text-gray-300 font-medium block leading-tight">{activeCase.case_stage}</span>
                        </div>
                      </div>

                      <div className="p-3 bg-black/20 rounded-lg border border-terminal-border/40 flex items-start gap-2 min-h-[64px]">
                        <Clock className="w-4 h-4 text-gold-amber shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[9px] font-mono text-gray-500 uppercase block">Board Item No.</span>
                          <span className="text-gray-300 font-medium block leading-tight">
                            Item #{getDeterministicItemNumber(activeCase.id)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-black/20 rounded-lg border border-terminal-border/40 flex gap-2 items-start text-xs">
                      <MapPin className="w-4 h-4 text-gold-amber shrink-0 mt-0.5" />
                      <div>
                        <span className="text-[9px] font-mono text-gray-500 uppercase block">Courtroom Location</span>
                        <span className="text-gray-300 leading-tight block">{activeCase.court_name}</span>
                      </div>
                    </div>
                  </div>

                  {/* Advocate Notes markdown text area with functional "Save Notes" trigger */}
                  <div className="mt-4 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-gold-amber" />
                        <span>Advocate Briefing Notes (Markdown)</span>
                      </label>
                      {accessToken && (
                        <button
                          onClick={() => handleManualSync(activeCase)}
                          className="text-[10px] text-gold-amber flex items-center gap-1 hover:underline transition-all"
                          title="Force immediate refresh onto Google Calendar"
                        >
                          <RefreshCw className="w-3 h-3 animate-spin-hover" />
                          <span>Push Sync</span>
                        </button>
                      )}
                    </div>
                    
                    <textarea
                      value={editedNotes}
                      onChange={(e) => setEditedNotes(e.target.value)}
                      placeholder="# Enter your case brief here..."
                      className="w-full h-44 p-3 bg-black/60 border border-terminal-border rounded-lg text-xs text-gray-200 font-mono focus:outline-none focus:border-gold-amber/60 resize-none leading-relaxed"
                    />
                  </div>
                </div>

                {/* Advocate Notes save status and triggers */}
                <div className="mt-4 pt-3 border-t border-terminal-border/50 flex flex-col gap-2">
                  {saveStatus && (
                    <div className="flex items-center gap-1.5 text-xs text-gold-amber font-mono bg-gold-amber/5 p-2 rounded border border-gold-amber/20">
                      <Sparkles className="w-3.5 h-3.5 text-gold-amber shrink-0 animate-pulse" />
                      <span className="text-[10px] leading-tight">{saveStatus}</span>
                    </div>
                  )}
                  <button
                    onClick={handleSaveNotes}
                    disabled={isSaving || editedNotes === activeCase.advocate_notes}
                    className={`w-full py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      editedNotes === activeCase.advocate_notes
                        ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed'
                        : 'bg-gold-amber hover:bg-gold-dark text-black shadow-lg shadow-gold-amber/10'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving Record...' : 'Save Notes to Firestore'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-gray-500 mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-white">No hearings on this day</p>
                <p className="text-xs text-gray-500 mt-1 max-w-[250px] mx-auto">
                  Your docket is empty for this date. Select another day with a yellow marker.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl flex flex-col items-center justify-center text-center h-full min-h-[500px]">
            <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-gold-amber mb-4 border border-gold-amber/10">
              <CalendarIcon className="w-6 h-6" />
            </div>
            <h3 className="font-display font-semibold text-lg text-white">Select a Docket Date</h3>
            <p className="text-xs text-gray-500 mt-2 max-w-[280px]">
              Click on any date in the monthly litigation grid to open active case boards, courtroom listings, and advocate notes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
