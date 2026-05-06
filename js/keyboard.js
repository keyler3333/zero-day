import { getActiveTab, createTab, goBack, goForward } from './tabs.js';

export function initKeyboard() {
    let zoomLevel = 1;
    const frame = document.getElementById('content-frame');
    const urlInput = document.getElementById('url-input');

    document.addEventListener('keydown', e => {
        if (e.ctrlKey) {
            if (e.key === 't') { e.preventDefault(); createTab('New Tab', ''); }
            else if (e.key === 'w') { e.preventDefault(); const t = getActiveTab(); if (t) import('./tabs.js').then(m => m.closeTab(t.id)); }
            else if (e.key === 'l' || e.key === 'k') { e.preventDefault(); urlInput.select(); urlInput.focus(); }
            else if (e.key === 'f') { e.preventDefault(); document.getElementById('find-open-btn').click(); }
            else if (e.key === 'r') { e.preventDefault(); document.getElementById('reload-btn').click(); }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomLevel = Math.min(2, zoomLevel + 0.1); frame.style.zoom = zoomLevel; }
            else if (e.key === '-') { e.preventDefault(); zoomLevel = Math.max(0.5, zoomLevel - 0.1); frame.style.zoom = zoomLevel; }
            else if (e.key === '0') { e.preventDefault(); zoomLevel = 1; frame.style.zoom = 1; }
        }
    });
}
