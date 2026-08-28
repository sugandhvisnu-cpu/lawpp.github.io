/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDocsFromServer,
  doc, 
  getDoc,
  setDoc,
  onSnapshot
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  initAuth, 
  googleSignIn, 
  logout, 
  getAccessToken,
  handleFirestoreError,
  OperationType 
} from './firebase';
import { LitigationCase, SyncLog } from './types';
import Sidebar from './components/Sidebar';
import DashboardCalendar from './components/DashboardCalendar';
import PortfolioManager from './components/PortfolioManager';
import ProfileSettings from './components/ProfileSettings';
import NotificationArray from './components/NotificationArray';
import HeaderClock from './components/HeaderClock';
import { fetchLiveCourtData } from './services/courtApi';
import { syncCaseToGoogleCalendar } from './utils/calendarSync';
import { useStrictAuthSession } from './hooks/useStrictAuthSession';
import { 
  Scale, 
  Terminal as TerminalIcon, 
  AlertTriangle, 
  Cpu, 
  Calendar, 
  Plus, 
  ShieldCheck, 
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [barId, setBarId] = useState<string>('');
  const [cases, setCases] = useState<LitigationCase[]>([]);
  
  const [activeTab, setActiveTab] = useState<'calendar' | 'portfolio' | 'settings'>('calendar');
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);

  // Add Case CNR Modal Popup state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [modalCnr, setModalCnr] = useState<string>('');
  const [modalClientName, setModalClientName] = useState<string>('');
  const [modalIsSubmitting, setModalIsSubmitting] = useState<boolean>(false);
  const [modalStatusMsg, setModalStatusMsg] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });
  
  // Real-time System console logs
  const [logs, setLogs] = useState<SyncLog[]>([
    {
      timestamp: new Date().toLocaleTimeString(),
      cnr: 'SYSTEM',
      status: 'info',
      message: 'Lawpp Secure Core litigation terminal initialized.'
    }
  ]);
  const [isConsoleExpanded, setIsConsoleExpanded] = useState<boolean>(false);

  // Appends a log line
  const addLog = React.useCallback((log: SyncLog) => {
    setLogs(prev => [log, ...prev].slice(0, 50));
  }, []);

  // Handle expired session
  const handleSessionExpired = React.useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: 'AUTH',
      status: 'warning',
      message: 'Session limit reached (1-hour security limit). Advocate signed out.'
    });
  }, [addLog]);

  // Enforce strict 1-hour session timeout based on Firebase authTime
  useStrictAuthSession(user, handleSessionExpired);

  // Helper: Fetch Advocate Profile (Bar ID) from Firestore (secured via RLS)
  const fetchProfile = React.useCallback(async (uid: string) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userSnapshot = await getDoc(userDocRef);
      if (userSnapshot.exists()) {
        const data = userSnapshot.data();
        setBarId(data.bar_id || '');
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: 'SYSTEM',
          status: 'success',
          message: `Advocate registry loaded: Bar ID ${data.bar_id}`
        });
      } else {
        // Advocate profile doesn't exist yet, force redirection to settings profile creation page
        setBarId('');
        setActiveTab('settings');
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: 'SYSTEM',
          status: 'warning',
          message: 'No registered Bar Association record found. Redirecting to Profile settings...'
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    }
  }, [addLog]);

  // Helper: Fetch tracked litigation cases from Firestore (secured via RLS)
  const fetchCases = React.useCallback(async (uid: string) => {
    setIsLoadingData(true);
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: 'SYSTEM',
      status: 'info',
      message: 'Synchronizing client litigation records with Firestore datastore...'
    });

    const casesPath = 'cases';
    try {
      const q = query(collection(db, casesPath), where('user_id', '==', uid));
      const querySnapshot = await getDocsFromServer(q);
      const fetchedCases: LitigationCase[] = [];
      
      querySnapshot.forEach((doc) => {
        fetchedCases.push(doc.data() as LitigationCase);
      });
      
      setCases(fetchedCases);
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: 'SYSTEM',
        status: 'success',
        message: `Successfully synchronized ${fetchedCases.length} litigation matters.`
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, casesPath);
    } finally {
      setIsLoadingData(false);
    }
  }, [addLog]);

  // Setup Real-time Firestore listener for cases
  useEffect(() => {
    if (!user?.uid) {
      setCases([]);
      return;
    }

    const casesPath = 'cases';
    const q = query(collection(db, casesPath), where('user_id', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const fetchedCases: LitigationCase[] = [];
        querySnapshot.forEach((docSnap) => {
          fetchedCases.push(docSnap.data() as LitigationCase);
        });
        setCases(fetchedCases);
        setIsLoadingData(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, casesPath);
        setIsLoadingData(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Setup Auth state listener on initial mount
  useEffect(() => {
    const unsubscribe = initAuth(
      async (loggedInUser, token) => {
        setUser(loggedInUser);
        setAccessToken(token);
        setNeedsAuth(false);
        
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: 'SYSTEM',
          status: 'success',
          message: `Advocate authenticated: ${loggedInUser.displayName} (${loggedInUser.email})`
        });

        // Load profile and cases
        await fetchProfile(loggedInUser.uid);
        await fetchCases(loggedInUser.uid);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: 'SYSTEM',
          status: 'info',
          message: 'Secure channel awaiting advocate credentials.'
        });
      }
    );

    return () => unsubscribe();
  }, []);

  // Login handler
  const handleLogin = async () => {
    setIsLoggingIn(true);
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: 'AUTH',
      status: 'info',
      message: 'Initiating Google Sign-In with eCourts Calendar scopes...'
    });

    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        
        // Securely write google_access_token to the user's Firestore document
        const userDocRef = doc(db, 'users', result.user.uid);
        await setDoc(userDocRef, {
          uid: result.user.uid,
          email: result.user.email || '',
          name: result.user.displayName || '',
          google_access_token: result.accessToken,
          last_login: new Date().toISOString()
        }, { merge: true });

        await fetchProfile(result.user.uid);
        await fetchCases(result.user.uid);
      }
    } catch (err) {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: 'AUTH',
        status: 'error',
        message: `Sign-in aborted or failed: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Sign out handler
  const handleLogout = async () => {
    addLog({
      timestamp: new Date().toLocaleTimeString(),
      cnr: 'AUTH',
      status: 'info',
      message: 'Terminating advocate secure session...'
    });
    await logout();
    setCases([]);
    setBarId('');
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
  };

  // Dynamic Case Refresher
  const triggerRefresher = async () => {
    if (user) {
      await fetchCases(user.uid);
    }
  };

  // Open Add Case CNR Modal or Prompt for authentication first
  const handleOpenAddModal = () => {
    if (!user) {
      const confirmLogin = window.confirm(
        "SIGN-IN REQUIRED\n\nPlease sign in with Google first to add and track cases on your secure litigation terminal."
      );
      if (confirmLogin) {
        handleLogin();
      }
    } else {
      setIsAddModalOpen(true);
      setModalStatusMsg({ type: '', text: '' });
      setModalCnr('');
      setModalClientName('');
    }
  };

  // Submit Handler for Add Case Modal Popup
  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalStatusMsg({ type: '', text: '' });

    const trimmedCnr = modalCnr.trim().toUpperCase();
    if (trimmedCnr.length !== 16) {
      setModalStatusMsg({ type: 'error', text: 'CNR Number must be exactly 16 characters long.' });
      return;
    }

    const alphanumeric = /^[a-zA-Z0-9]+$/;
    if (!alphanumeric.test(trimmedCnr)) {
      setModalStatusMsg({ type: 'error', text: 'CNR Number must be purely alphanumeric (no spaces or special symbols).' });
      return;
    }

    if (!modalClientName.trim()) {
      setModalStatusMsg({ type: 'error', text: 'Please specify an Internal Client Name or Tags.' });
      return;
    }

    if (cases.some(c => c.id === trimmedCnr)) {
      setModalStatusMsg({ type: 'error', text: `Matter ${trimmedCnr} is already in your tracked portfolio.` });
      return;
    }

    if (!user || !auth.currentUser) {
      setModalStatusMsg({ type: 'error', text: 'You must be fully authenticated via Google Sign-In to track cases.' });
      alert("Please sign in with Google first to add and track cases on your secure litigation terminal.");
      return;
    }

    setModalIsSubmitting(true);
    setModalStatusMsg({ type: 'success', text: 'Registering matter and preparing live eCourtsIndia docket sync...' });

    try {
      // Prepare exact requested case structure with Pending state
      const caseData = {
        id: trimmedCnr,
        user_id: auth.currentUser.uid, // Ensure this exact key matches our rules
        client_name: modalClientName.trim(),
        case_title: "Pending Sync",
        court_name: "Pending Sync",
        next_hearing_date: "Pending Sync",
        case_stage: "Pending Sync",
        advocate_notes: "",
        last_updated: new Date().toISOString(),
        last_synced: 'Pending Background Processing'
      };

      console.log("Current Authenticated User right before Firestore setDoc write:", auth.currentUser);

      const caseDocRef = doc(db, 'cases', trimmedCnr);
      await setDoc(caseDocRef, caseData);

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: trimmedCnr,
        status: 'success',
        message: `Registered new litigation portfolio case matching CNR: ${trimmedCnr}`
      });

      // Refreshes the local case state (shows the syncing row spinner immediately)
      await fetchCases(auth.currentUser.uid);

      setModalStatusMsg({ type: 'success', text: 'Fetching live court docket from eCourtsIndia API...' });

      try {
        const liveData = await fetchLiveCourtData(trimmedCnr);
        
        const petName = liveData.petitioner_name || liveData.petitioner || "Information Unavailable";
        const resName = liveData.respondent_name || "Information Unavailable";
        let formattedTitle = liveData.case_title || "Live Litigation Matter";
        if (petName !== "Information Unavailable" && resName !== "Information Unavailable") {
          formattedTitle = `${petName} v. ${resName}`;
        }

        // Save those live updates directly into our Firestore cases collection
        await setDoc(caseDocRef, {
          title: formattedTitle,
          case_title: formattedTitle,
          court_name: liveData.court_name || "District/High Court",
          next_hearing_date: liveData.next_hearing_date || "Not Scheduled",
          case_stage: liveData.case_stage || "Live Status Active",
          petitioner: petName,
          petitioner_name: petName,
          respondent: resName,
          respondent_name: resName,
          cause_list_cnr_check: liveData.cause_list_cnr_check || "No",
          status: 'synced',
          syncStatus: 'completed',
          last_updated: new Date().toISOString(),
          last_synced: 'Synchronized',
          updatedAt: new Date()
        }, { merge: true });

        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: trimmedCnr,
          status: 'success',
          message: `Live sync succeeded! Hearing: ${liveData.next_hearing_date}, Stage: ${liveData.case_stage}`
        });

        // Trigger automatic calendar sync
        if (accessToken) {
          setModalStatusMsg({ type: 'success', text: 'Syncing live docket with Google Calendar...' });
          const syncedCaseData = {
            ...caseData,
            title: formattedTitle,
            case_title: formattedTitle,
            petitioner: petName,
            petitioner_name: petName,
            respondent: resName,
            respondent_name: resName,
            court_name: liveData.court_name || "District/High Court",
            next_hearing_date: liveData.next_hearing_date || "Not Scheduled",
            case_stage: liveData.case_stage || "Live Status Active",
            last_synced: 'Synchronized'
          };
          const syncSuccess = await syncCaseToGoogleCalendar(syncedCaseData, accessToken, addLog);
          if (syncSuccess) {
            setModalStatusMsg({ type: 'success', text: `Matter ${trimmedCnr} synchronized live and added to Google Calendar!` });
          } else {
            setModalStatusMsg({ type: 'success', text: `Matter ${trimmedCnr} synchronized live! (Calendar sync pending authentication).` });
          }
        } else {
          setModalStatusMsg({ type: 'success', text: `Matter ${trimmedCnr} successfully synchronized live and tracked.` });
        }
      } catch (apiErr) {
        // Handle failure by marking the last_synced field as 'Sync Failed' to clear the spinner and show the error.
        const apiErrMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.error("Live court API fetch failed:", apiErr);
        
        await setDoc(caseDocRef, {
          title: 'Fetch Failed (Retry)',
          case_title: 'Fetch Failed (Retry)',
          status: 'failed',
          syncStatus: 'failed',
          last_synced: 'Sync Failed',
          court_name: 'Fetch Failed',
          next_hearing_date: 'Fetch Failed',
          case_stage: 'Fetch Failed',
          advocate_notes: `Sync failed with error: ${apiErrMsg}`,
          last_updated: new Date().toISOString(),
          updatedAt: new Date()
        }, { merge: true });

        setModalStatusMsg({ type: 'error', text: `Live sync failed: ${apiErrMsg}` });
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          cnr: trimmedCnr,
          status: 'error',
          message: `Live sync failed: ${apiErrMsg}`
        });
      }

      setModalCnr('');
      setModalClientName('');
      setTimeout(() => {
        setIsAddModalOpen(false);
        setModalStatusMsg({ type: '', text: '' });
      }, 2000);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setModalStatusMsg({ type: 'error', text: `Failed to commit litigation case to Firestore database: ${errMsg}` });
      handleFirestoreError(error, OperationType.CREATE, `cases/${trimmedCnr}`);
    } finally {
      setModalIsSubmitting(false);
    }
  };

  // Render gate for unauthenticated users (The landing page gateway)
  if (needsAuth) {
    return (
      <div className="min-h-screen bg-terminal-bg flex flex-col items-center justify-center p-6 text-gray-200 selection:bg-gold-amber selection:text-black">
        {/* Decorative Grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(#2a2a2a_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none"></div>

        <div className="max-w-md w-full relative space-y-8 z-10">
          {/* Logo Brand Header */}
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gold-amber mx-auto flex items-center justify-center text-black font-display font-bold text-3xl shadow-2xl shadow-gold-amber/25 border-t-2 border-white/20">
              L
            </div>
            <div>
              <h1 className="font-display font-extrabold text-3xl tracking-wider text-white">
                LAW<span className="text-gold-amber">PP</span>
              </h1>
              <p className="text-xs font-mono text-gold-amber uppercase tracking-widest mt-1">
                Indian litigation Terminal & Sync
              </p>
            </div>
            <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
              Durable CNR-indexed calendar, litigation tracking, and Google Calendar syncing designed exclusively for Indian advocates.
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-terminal-surface border border-terminal-border rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-1.5 border-b border-terminal-border/60 pb-5">
              <h2 className="text-sm font-mono font-medium text-gray-400">SESSION AUTHENTICATION</h2>
              <p className="text-xs text-gray-500">Sign in using verified advocate accounts</p>
            </div>

            <div className="space-y-4">
              {/* Official Google Sign-In GSI Button */}
              <button
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="w-full flex items-center justify-center gap-3 bg-neutral-900 border border-neutral-800 hover:border-gold-amber/40 rounded-lg p-3.5 text-sm font-semibold text-white transition-all hover:bg-neutral-800 focus:outline-none"
              >
                <div className="gsi-material-button-icon shrink-0">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5 block">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                </div>
                <span>{isLoggingIn ? 'Establishing Secure Link...' : 'Sign in with Google'}</span>
              </button>

              <button
                onClick={handleOpenAddModal}
                className="w-full flex items-center justify-center gap-2 bg-neutral-900/40 border border-neutral-800 hover:border-gold-amber/30 rounded-lg p-3 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 text-gold-amber" />
                <span>Track Case / Add CNR Number</span>
              </button>

              <div className="flex gap-2 items-start text-[10px] text-gray-500 bg-black/40 p-3.5 rounded-lg border border-terminal-border/50 leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-gold-amber shrink-0 mt-0.5" />
                <p>
                  Lawpp connects to Google Calendar to automatically update and publish case event boards. Scopes: <code className="text-gray-300 font-mono">calendar</code> and <code className="text-gray-300 font-mono">calendar.events</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Footer security badge */}
          <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono text-gray-600">
            <ShieldCheck className="w-4 h-4 text-gray-700" />
            <span>SECURE CRYPTO ENDPOINT // ROW LEVEL SECURITY</span>
          </div>
        </div>
      </div>
    );
  }

  // Render primary application dashboard layout for authenticated advocates
  return (
    <div className="min-h-screen bg-terminal-bg flex overflow-hidden">
      
      {/* Navigation Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        user={user} 
        onLogout={handleLogout} 
        barId={barId}
      />

      {/* Main Terminal Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pb-24 pb-safe pl-safe pr-safe">
        
        {/* WorkSpace Header bar */}
        <header className="border-b border-terminal-border bg-terminal-surface py-4 px-6 pt-safe flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div className="space-y-0.5">
            <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-gold-amber" />
              <span>Litigation Control Center</span>
            </h2>
            <p className="text-xs text-gray-500">
              Active Session Docket: <span className="font-mono text-gray-300 text-[11px]">{(auth.currentUser || user) ? 'Registered Developer/Advocate' : 'Unregistered Advocate'}</span>
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Add Case Button */}
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-1.5 py-1.5 px-3 rounded bg-[#FFC107] text-black hover:bg-[#E0A800] text-[11px] font-semibold transition-all shadow-lg shadow-gold-amber/15 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Case / CNR</span>
            </button>

            {/* Terminal Clock (Dynamic local browser time) */}
            <HeaderClock />
          </div>
        </header>

        {/* Top Stats Row */}
        {user && (
          <div className="px-6 mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl shadow-lg">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">Active Tracked Cases</p>
              <p className="text-3xl font-light text-white">
                {String(cases.length).padStart(2, '0')}{' '}
                <span className="text-xs text-zinc-600">/ 25 portfolio limit</span>
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl border-l-4 border-l-[#FFC107] shadow-lg">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">Hearings in July 2026</p>
              <p className="text-3xl font-light text-[#FFC107]">
                {String(cases.filter(c => c.next_hearing_date.startsWith('2026-07')).length).padStart(2, '0')}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl shadow-lg flex flex-col justify-between">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-semibold">G-Cal Sync Status</p>
              {accessToken ? (
                <div className="flex items-center gap-2 text-emerald-400 mt-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                  <p className="text-xs font-mono uppercase font-semibold">All iCalUIDs Verified</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-500 mt-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                  <p className="text-xs font-mono uppercase font-semibold">Awaiting Authorization</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dynamic T-Minus 3 Notification Board */}
        <div className="mt-6">
          <NotificationArray cases={cases} accessToken={accessToken} />
        </div>

        {/* Main View Area with Empty States Handlers */}
        <main className="flex-1">
          {cases.length === 0 && activeTab !== 'settings' ? (
            /* Empty State Handlers: Welcome Banner replaces core screens if zero matters */
            <div className="p-6 max-w-xl mx-auto mt-12">
              <div className="bg-terminal-surface border border-gold-amber/20 rounded-xl p-8 shadow-2xl text-center space-y-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gold-amber"></div>
                
                <div className="w-16 h-16 rounded-full bg-gold-amber/10 border border-gold-amber/20 flex items-center justify-center text-gold-amber mx-auto shadow-lg shadow-gold-amber/5">
                  <Scale className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h3 className="font-display font-extrabold text-xl text-white">Litigation Portfolio Clear</h3>
                  <p className="text-xs text-gray-400 leading-relaxed max-w-sm mx-auto">
                    Your litigation calendar is clear. Track your first matter by clicking Add Case.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleOpenAddModal}
                    className="py-2.5 px-5 bg-[#FFC107] hover:bg-[#E0A800] text-black rounded-lg text-xs font-semibold flex items-center gap-2 mx-auto transition-all shadow-lg shadow-gold-amber/10 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Track Litigation Matter (Add Case)</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'calendar' && (
                <DashboardCalendar 
                  cases={cases} 
                  refreshCases={triggerRefresher} 
                  accessToken={accessToken} 
                  addLog={addLog} 
                />
              )}

              {activeTab === 'portfolio' && (
                <PortfolioManager 
                  cases={cases} 
                  setCases={setCases}
                  refreshCases={triggerRefresher} 
                  userId={user.uid} 
                  accessToken={accessToken} 
                  addLog={addLog} 
                />
              )}

              {activeTab === 'settings' && (
                <ProfileSettings 
                  user={user} 
                  barId={barId} 
                  setBarId={setBarId} 
                  refreshProfile={() => fetchProfile(user.uid)} 
                  addLog={addLog} 
                />
              )}
            </>
          )}
        </main>

        {/* Real-time System Sync Terminal Log Console */}
        <footer className="fixed bottom-0 right-0 left-0 sm:left-64 bg-[#0a0a0a] border-t border-terminal-border/80 z-20">
          <div 
            onClick={() => setIsConsoleExpanded(!isConsoleExpanded)}
            className="flex items-center justify-between px-6 py-2 bg-black/80 cursor-pointer select-none border-b border-terminal-border/40 text-[10px] text-gray-400 hover:text-white transition-all"
          >
            <div className="flex items-center gap-2">
              <TerminalIcon className="w-3.5 h-3.5 text-gold-amber" />
              <span className="font-mono font-semibold tracking-wider text-gray-300 uppercase">Litigation Sync logs</span>
              <span className="font-mono bg-emerald-500/10 border border-emerald-500/35 px-1.5 py-0.2 rounded text-[8px] text-emerald-400 font-bold tracking-widest uppercase">
                Active
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-gray-500 text-[9px]">Last activity: {logs[0]?.timestamp || 'None'}</span>
              {isConsoleExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </div>
          </div>

          {isConsoleExpanded && (
            <div className="p-4 h-32 overflow-y-auto font-mono text-[10px] bg-black text-gray-400 space-y-1.5 scrollbar-thin">
              {logs.map((log, index) => (
                <div key={index} className="flex items-start gap-2 border-b border-neutral-900 pb-1 last:border-0 leading-relaxed">
                  <span className="text-gray-600 shrink-0 select-none">[{log.timestamp}]</span>
                  <span className={`px-1 rounded text-[8px] uppercase font-bold shrink-0 ${
                    log.status === 'success' 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : log.status === 'error'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : log.status === 'warning'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                  }`}>
                    {log.cnr}
                  </span>
                  <span className={
                    log.status === 'error' 
                      ? 'text-red-400 font-semibold' 
                      : log.status === 'success' 
                      ? 'text-emerald-400' 
                      : 'text-gray-300'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </footer>

        {/* CNR Case Add Modal Popup */}
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-[#111] border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-6 shadow-2xl relative">
              {/* Close Button */}
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-1.5 border-b border-zinc-900 pb-4 pr-6">
                <h3 className="font-display font-extrabold text-lg text-white flex items-center gap-2">
                  <Scale className="w-5 h-5 text-gold-amber" />
                  <span>Track Litigation Matter</span>
                </h3>
                <p className="text-xs text-zinc-500 font-mono">
                  Establish a secure live eCourts sync anchor using CNR code
                </p>
              </div>

              <form onSubmit={handleModalSubmit} className="space-y-5">
                {/* CNR Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-400 font-mono flex justify-between">
                    <span>CNR NUMBER (16-CHAR ALPHANUMERIC)</span>
                    <span className="text-[10px] text-[#FFC107] font-normal lowercase">e.g. DLHC010012342026</span>
                  </label>
                  <input
                    type="text"
                    value={modalCnr}
                    onChange={(e) => setModalCnr(e.target.value)}
                    placeholder="Enter 16-character Case Number Record"
                    maxLength={16}
                    disabled={modalIsSubmitting}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-gold-amber rounded-lg px-3.5 py-2.5 text-xs font-mono text-white tracking-widest placeholder:tracking-normal placeholder:font-sans uppercase outline-none transition-all"
                  />
                </div>

                {/* Client Name Field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-400 font-mono">
                    INTERNAL CLIENT NAME / MEMO TAG
                  </label>
                  <input
                    type="text"
                    value={modalClientName}
                    onChange={(e) => setModalClientName(e.target.value)}
                    placeholder="e.g. Tata Motors Dispute"
                    disabled={modalIsSubmitting}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-[#FFC107] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 outline-none transition-all"
                  />
                </div>

                {/* Modal Status Banner */}
                {modalStatusMsg.text && (
                  <div className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
                    modalStatusMsg.type === 'error'
                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  }`}>
                    {modalStatusMsg.text}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 rounded-lg py-2.5 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalIsSubmitting}
                    className="flex-1 bg-[#FFC107] hover:bg-[#E0A800] text-black disabled:opacity-50 font-semibold rounded-lg py-2.5 text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-[#FFC107]/10 cursor-pointer"
                  >
                    {modalIsSubmitting ? (
                      <>
                        <Cpu className="w-3.5 h-3.5 animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Track Matter</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
