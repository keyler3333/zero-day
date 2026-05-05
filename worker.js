addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === '/proxy') {
        const target = url.searchParams.get('url');
        if (!target) return new Response('Missing ?url', { status: 400 });
        return proxy(target, request);
    }
    return new Response('SERF/X worker – ok', { status: 200 });
}

async function proxy(targetUrl, originalRequest) {
    try {
        const response = await fetch(targetUrl, {
            headers: {
                ...originalRequest.headers,
                'Referer': '',
                'Origin': '',
            },
            redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
            const loc = response.headers.get('Location');
            if (loc) {
                const newLoc = new URL(loc, targetUrl).href;
                return new Response(null, {
                    status: response.status,
                    headers: { Location: '/proxy?url=' + encodeURIComponent(newLoc) }
                });
            }
        }

        const headers = new Headers(response.headers);
        headers.set('X-Frame-Options', 'SAMEORIGIN');
        headers.delete('Content-Security-Policy');
        headers.delete('X-Content-Type-Options');

        let body = await response.text();
        body = body.replace(/(href|src|action)\s*=\s*["'](https?:\/\/[^"']+)["']/gi, (match, attr, link) => {
            try {
                const newLink = new URL(link, targetUrl).href;
                return `${attr}="/proxy?url=${encodeURIComponent(newLink)}"`;
            } catch { return match; }
        });

        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
        });
    } catch (e) {
        return new Response('Proxy error: ' + e.message, { status: 502 });
    }
}
