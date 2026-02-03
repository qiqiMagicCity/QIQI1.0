import { useState, useEffect } from 'react';
import {
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    addDoc,
    serverTimestamp,
    Timestamp,
    deleteDoc,
    doc
} from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';

export interface SystemNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    createdAt: Timestamp | null;
    createdBy?: string;
}

export function useNotifications() {
    const db = useFirestore();
    const { user, isAdmin } = useUser();
    const [notifications, setNotifications] = useState<SystemNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [lastReadTime, setLastReadTime] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    // 1. Load Last Read Time from LocalStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('last_read_notification_time');
            if (stored) {
                setLastReadTime(parseInt(stored, 10));
            }
        }
    }, []);

    // 2. Listen to Firestore
    useEffect(() => {
        if (!db) return;

        // Fetch latest 20 notifications
        const q = query(
            collection(db, 'system_notifications'),
            orderBy('createdAt', 'desc'),
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docs = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            } as SystemNotification));
            setNotifications(docs);
            setLoading(false);
        }, (err) => {
            console.error("Failed to subscribe to notifications:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db]);

    // 3. Calculate Unread Count
    useEffect(() => {
        if (!notifications.length) {
            setUnreadCount(0);
            return;
        }

        // Count how many are newer than lastReadTime
        const count = notifications.filter(n => {
            if (!n.createdAt) return false;
            const t = n.createdAt.toMillis ? n.createdAt.toMillis() : 0;
            return t > lastReadTime;
        }).length;

        setUnreadCount(count);
    }, [notifications, lastReadTime]);

    // Actions
    const markAllAsRead = () => {
        const now = Date.now();
        setLastReadTime(now);
        localStorage.setItem('last_read_notification_time', now.toString());
        setUnreadCount(0);
    };

    const sendNotification = async (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
        if (!isAdmin || !user || !db) throw new Error('Unauthorized');

        await addDoc(collection(db, 'system_notifications'), {
            title,
            message,
            type,
            createdAt: serverTimestamp(),
            createdBy: user.uid
        });
    };

    const deleteNotification = async (id: string) => {
        if (!isAdmin || !db) throw new Error('Unauthorized');
        await deleteDoc(doc(db, 'system_notifications', id));
    };

    return {
        notifications,
        unreadCount,
        loading,
        markAllAsRead,
        sendNotification,
        deleteNotification
    };
}
