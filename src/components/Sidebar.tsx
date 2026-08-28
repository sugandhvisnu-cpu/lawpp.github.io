/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Calendar, Briefcase, Settings, LogOut, ShieldAlert } from 'lucide-react';
import { User } from 'firebase/auth';

interface SidebarProps {
  activeTab: 'calendar' | 'portfolio' | 'settings';
  setActiveTab: (tab: 'calendar' | 'portfolio' | 'settings') => void;
  user: User | null;
  onLogout: () => void;
  barId: string;
}

export default function Sidebar({ activeTab, setActiveTab, user, onLogout, barId }: SidebarProps) {
  return (
    <aside className="w-64 bg-black border-r border-zinc-800 flex flex-col h-screen sticky top-0 shrink-0 pt-safe pb-safe pl-safe">
      {/* Brand Header */}
      <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="font-display font-extrabold text-2xl tracking-tighter text-[#FFC107]">
            LAWPP<span className="text-white">.</span>
          </h1>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mt-1">
            Advocate Master Terminal
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'calendar'
              ? 'bg-[#FFC107] text-black shadow-lg shadow-gold-amber/15'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Calendar className="w-5 h-5 shrink-0" />
          <span>Dashboard Calendar</span>
        </button>

        <button
          onClick={() => setActiveTab('portfolio')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'portfolio'
              ? 'bg-[#FFC107] text-black shadow-lg shadow-gold-amber/15'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Briefcase className="w-5 h-5 shrink-0" />
          <span>Portfolio Manager</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-[#FFC107] text-black shadow-lg shadow-gold-amber/15'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Settings className="w-5 h-5 shrink-0" />
          <span>Profile Settings</span>
        </button>
      </nav>

      {/* Sync State Alert Panel in Margin */}
      <div className="mx-4 p-4 rounded-xl bg-zinc-950 border border-zinc-800 mb-4">
        <div className="flex gap-2 items-start text-xs text-zinc-400">
          <ShieldAlert className="w-4 h-4 text-[#FFC107] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-zinc-300">CNR Security Lock</p>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Direct RLS enforced. No government credentials requested or stored.
            </p>
          </div>
        </div>
      </div>

      {/* Advocate User info and logout footer */}
      {user && (
        <div className="p-6 border-t border-zinc-800 bg-zinc-950/40 flex flex-col gap-3">
          <div className="flex items-center gap-3 overflow-hidden">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'Advocate'}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full border border-zinc-700 object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[#FFC107] shrink-0 font-bold">
                AM
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{user.displayName || 'Adv. Malhotra'}</p>
              <p className="text-[10px] text-zinc-500 truncate font-mono">{user.email}</p>
              {barId && (
                <p className="text-[9px] text-[#FFC107] font-mono mt-0.5 uppercase tracking-wider truncate">
                  Bar: {barId}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded transition-all duration-200 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </aside>
  );
}
