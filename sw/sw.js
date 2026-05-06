self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.pathname === '/proxy') {
        const target = url.searchParams.get('url');
        if (target) {
            event.respondWith(fetch(target));
            return;
        }
    }
    event.respondWith(fetch(event.request));
});
