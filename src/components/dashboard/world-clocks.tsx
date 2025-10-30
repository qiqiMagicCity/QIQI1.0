"use client";

import { useState, useEffect } from 'react';

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
      <span className={`text-base text-muted-foreground ${fontClass}`}>{label}</span>
      <span className="text-base font-semibold text-foreground font-mono">{time}</span>
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
