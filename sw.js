const BYPASS_METHODS = {
    DIRECT: 'direct',
    REWRITE: 'rewrite',
    XHR: 'xhr'
};

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    if (url.pathname === '/proxy' && url.searchParams.has('url')) {
        event.respondWith(handleProxyRequest(url.searchParams.get('url'), event.request));
        return;
    }

    if (url.origin === location.origin) {
        return;
    }
});

async function handleProxyRequest(targetUrl, originalRequest) {
    let response;
    let method = BYPASS_METHODS.DIRECT;

    try {
        response = await fetch(targetUrl, {
            method: originalRequest.method,
            headers: cleanHeaders(originalRequest.headers),
            body: originalRequest.method !== 'GET' && originalRequest.method !== 'HEAD' ? originalRequest.body : undefined,
            redirect: 'manual',
            mode: 'cors',
            credentials: 'omit'
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (location) {
                const newUrl = new URL(location, targetUrl).href;
                return Response.redirect('/proxy?url=' + encodeURIComponent(newUrl), response.status);
            }
        }

        const contentType = response.headers.get('Content-Type') || '';
        const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');

        if (isHtml) {
            method = BYPASS_METHODS.REWRITE;
            let body = await response.text();
            body = rewriteHtml(body, targetUrl);
            
            const headers = new Headers(response.headers);
            headers.set('Content-Type', 'text/html');
            headers.set('X-Frame-Options', 'SAMEORIGIN');
            headers.delete('Content-Security-Policy');
            headers.delete('X-Content-Type-Options');
            headers.delete('Strict-Transport-Security');
            
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });
        }

        if (!isHtml) {
            const headers = new Headers(response.headers);
            headers.set('Access-Control-Allow-Origin', '*');
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });
        }
    } catch (error) {
        if (method === BYPASS_METHODS.DIRECT) {
            try {
                const xhrResponse = await fetch('/fetch/' + encodeURIComponent(targetUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'url=' + encodeURIComponent(targetUrl)
                });
                if (xhrResponse.ok) {
                    return xhrResponse;
                }
            } catch (xhrError) {
                console.error('Bypass method 2 failed:', xhrError);
            }
        }
        return new Response('Proxy error: ' + error.message, { status: 502 });
    }
}

function cleanHeaders(headers) {
    const clean = new Headers();
    const allowedHeaders = ['accept', 'accept-language', 'content-type', 'user-agent', 'cache-control'];
    for (let [key, value] of headers.entries()) {
        if (allowedHeaders.includes(key.toLowerCase())) {
            clean.set(key, value);
        }
    }
    if (!clean.has('User-Agent')) {
        clean.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    }
    return clean;
}

function rewriteHtml(html, baseUrl) {
    const baseObj = new URL(baseUrl);
    
    html = html.replace(/<head[^>]*>/i, (match) => {
        return match + `<base href="${baseUrl}"><script>window.top.location = window.location;</script>`;
    });

    html = html.replace(/(href|src|action|content)\s*=\s*["']([^"']+)["']/gi, (match, attr, link) => {
        try {
            if (link.startsWith('data:') || link.startsWith('blob:') || link.startsWith('#') || link.startsWith('javascript:')) {
                return match;
            }
            const absoluteUrl = new URL(link, baseObj.origin).href;
            if (attr === 'href' && link.startsWith('http')) {
                return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
            }
            return `${attr}="${absoluteUrl}"`;
        } catch {
            return match;
        }
    });

    html = html.replace(/(url\s*\(\s*["']?)([^"')]+)(["']?\s*\))/gi, (match, prefix, link, suffix) => {
        try {
            if (link.startsWith('data:')) return match;
            const absoluteUrl = new URL(link, baseObj.origin).href;
            return `${prefix}/proxy?url=${encodeURIComponent(absoluteUrl)}${suffix}`;
        } catch {
            return match;
        }
    });

    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, (scriptTag) => {
        scriptTag = scriptTag.replace(/window\.location\s*=\s*["']([^"']+)["']/gi, (m, url) => {
            return `window.location = "/proxy?url=${encodeURIComponent(url)}"`;
        });
        return scriptTag;
    });

    const injectionScript = `
        <script>
        (function() {
            const originalAssign = window.location.assign;
            window.location.assign = function(url) {
                const proxyUrl = '/proxy?url=' + encodeURIComponent(url);
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({type: 'navigate', url: url}, '*');
                }
                return originalAssign.call(window.location, proxyUrl);
            };
            window.open = function(url) {
                const proxyUrl = '/proxy?url=' + encodeURIComponent(url);
                return originalOpen.call(window, proxyUrl);
            };
        })();
        </script>
    `;

    html = html.replace('</body>', injectionScript + '</body>');
    return html;
}
