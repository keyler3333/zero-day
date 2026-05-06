import { initEngine } from './engine.js';
import { navigate } from './tabs.js';
import { initUI } from './ui.js';
import { initKeyboard } from './keyboard.js';
import { initPanels } from './panels.js';

async function init() {
    await initEngine();
    initUI();
    initKeyboard();
    initPanels();
    document.getElementById('sd-search-go-btn').addEventListener('click', () => {
        const q = document.getElementById('sd-search-input').value.trim();
        if (q) {
            document.getElementById('sd-search-input').value = '';
            navigate(q);
        }
    });
    document.getElementById('new-tab-btn').addEventListener('click', () => {
        import('./tabs.js').then(m => m.createTab('New Tab', ''));
    });
    document.getElementById('back-btn').addEventListener('click', () => {
        import('./tabs.js').then(m => m.goBack());
    });
    document.getElementById('fwd-btn').addEventListener('click', () => {
        import('./tabs.js').then(m => m.goForward());
    });
    document.getElementById('reload-btn').addEventListener('click', () => {
        const frame = document.getElementById('content-frame');
        if (frame.src && frame.src !== location.href) frame.src = frame.src;
    });
    document.getElementById('url-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') navigate(e.target.value.trim());
    });
    document.getElementById('url-clear').addEventListener('click', () => {
        const inp = document.getElementById('url-input');
        inp.value = '';
        inp.focus();
    });
    document.getElementById('sd-search-input').addEventListener('keydown', e => {
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
