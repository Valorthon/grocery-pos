/** Public assets only. Never cache an API/auth response or a receipt. */
export function offlineWorkerSource(assets: string[], version: string): string {
    return `
const CACHE = 'grocery-pos-shell-${version}';
const ASSETS = ${JSON.stringify(assets)};
const PATHS = new Set(ASSETS);
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})))));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('grocery-pos-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (request.mode === 'navigate' && !url.pathname.startsWith('/v1/') && url.pathname !== '/health') {
        event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html'))));
    } else if (PATHS.has(url.pathname)) {
        event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(request)));
    }
});
`;
}
export async function registerOfflineWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('/sw.js', {
            updateViaCache: 'none',
        });
    } catch {
        /* Online POS continues when worker storage is unavailable. */
    }
}
