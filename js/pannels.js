export function initPanels() {
    document.getElementById('btn-sd').addEventListener('click', () => {
        document.getElementById('speed-dial').classList.add('visible');
        document.getElementById('content-frame').style.display = 'none';
        document.getElementById('results-panel').style.display = 'none';
    });
    document.getElementById('btn-bm').addEventListener('click', () => togglePanel('bm-panel'));
    document.getElementById('btn-hist').addEventListener('click', () => togglePanel('hist-panel'));
    document.getElementById('btn-settings').addEventListener('click', () => togglePanel('settings-panel'));
    document.getElementById('panel-overlay').addEventListener('click', closeAllPanels);
    document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', closeAllPanels);
    });

    document.getElementById('t-newtab').addEventListener('click', function() { this.classList.toggle('on'); });
    document.getElementById('t-autocrawl').addEventListener('click', function() { this.classList.toggle('on'); });
    document.getElementById('s-proxy').addEventListener('change', function() {
        document.getElementById('s-proxy-url-wrap').style.display = this.value === 'external' ? 'block' : 'none';
    });
}

function togglePanel(id) {
    const overlay = document.getElementById('panel-overlay');
    const panel = document.getElementById(id);
    const isOpen = panel.classList.contains('open');
    closeAllPanels();
    if (!isOpen) { overlay.classList.add('open'); panel.classList.add('open'); }
}

function closeAllPanels() {
    document.getElementById('panel-overlay').classList.remove('open');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
}
