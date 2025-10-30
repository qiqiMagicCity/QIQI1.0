
"use client";

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

type TimeZoneOption = {
  label: string;
  timeZone: string;
};

const timeZones: TimeZoneOption[] = [
  { label: '马德里', timeZone: 'Europe/Madrid' },
  { label: '上海', timeZone: 'Asia/Shanghai' },
  { label: '纽约', timeZone: 'America/New_York' },
];

const TimeDisplay = ({ label, timeZone }: TimeZoneOption) => {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateClock = () => {
      const formattedTime = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: timeZone,
      }).format(new Date());
      setTime(formattedTime);
    };
    
    updateClock();
    const timerId = setInterval(updateClock, 1000);

    return () => clearInterval(timerId);
  }, [timeZone]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground font-mono">{time}</span>
    </div>
  );
};

export function WorldClocks() {
  return (
    <div className="flex items-center gap-4">
        <div className="w-10 h-10 flex items-center justify-center bg-primary rounded-lg text-primary-foreground shadow-md">
            <Clock className="w-6 h-6" />
        </div>
        <div className="hidden md:flex items-center gap-4">
            {timeZones.map((tz) => (
                <TimeDisplay key={tz.timeZone} label={tz.label} timeZone={tz.timeZone} />
            ))}
        </div>
    </div>
  );
}
