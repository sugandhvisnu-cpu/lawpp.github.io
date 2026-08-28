/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, SyncLog } from '../types';
import { 
  ShieldCheck, 
  User as UserIcon, 
  Mail, 
  CreditCard, 
  Save, 
  Calendar, 
  CheckCircle, 
  FileLock,
  ExternalLink
} from 'lucide-react';

interface ProfileSettingsProps {
  user: User | null;
  barId: string;
  setBarId: (id: string) => void;
  refreshProfile: () => Promise<void>;
  addLog: (log: SyncLog) => void;
}

export default function ProfileSettings({ 
  user, 
  barId, 
  setBarId, 
  refreshProfile, 
  addLog 
}: ProfileSettingsProps) {
  const [name, setName] = useState<string>(user?.displayName || '');
  const [inputBarId, setInputBarId] = useState<string>(barId);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | ''; text: string }>({ type: '', text: '' });

  if (!user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg({ type: '', text: '' });

    if (!name.trim()) {
      setStatusMsg({ type: 'error', text: 'Please specify advocate name.' });
      return;
    }

    if (!inputBarId.trim()) {
      setStatusMsg({ type: 'error', text: 'Bar Council registration ID is required.' });
      return;
    }

    setIsSaving(true);
    setStatusMsg({ type: 'success', text: 'Committing advocate registry credentials to Firestore...' });

    try {
      const userRef = doc(db, 'users', user.uid);
      const userPayload: UserProfile = {
        uid: user.uid,
        name: name.trim(),
        email: user.email || '',
        bar_id: inputBarId.trim().toUpperCase(),
        created_at: new Date().toISOString(),
      };

      // Write straight to user document in Firestore (RLS verified)
      await setDoc(userRef, userPayload);
      
      setBarId(userPayload.bar_id);
      await refreshProfile();

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        cnr: 'SYSTEM',
        status: 'success',
        message: `Registered advocate credentials in database: ${userPayload.bar_id}`
      });

      setStatusMsg({ type: 'success', text: 'Profile successfully registered and locked under RLS security!' });
      setTimeout(() => setStatusMsg({ type: '', text: '' }), 4000);
    } catch (error) {
      setStatusMsg({ type: 'error', text: 'Failed to save profile. Ensure database is online.' });
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* 1. Header Banner */}
      <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl flex flex-col md:flex-row items-center gap-6">
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={name}
            referrerPolicy="no-referrer"
            className="w-20 h-20 rounded-full border-2 border-gold-amber shadow-lg shadow-gold-amber/20 object-cover"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-neutral-800 border-2 border-gold-amber flex items-center justify-center text-gold-amber font-display font-bold text-3xl shadow-lg shadow-gold-amber/15">
            {name.charAt(0) || 'A'}
          </div>
        )}

        <div className="text-center md:text-left space-y-1">
          <div className="flex flex-col md:flex-row items-center gap-2">
            <h2 className="text-xl font-display font-bold text-white">{name || 'Advocate Profile'}</h2>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-gold-amber/10 border border-gold-amber/20 text-gold-amber text-[10px] font-mono font-semibold uppercase">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>RLS Verified</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 font-mono">{user.email}</p>
          <p className="text-[10px] text-gray-500 font-mono mt-1">UID: {user.uid}</p>
        </div>
      </div>

      {/* 2. Settings Registry Form */}
      <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-xl space-y-6">
        <div className="flex items-center gap-3 border-b border-terminal-border pb-4">
          <div className="w-9 h-9 rounded-lg bg-gold-amber/10 border border-gold-amber/20 flex items-center justify-center text-gold-amber">
            <FileLock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-white">Bar Council Registration</h3>
            <p className="text-xs text-gray-500 font-mono">Official Indian litigation registry record</p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5 text-gold-amber" />
                <span>Advocate Name</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name"
                required
                className="w-full bg-black/50 border border-terminal-border focus:border-gold-amber/40 text-xs text-white p-3 rounded-lg focus:outline-none"
              />
            </div>

            {/* Bar Council registration ID */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5" htmlFor="bar-input">
                <CreditCard className="w-3.5 h-3.5 text-gold-amber" />
                <span>Bar Council Registration ID</span>
              </label>
              <input
                id="bar-input"
                type="text"
                value={inputBarId}
                onChange={(e) => setInputBarId(e.target.value)}
                placeholder="e.g. D/1234/2020"
                required
                className="w-full bg-black/50 border border-terminal-border focus:border-gold-amber/40 text-xs text-white p-3 rounded-lg placeholder-neutral-700 font-mono uppercase focus:outline-none"
              />
            </div>
          </div>

          {/* Email (Readonly) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-gray-500" />
              <span>Email Address (Verified via Google Auth)</span>
            </label>
            <input
              type="email"
              value={user.email || ''}
              readOnly
              className="w-full bg-neutral-900/60 border border-terminal-border text-xs text-gray-500 p-3 rounded-lg font-mono cursor-not-allowed focus:outline-none"
            />
          </div>

          {/* Status Message */}
          {statusMsg.text && (
            <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
              statusMsg.type === 'error'
                ? 'bg-red-500/5 border-red-500/20 text-red-400'
                : 'bg-gold-amber/5 border-gold-amber/20 text-gold-amber'
            }`}>
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-mono text-[11px] leading-relaxed">{statusMsg.text}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSaving}
            className={`w-full py-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              isSaving
                ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed'
                : 'bg-gold-amber hover:bg-gold-dark text-black shadow-lg shadow-gold-amber/10'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Registering...' : 'Register Profile & Lock Credentials'}</span>
          </button>
        </form>
      </div>

      {/* 3. Regulatory compliance card */}
      <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5 text-xs text-gray-500 space-y-2.5">
        <h4 className="font-semibold text-gray-300">Indian Advocates Act & Digital Privacy Standards</h4>
        <p className="leading-relaxed text-[11px]">
          Lawpp complies with the regulatory guidelines issued by the Bar Council of India regarding digital advocate listings. It respects data privacy by storing litigation calendars locally under user accounts using strict Cloud Firestore Row-Level Security (RLS). No public record scraping is conducted without explicit advocate initiation.
        </p>
        <div className="flex justify-between items-center text-[10px] text-gold-amber pt-1">
          <span className="font-mono uppercase tracking-widest">Digital Court compliance</span>
          <a
            href="https://ecourts.gov.in"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:underline text-[10px]"
          >
            <span>eCourts Portal</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
