const WORKER_URL = 'https://your-worker.workers.dev';

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin === location.origin) {
        return;
    }
    const proxyUrl = WORKER_URL + '/proxy?url=' + encodeURIComponent(event.request.url);
    event.respondWith(fetch(proxyUrl, {
        headers: event.request.headers
    }));
});
