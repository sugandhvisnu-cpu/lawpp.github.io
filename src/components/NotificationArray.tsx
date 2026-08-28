/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LitigationCase } from '../types';
import { ShieldAlert, Bell, Calendar, Check, ArrowRight, Hourglass } from 'lucide-react';
import { getCaseDisplayTitle } from '../utils/caseDisplay';

interface NotificationArrayProps {
  cases: LitigationCase[];
  accessToken: string | null;
}

export default function NotificationArray({ cases, accessToken }: NotificationArrayProps) {
  // Pivot reference date: July 1st, 2026 as per local time metadata
  const referenceDateStr = '2026-07-01';
  const referenceDate = new Date(referenceDateStr + 'T00:00:00');

  // Calculates days difference
  const getDaysDiff = (dateStr: string): number => {
    const targetDate = new Date(dateStr + 'T00:00:00');
    const diffTime = targetDate.getTime() - referenceDate.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Find all cases where hearing is within 1 to 3 days from July 1st, 2026
  const alertCases = cases.filter(c => {
    const diff = getDaysDiff(c.next_hearing_date);
    return diff >= 1 && diff <= 3;
  });

  if (alertCases.length === 0) return null;

  return (
    <div className="px-6 pb-2 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4 text-gold-amber animate-bounce" />
        <h3 className="font-display font-semibold text-sm text-white uppercase tracking-wider">
          Regulatory Action Board ({alertCases.length} Critical Matter{alertCases.length > 1 ? 's' : ''})
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {alertCases.map(c => {
          const diff = getDaysDiff(c.next_hearing_date);
          let alertText = '';
          let benchmarkLabel = '';

          // Determine regulatory benchmarks according to System Processing Law
          if (diff === 3) {
            benchmarkLabel = 'T-Minus 3 Days';
            alertText = 'Initial Case Prep Alert Generated';
          } else if (diff === 2) {
            benchmarkLabel = 'T-Minus 2 Days';
            alertText = 'Review Written Submissions Checklist';
          } else if (diff === 1) {
            benchmarkLabel = 'T-Minus 1 Day';
            alertText = 'Cause List Item Number Released';
          }

          const deliveryStatus = accessToken ? 'Ready' : 'Syncing to Calendar Channel';

          return (
            <div 
              key={c.id} 
              className={`p-4 rounded-xl border flex flex-col justify-between gap-4 transition-all duration-200 ${
                diff === 1 
                  ? 'bg-red-500/5 border-red-500/30 shadow-lg shadow-red-500/5'
                  : diff === 2
                  ? 'bg-orange-500/5 border-orange-500/25'
                  : 'bg-gold-amber/5 border-gold-amber/20'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    diff === 1 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/20' 
                      : diff === 2 
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/20'
                      : 'bg-gold-amber/20 text-gold-amber border border-gold-amber/20'
                  }`}>
                    {benchmarkLabel}
                  </span>
                  
                  {/* Delivery Status Indicator */}
                  <span className="flex items-center gap-1 font-mono text-[9px] text-gray-400">
                    {deliveryStatus === 'Ready' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400 font-bold" />
                        <span className="text-emerald-400 font-semibold uppercase">Ready</span>
                      </>
                    ) : (
                      <>
                        <Hourglass className="w-3 h-3 text-gold-amber animate-spin" style={{ animationDuration: '3s' }} />
                        <span className="text-gold-amber font-semibold uppercase">Syncing to Calendar Channel</span>
                      </>
                    )}
                  </span>
                </div>

                <h4 className="text-sm font-semibold text-white leading-snug font-display">
                  {getCaseDisplayTitle(c)}
                </h4>
                <p className="text-xs text-gold-amber/90 font-medium mt-1">
                  Client Tag: {c.client_name}
                </p>
                <p className="text-[11px] text-gray-300 mt-2 font-mono flex items-center gap-1 bg-black/30 px-2 py-1.5 rounded border border-terminal-border/40">
                  <ShieldAlert className="w-3.5 h-3.5 text-gold-amber shrink-0" />
                  <span>{alertText}</span>
                </p>
              </div>

              <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono border-t border-terminal-border/30 pt-2">
                <span>Hearing: {c.next_hearing_date}</span>
                <span className="flex items-center gap-0.5">
                  <span>CNR: {c.id.substring(0, 6)}...</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
