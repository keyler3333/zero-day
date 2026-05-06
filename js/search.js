import { getAllPages } from './engine.js';

let invertIdx = {};
let docsMap = {};
let totalDocs = 0;
let avgDocLen = 100;
let ready = false;

export async function initSearch() {
    const pages = await getAllPages();
    docsMap = {};
    pages.forEach(doc => { docsMap[doc.url] = doc; });
    totalDocs = pages.length;
    let totalLen = 0;
    pages.forEach(doc => totalLen += doc.tokenCount || 100);
    avgDocLen = totalDocs > 0 ? totalLen / totalDocs : 100;
    rebuildInvert(pages);
    ready = true;
}

function rebuildInvert(pages) {
    invertIdx = {};
    pages.forEach(doc => {
        const tokens = (doc.tokens || '').split(',');
        const counts = {};
        tokens.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        Object.entries(counts).forEach(([term, tf]) => {
            if (!invertIdx[term]) invertIdx[term] = {};
            invertIdx[term][doc.url] = tf;
        });
    });
}

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

export function search(query) {
    if (!ready) return { results: [] };
    const tokens = tokenize(query);
    const scored = {};
    tokens.forEach(term => {
        const postings = invertIdx[term];
        if (!postings) return;
        const df = Object.keys(postings).length;
        const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
        Object.entries(postings).forEach(([docUrl, rawTf]) => {
            const doc = docsMap[docUrl];
            if (!doc) return;
            const len = doc.tokenCount || 100;
            const norm = (rawTf * 2.5) / (rawTf + 1.5 * (1 - 0.75 + 0.75 * len / avgDocLen));
            scored[docUrl] = (scored[docUrl] || 0) + idf * norm;
        });
    });
    const results = Object.entries(scored)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([url, score]) => ({ ...docsMap[url], score: Math.round(score * 100) / 100 }));
    return { results };
}
