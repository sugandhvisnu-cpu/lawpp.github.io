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
  checkRedirectResult,
  logout, 
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

  const addLog = React.useCallback((log: SyncLog) => {
    setLogs(prev => [log, ...prev].slice(0, 50));
  }, []);

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

  useStrictAuthSession(user, handleSessionExpired);

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
      
      querySnapshot.forEach((docSnap) => {
        fetchedCases.push(docSnap.data() as LitigationCase);
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

  // Auth setup & mobile redirect handler
  useEffect(() => {
    checkRedirectResult().then(async (result) => {
      if (result && result.user) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);

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
    });

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
  }, [fetchCases, fetchProfile, addLog]);

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
      if (result && result.user) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        
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

  const triggerRefresher = async () => {
    if (user) {
      await fetchCases(user.uid);
    }
  };

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
      const caseData = {
        id: trimmedCnr,
        user_id: auth.currentUser.uid,
        client_name: modalClientName.trim(),
        case_title: "Pending Sync",
        court_name: "Pending Sync",
        next_hearing_date: "Pending Sync",
        case_stage: "Pending Sync",
        advocate_notes: "",
        last_updated: new Date().toISOString(),
        last_synced: 'Pending Background Processing'
      };

      const caseDocRef = doc(db, 'cases', trimmedCnr);
      await setDoc(caseDocRef, caseData);

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: trimmedCnr,
        status: 'success',
        message: `Registered new litigation portfolio case matching CNR: ${trimmedCnr}`
      });

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
        const apiErrMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
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

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-terminal-bg flex flex-col items-center justify-center p-6 text-gray-200 selection:bg-gold-amber selection:text-black">
        <div className="absolute inset-0 bg-[radial-gradient(#2a2a2a_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none"></div>

        <div className="max-w-md w-full relative space-y-8 z-10">
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

          <div className="bg-terminal-surface border border-terminal-border rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-1.5 border-b border-terminal-border/60 pb-5">
              <h2 className="text-sm font-mono font-medium text-gray-400">SESSION AUTHENTICATION</h2>
              <p className="text-xs text-gray-500">Sign in using verified advocate accounts</p>
            </div>

            <div className="space-y-4">
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
                <span>{isLoggingIn ? 'Redirecting to Google...' : 'Sign in with Google'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-terminal-bg text-gray-200 overflow-hidden font-sans">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout}
        casesCount={cases.length}
        user={user}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-terminal-border/80 bg-terminal-surface/50 backdrop-blur px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="font-display font-semibold text-lg text-white capitalize tracking-wide">
              {activeTab} Management
            </h2>
          </div>

          <div className="flex items-center gap-4
