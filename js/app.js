import { initEngine } from './engine.js';
import { navigate, createTab, getActiveTab, goBack, goForward } from './tabs.js';
import { initUI } from './ui.js';
import { initKeyboard } from './keyboard.js';
import { initPanels } from './panels.js';

async function init() {
    await initEngine();
    initUI();
    initKeyboard();
    initPanels();

    const urlInput = document.getElementById('url-input');
    const sdInput = document.getElementById('sd-search-input');
    const clearBtn = document.getElementById('url-clear');
    const frame = document.getElementById('content-frame');

    document.getElementById('sd-search-go-btn').addEventListener('click', () => {
        const q = sdInput.value.trim();
        if (q) {
            sdInput.value = '';
            navigate(q);
        }
    });

    document.getElementById('new-tab-btn').addEventListener('click', () => {
        createTab('New Tab', '');
    });

    document.getElementById('back-btn').addEventListener('click', goBack);
    document.getElementById('fwd-btn').addEventListener('click', goForward);

    document.getElementById('reload-btn').addEventListener('click', () => {
        if (frame.src && frame.src !== location.href) frame.src = frame.src;
    });

    urlInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') navigate(e.target.value.trim());
    });

    clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        urlInput.focus();
    });

    sdInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const q = e.target.value.trim();
            if (q) {
                e.target.value = '';
                navigate(q);
            }
        }
    });
}

init();
