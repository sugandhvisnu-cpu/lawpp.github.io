import React, { useState, useEffect, useCallback } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
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
import HeaderClock from './components/HeaderClock';
import { fetchLiveCourtData } from './services/courtApi';
import { syncCaseToGoogleCalendar } from './utils/calendarSync';
import { useStrictAuthSession } from './hooks/useStrictAuthSession';
import { Plus, X } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [barId, setBarId] = useState<string>('');
  const [cases, setCases] = useState<LitigationCase[]>([]);
  const [activeTab, setActiveTab] = useState<'calendar' | 'portfolio' | 'settings'>('calendar');
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);

  // Add Case Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [modalCnr, setModalCnr] = useState<string>('');
  const [modalClientName, setModalClientName] = useState<string>('');
  const [modalIsSubmitting, setModalIsSubmitting] = useState<boolean>(false);
  const [modalStatusMsg, setModalStatusMsg] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });

  const addLog = useCallback((log: SyncLog) => {
    console.log(`[${log.status.toUpperCase()}] ${log.cnr}: ${log.message}`);
  }, []);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
  }, []);

  useStrictAuthSession(user, handleSessionExpired);

  const fetchProfile = useCallback(async (uid: string) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userSnapshot = await getDoc(userDocRef);
      if (userSnapshot.exists()) {
        setBarId(userSnapshot.data().bar_id || '');
      } else {
        setBarId('');
        setActiveTab('settings');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    }
  }, []);

  const fetchCases = useCallback(async (uid: string) => {
    setIsLoadingData(true);
    try {
      const q = query(collection(db, 'cases'), where('user_id', '==', uid));
      const querySnapshot = await getDocsFromServer(q);
      const fetched: LitigationCase[] = [];
      querySnapshot.forEach((docSnap) => fetched.push(docSnap.data() as LitigationCase));
      setCases(fetched);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'cases');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setCases([]);
      return;
    }
    const q = query(collection(db, 'cases'), where('user_id', '==', user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched: LitigationCase[] = [];
        snapshot.forEach((docSnap) => fetched.push(docSnap.data() as LitigationCase));
        setCases(fetched);
        setIsLoadingData(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'cases');
        setIsLoadingData(false);
      }
    );
    return () => unsubscribe();
  }, [user?.uid]);

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
        await fetchProfile(loggedInUser.uid);
        await fetchCases(loggedInUser.uid);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, [fetchCases, fetchProfile]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
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
      console.error('Sign-in failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setCases([]);
    setBarId('');
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
  };

  const triggerRefresher = async () => {
    if (user) await fetchCases(user.uid);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalStatusMsg({ type: '', text: '' });
    const trimmedCnr = modalCnr.trim().toUpperCase();

    if (trimmedCnr.length !== 16 || !/^[a-zA-Z0-9]+$/.test(trimmedCnr)) {
      setModalStatusMsg({ type: 'error', text: 'CNR must be 16 alphanumeric characters.' });
      return;
    }
    if (!modalClientName.trim()) {
      setModalStatusMsg({ type: 'error', text: 'Please specify client name or tags.' });
      return;
    }
    if (!user || !auth.currentUser) {
      setModalStatusMsg({ type: 'error', text: 'You must be authenticated first.' });
      return;
    }

    setModalIsSubmitting(true);
    try {
      const caseDocRef = doc(db, 'cases', trimmedCnr);
      const initialCaseData = {
        id: trimmedCnr,
        user_id: auth.currentUser.uid,
        client_name: modalClientName.trim(),
        case_title: 'Pending Sync',
        court_name: 'Pending Sync',
        next_hearing_date: 'Pending Sync',
        case_stage: 'Pending Sync',
        advocate_notes: '',
        last_updated: new Date().toISOString(),
        last_synced: 'Synchronizing...'
      };
      await setDoc(caseDocRef, initialCaseData);
      await fetchCases(auth.currentUser.uid);

      try {
        const liveData = await fetchLiveCourtData(trimmedCnr);
        const petName = liveData.petitioner_name || liveData.petitioner || 'Information Unavailable';
        const resName = liveData.respondent_name || 'Information Unavailable';
        const formattedTitle = (petName !== 'Information Unavailable' && resName !== 'Information Unavailable')
          ? `${petName} v. ${resName}`
          : (liveData.case_title || 'Live Litigation Matter');

        const updatedData = {
          ...initialCaseData,
          title: formattedTitle,
          case_title: formattedTitle,
          court_name: liveData.court_name || 'District/High Court',
          next_hearing_date: liveData.next_hearing_date || 'Not Scheduled',
          case_stage: liveData.case_stage || 'Live Status Active',
          petitioner: petName,
          petitioner_name: petName,
          respondent: resName,
          respondent_name: resName,
          cause_list_cnr_check: liveData.cause_list_cnr_check || 'No',
          status: 'synced',
          syncStatus: 'completed',
          last_synced: 'Synchronized',
          last_updated: new Date().toISOString()
        };
        await setDoc(caseDocRef, updatedData, { merge: true });

        if (accessToken) {
          await syncCaseToGoogleCalendar(updatedData, accessToken, addLog);
        }
        setModalStatusMsg({ type: 'success', text: `Matter ${trimmedCnr} synchronized!` });
      } catch (err: any) {
        await setDoc(caseDocRef, {
          title: 'Fetch Failed (Retry)',
          case_title: 'Fetch Failed (Retry)',
          last_synced: 'Sync Failed',
          status: 'failed',
          syncStatus: 'failed',
          last_updated: new Date().toISOString()
        }, { merge: true });
        setModalStatusMsg({ type: 'error', text: `Sync failed: ${err?.message || err}` });
      }

      setTimeout(() => {
        setIsAddModalOpen(false);
        setModalCnr('');
        setModalClientName('');
        setModalStatusMsg({ type: '', text: '' });
      }, 1500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `cases/${trimmedCnr}`);
    } finally {
      setModalIsSubmitting(false);
    }
  };

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-gray-200">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500 text-black font-bold text-3xl flex items-center justify-center mx-auto shadow-lg">
            L
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-wider">
              LAW<span className="text-amber-500">PP</span>
            </h1>
            <p className="text-xs text-amber-500 font-mono uppercase tracking-widest mt-1">
              Indian Litigation Terminal & Sync
            </p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-xl space-y-4">
            <p className="text-xs text-gray-400">Sign in with verified advocate account</p>
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 bg-neutral-800 border border-neutral-700 hover:border-amber-500 rounded-lg p-3.5 text-sm font-semibold text-white transition-all"
            >
              <span>{isLoggingIn ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-neutral-950 text-gray-200 overflow-hidden font-sans">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout}
        casesCount={cases.length}
        user={user}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur px-6 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-lg text-white capitalize">{activeTab} Management</h2>
          <div className="flex items-center gap-4">
            <HeaderClock />
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-lg font-medium text-xs tracking-wide uppercase transition-all shadow-lg"
            >
              <Plus className="w-4 h-4" />
              <span>Track New Case</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'calendar' && (
            <DashboardCalendar cases={cases} isLoading={isLoadingData} onRefresh={triggerRefresher} />
          )}
          {activeTab === 'portfolio' && (
            <PortfolioManager cases={cases} isLoading={isLoadingData} onRefresh={triggerRefresher} onOpenAddModal={() => setIsAddModalOpen(true)} />
          )}
          {activeTab === 'settings' && (
            <ProfileSettings user={user} currentBarId={barId} onProfileUpdated={fetchProfile} />
          )}
        </main>
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="font-bold text-white text-sm">Add Case by CNR</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">16-Digit CNR Number</label>
                <input
                  type="text"
                  maxLength={16}
                  value={modalCnr}
                  onChange={(e) => setModalCnr(e.target.value)}
                  placeholder="e.g. DLHC010000002026"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-white focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Client Name / Tag</label>
                <input
                  type="text"
                  value={modalClientName}
                  onChange={(e) => setModalClientName(e.target.value)}
                  placeholder="e.g. State v. Sharma"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              {modalStatusMsg.text && (
                <div className={`p-2.5 rounded-lg text-xs font-mono ${modalStatusMsg.type === 'error' ? 'bg-red-950 border border-red-800 text-red-400' : 'bg-green-950 border border-green-800 text-green-400'}`}>
                  {modalStatusMsg.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalIsSubmitting}
                  className="bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all"
                >
                  {modalIsSubmitting ? 'Syncing...' : 'Register Matter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
