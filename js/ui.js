import { createTab } from './tabs.js';

const SPEED_DIALS = [
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com', domain: 'duckduckgo.com' },
    { name: 'Brave Search', url: 'https://search.brave.com', domain: 'search.brave.com' },
    { name: 'GitHub', url: 'https://github.com', domain: 'github.com' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', domain: 'wikipedia.org' },
    { name: 'MDN', url: 'https://developer.mozilla.org', domain: 'developer.mozilla.org' },
    { name: 'Reddit', url: 'https://reddit.com', domain: 'reddit.com' },
    { name: 'YouTube', url: 'https://youtube.com', domain: 'youtube.com' },
    { name: 'Discord', url: 'https://discord.com', domain: 'discord.com' }
];

function getFaviconUrl(domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderSpeedDials() {
    const grid = document.getElementById('sd-grid');
    grid.innerHTML = '';
    SPEED_DIALS.forEach(sd => {
        const el = document.createElement('div');
        el.className = 'sd-tile';
        el.innerHTML = `<div class="sd-tile-icon"><img src="${getFaviconUrl(sd.domain)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="icon-fallback" style="display:none">${sd.name.charAt(0)}</span></div><div class="sd-tile-name">${escHtml(sd.name)}</div>`;
        el.addEventListener('click', () => import('./tabs.js').then(m => m.navigate(sd.url)));
        grid.appendChild(el);
    });
}

function updateGreeting() {
    const h = new Date().getHours();
    document.getElementById('sd-greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function initUI() {
    updateGreeting();
    renderSpeedDials();
    document.getElementById('url-input').addEventListener('focus', () => document.getElementById('url-input').select());
    document.getElementById('url-input').addEventListener('input', () => {
        document.getElementById('url-clear').style.display = document.getElementById('url-input').value ? 'block' : 'none';
    });
}
