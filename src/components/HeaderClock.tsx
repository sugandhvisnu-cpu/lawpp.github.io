import React, { useState, useEffect } from 'react';

export default function HeaderClock() {
  const [timeString, setTimeString] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      
      // Indian standard locale formatting (en-IN)
      const datePart = now.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      const timePart = now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      setTimeString(`${datePart} ${timePart}`);
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="font-mono bg-black/55 py-1.5 px-3 rounded border border-terminal-border text-[11px] hidden sm:block">
      <span className="text-gray-500 font-semibold mr-1.5">TIME:</span>
      <span className="text-gold-amber">{timeString || 'Initializing...'}</span>
    </div>
  );
}
