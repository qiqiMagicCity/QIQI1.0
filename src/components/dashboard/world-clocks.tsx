"use client";

import { useState, useEffect } from 'react';
import { nyWeekdayLabel, formatHmsForZone } from '@/lib/ny-time';

type TimeZoneOption = {
  label: string;
  timeZone: string;
  fontClass: string;
};

const timeZones: TimeZoneOption[] = [
  { label: '瓦伦西亚', timeZone: 'Europe/Madrid', fontClass: 'font-kai' },
  { label: '上海', timeZone: 'Asia/Shanghai', fontClass: 'font-kai' },
  { label: '纽约', timeZone: 'America/New_York', fontClass: 'font-kai' },
];

const TimeDisplay = ({ label, timeZone, fontClass }: TimeZoneOption) => {
  // Initialize with null/empty to avoid server/client hydration mismatch
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Set explicit start time on mount
    setNow(new Date());

    const timerId = setInterval(() => {
      // It is acceptable to use new Date() here as the source of "wall clock" tick,
      // because we immediately pass it to timezone-aware formatting functions from ny-time.
      // The violation risk is when new Date() is used for business logic logic (e.g. determining "Today").
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timerId);
  }, []);

  if (!now) {
    // Render placeholder during SSR/Hydration to prevent mismatch
    return (
      <div className="flex items-center gap-2 opacity-0">
        <span className={`text-base text-muted-foreground ${fontClass}`}>{label}</span>
        <span className="text-base font-semibold text-foreground font-mono">--:--:--</span>
      </div>
    );
  }

  const timeStr = formatHmsForZone(now, timeZone);
  const weekday = timeZone === 'America/New_York' ? nyWeekdayLabel(now) : '';

  return (
    <div className="flex items-center gap-2 animate-in fade-in duration-300">
      <span className={`text-base text-muted-foreground ${fontClass}`}>{label}</span>
      <span className="text-base font-semibold text-foreground font-mono">{timeStr}</span>
      {weekday && <span className="text-sm text-muted-foreground font-sans">{weekday}</span>}
    </div>
  );
};

export function WorldClocks() {
  return (
    <div className="hidden md:flex items-center gap-4">
      {timeZones.map((tz) => (
        <TimeDisplay key={tz.timeZone} label={tz.label} timeZone={tz.timeZone} fontClass={tz.fontClass} />
      ))}
    </div>
  );
}
