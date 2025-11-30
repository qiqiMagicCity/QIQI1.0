'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';
type ThemeColor = 'green' | 'blue' | 'violet' | 'orange';

interface ThemeContextValue {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
    color: ThemeColor;
    setColor: (color: ThemeColor) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>('dark');
    const [color, setColorState] = useState<ThemeColor>('green');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const savedMode = localStorage.getItem('theme-mode') as ThemeMode;
        const savedColor = localStorage.getItem('theme-color') as ThemeColor;
        if (savedMode) setModeState(savedMode);
        if (savedColor) setColorState(savedColor);
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;
        localStorage.setItem('theme-mode', mode);
        localStorage.setItem('theme-color', color);

        const root = document.documentElement;

        // Handle Mode
        root.classList.remove('light', 'dark');
        let effectiveMode = mode;
        if (mode === 'system') {
            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            effectiveMode = systemDark ? 'dark' : 'light';
        }
        root.classList.add(effectiveMode);

        // Handle Color
        root.setAttribute('data-theme', color);

    }, [mode, color, mounted]);

    // Listen for system theme changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            if (mode === 'system') {
                const root = document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(mediaQuery.matches ? 'dark' : 'light');
            }
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [mode]);

    const setMode = (newMode: ThemeMode) => {
        setModeState(newMode);
    };

    const setColor = (newColor: ThemeColor) => {
        setColorState(newColor);
    };

    // Prevent hydration mismatch by not rendering children until mounted? 
    // No, we should render children but maybe suppress effects.
    // Actually, for themes, it's better to render to avoid flash, but we might get a flash of wrong theme.
    // We'll accept that for now or use a script in head (advanced).
    // For this task, useEffect is fine.

    return (
        <ThemeContext.Provider value={{ mode, setMode, color, setColor }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
