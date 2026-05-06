const DB_NAME = 'serfx_index';
let db;

async function openDB() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('pages')) {
                db.createObjectStore('pages', { keyPath: 'url' });
            }
        };
        req.onsuccess = e => { db = e.target.result; res(db); };
        req.onerror = rej;
    });
}

async function loadFromJSON() {
    try {
        const resp = await fetch('../data/index.json');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!db) await openDB();
        const tx = db.transaction('pages', 'readwrite');
        const store = tx.objectStore('pages');
        data.forEach(doc => store.put(doc));
        return new Promise(r => { tx.oncomplete = r; });
    } catch {}
}

export async function initEngine() {
    await openDB();
    await loadFromJSON();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('../sw/sw.js').catch(() => {});
    }
}

export async function addPage(url, title, text, links) {
    if (!db) await openDB();
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
    const tokenCount = tokens.length;
    const doc = {
        url,
        title,
        text: text.substring(0, 300),
        tokenCount,
        tokens: tokens.join(','),
        links: JSON.stringify(links || []),
        domain: new URL(url).hostname,
        crawledAt: new Date().toISOString()
    };
    const tx = db.transaction('pages', 'readwrite');
    tx.objectStore('pages').put(doc);
    return new Promise(r => { tx.oncomplete = r; });
}

export async function getAllPages() {
    if (!db) await openDB();
    const tx = db.transaction('pages', 'readonly');
    const store = tx.objectStore('pages');
    return new Promise(r => {
        const req = store.getAll();
        req.onsuccess = () => r(req.result || []);
    });
}
