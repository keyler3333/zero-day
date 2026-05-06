import { search, initSearch } from './search.js';
import { addPage } from './engine.js';

let tabs = [];
let activeTabId = null;
let closedStack = [];
let tabIdCounter = 0;

const frame = document.getElementById('content-frame');
const urlInput = document.getElementById('url-input');
const speedDial = document.getElementById('speed-dial');
const resultsPanel = document.getElementById('results-panel');

let cfg = { proxy: 'none', proxyUrl: '', newtabFocus: true, autocrawl: true };
try { const s = JSON.parse(localStorage.getItem('serfx_cfg')); if (s) Object.assign(cfg, s); } catch(e) {}

function isUrl(s) {
    return /^https?:\/\//i.test(s) || (s.includes('.') && !s.includes(' ') && s.length < 200);
}
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getFaviconUrl(domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function renderTabs() {
    const container = document.getElementById('tabs');
    container.innerHTML = '';
    tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
        el.innerHTML = `<div class="tab-favicon">${tab.favicon ? `<img src="${tab.favicon}" onerror="this.style.display='none'">` : '<div class="fav-fallback"></div>'}</div><div class="tab-title">${escHtml(tab.title)}</div><div class="tab-close">×</div>`;
        el.querySelector('.tab-title').addEventListener('click', () => switchTab(tab.id));
        el.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
        container.appendChild(el);
    });
    const active = getActiveTab();
    if (active) {
        urlInput.value = active.url || '';
        updateNavButtons(active);
    }
}

function updateNavButtons(tab) {
    document.getElementById('back-btn').disabled = tab.historyIndex <= 0;
    document.getElementById('fwd-btn').disabled = tab.historyIndex >= tab.history.length - 1;
}

function showSpeedDial() {
    frame.style.display = 'none';
    resultsPanel.style.display = 'none';
    speedDial.classList.add('visible');
}

function hideSpeedDial() { speedDial.classList.remove('visible'); }

export function getActiveTab() { return tabs.find(t => t.id === activeTabId); }

export function createTab(title, url, activate = true) {
    const id = 't' + (++tabIdCounter) + '_' + Date.now();
    const tab = { id, title: title || 'New Tab', url: url || '', favicon: null, history: [], historyIndex: -1 };
    tabs.push(tab);
    if (activate) activeTabId = id;
    renderTabs();
    if (activate && url) navigate(url, id);
    else if (activate) showSpeedDial();
    return id;
}

export function closeTab(id) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    closedStack.push(tabs[idx]);
    tabs.splice(idx, 1);
    if (activeTabId === id) {
        const newT = tabs[Math.min(idx, tabs.length - 1)];
        activeTabId = newT.id;
        if (newT.url) navigate(newT.url, newT.id, false);
        else showSpeedDial();
    }
    renderTabs();
}

function switchTab(id) {
    if (activeTabId === id) return;
    activeTabId = id;
    const tab = getActiveTab();
    renderTabs();
    if (tab) {
        if (tab.url) navigate(tab.url, id, false);
        else showSpeedDial();
    }
}

export function goBack() {
    const tab = getActiveTab();
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex--;
    navigate(tab.history[tab.historyIndex].url, tab.id, false);
}

export function goForward() {
    const tab = getActiveTab();
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex++;
    navigate(tab.history[tab.historyIndex].url, tab.id, false);
}

function showResultsPanel(query, data) {
    hideSpeedDial();
    frame.style.display = 'none';
    resultsPanel.style.display = 'block';
    let html = `<div class="res-header">${data.results.length} results</div>`;
    html += `<div class="res-query">${escHtml(query)}</div>`;
    if (data.results.length === 0) {
        html += `<div class="res-empty"><strong>No results</strong></div>`;
    } else {
        const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
        data.results.forEach(r => {
            let domain = '';
            try { domain = new URL(r.url).hostname; } catch {}
            html += `<div class="res-item">
                <a class="res-title" href="${escHtml(r.url)}" target="_blank" rel="noopener">${escHtml(r.title || r.url)}</a>
                <div class="res-url">${domain ? `<img src="${getFaviconUrl(domain)}">` : ''}${escHtml(r.url)}</div>
                <div class="res-snippet">${escHtml((r.text || '').substring(0, 240))}</div>
                <div class="res-score">score ${r.score} · ${escHtml(domain)}</div>
            </div>`;
        });
    }
    resultsPanel.innerHTML = html;
}

export async function navigate(raw, tabId, pushHistory = true) {
    if (!raw || !raw.trim()) { showSpeedDial(); return; }
    const tab = tabs.find(t => t.id === (tabId || activeTabId));
    if (!tab) return;
    activeTabId = tab.id;
    const url = raw.trim();

    if (!isUrl(url)) {
        tab.url = url;
        tab.title = 'Search: ' + url;
        urlInput.value = url;
        renderTabs();
        await initSearch();
        const data = search(url);
        showResultsPanel(url, data);
        return;
    }

    const fullUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    tab.url = fullUrl;
    try { tab.title = new URL(fullUrl).hostname.replace('www.', ''); } catch { tab.title = fullUrl; }
    tab.favicon = getFaviconUrl(new URL(fullUrl).hostname);
    if (pushHistory) {
        if (tab.history.length === 0 || tab.history[tab.history.length - 1].url !== fullUrl) {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
            tab.history.push({ url: fullUrl, title: tab.title });
            tab.historyIndex++;
        }
    }
    renderTabs();
    urlInput.value = fullUrl;
    hideSpeedDial();
    resultsPanel.style.display = 'none';

    if (cfg.proxy === 'none') {
        window.open(fullUrl, '_blank', 'noopener,noreferrer');
        showSpeedDial();
        return;
    }
    const proxyUrl = cfg.proxy === 'external' && cfg.proxyUrl
        ? cfg.proxyUrl + encodeURIComponent(fullUrl)
        : '/proxy?url=' + encodeURIComponent(fullUrl);
    frame.style.display = '';
    frame.src = proxyUrl;

    if (cfg.autocrawl) {
        const res = await fetch(proxyUrl).catch(() => null);
        if (res) {
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const title = doc.querySelector('title')?.textContent || fullUrl;
            const body = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 8000);
            addPage(fullUrl, title, body, []);
        }
    }
}

createTab('New Tab', '');
