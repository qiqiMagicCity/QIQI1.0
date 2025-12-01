// Version: 1.0.3
const CACHE_NAME = 'lucky-trading-cache-v1';
const urlsToCache = [
    '/',
    '/manifest.json',
    '/favicon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', (event) => {
    // 排除非 GET 请求 (如 POST)
    if (event.request.method !== 'GET') {
        return;
    }

    // 排除 API 请求 (可选，根据实际路径调整)
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.includes('firestore')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
