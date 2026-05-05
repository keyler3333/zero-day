const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const { URL } = require('url');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CONFIG = {
  START_URLS: ['https://en.wikipedia.org/wiki/Search_engine', 'https://developer.mozilla.org'],
  MAX_DEPTH: 3,
  CONCURRENCY: 6,
  MAX_DOCS: 2000,
  POLITENESS_MS: 800,
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_MS: 500,
  OUTPUT_FILE: 'search-index.json',
  FRONTIER_FILE: 'frontier.json',
  USER_AGENT: 'SerfXBot/2.0 (+https://github.com/keyler3333/zero-day)',
  RESPECT_ROBOTS: true,
  MAX_LINKS_PER_PAGE: 20,
};

if (!isMainThread) {
  runWorker();
} else {
  runMain();
}

async function runMain() {
  const visited = new Set();
  const queue = [];
  const robotsCache = {};

  if (fs.existsSync(CONFIG.FRONTIER_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG.FRONTIER_FILE, 'utf8'));
    saved.queue.forEach(item => queue.push(item));
    saved.visited.forEach(u => visited.add(u));
  } else {
    CONFIG.START_URLS.forEach(u => queue.push({ url: u, depth: 0 }));
  }

  async function isAllowed(url) {
    if (!CONFIG.RESPECT_ROBOTS) return true;
    const { hostname, protocol } = new URL(url);
    if (!robotsCache[hostname]) {
      robotsCache[hostname] = new Set();
      try {
        const r = await fetch(`${protocol}//${hostname}/robots.txt`, {
          headers: { 'User-Agent': CONFIG.USER_AGENT },
          signal: AbortSignal.timeout(5000)
        });
        const text = await r.text();
        let inOurBlock = false;
        for (const line of text.split('\n')) {
          const l = line.trim();
          if (/^user-agent:\s*\*/i.test(l)) {
            inOurBlock = true;
          } else if (/^user-agent:/i.test(l)) {
            inOurBlock = false;
          } else if (inOurBlock && /^disallow:/i.test(l)) {
            const p = l.replace(/^disallow:\s*/i, '').trim();
            if (p) robotsCache[hostname].add(p);
          }
        }
      } catch {}
    }
    const { pathname } = new URL(url);
    for (const prefix of robotsCache[hostname]) {
      if (pathname.startsWith(prefix)) return false;
    }
    return true;
  }

  const domainLastSeen = {};

  async function waitForPoliteness(domain) {
    const now = Date.now();
    const last = domainLastSeen[domain] || 0;
    const wait = CONFIG.POLITENESS_MS - (now - last);
    if (wait > 0) await sleep(wait);
    domainLastSeen[domain] = Date.now();
  }

  const documents = {};
  let docCounter = 0;
  let activeWorkers = 0;
  let done = false;

  async function dispatch() {
    while (!done && queue.length > 0 && activeWorkers < CONFIG.CONCURRENCY) {
      const item = queue.shift();
      if (!item || visited.has(item.url) || item.depth > CONFIG.MAX_DEPTH) continue;
      if (!(await isAllowed(item.url))) {
        visited.add(item.url);
        continue;
      }
      visited.add(item.url);
      activeWorkers++;

      const domain = new URL(item.url).hostname;
      await waitForPoliteness(domain);

      spawnWorker(item).then(result => {
        activeWorkers--;
        if (result) {
          const id = ++docCounter;
          documents[id] = result.doc;
          if (docCounter >= CONFIG.MAX_DOCS) { done = true; return; }
          for (const link of result.links) {
            if (!visited.has(link)) queue.push({ url: link, depth: item.depth + 1 });
          }
        }
        dispatch();
      });
    }
    if (activeWorkers === 0 || done) {
      await finalise(documents, docCounter);
    }
  }

  await dispatch();
}

function spawnWorker(item) {
  return new Promise((resolve) => {
    const w = new Worker(__filename, { workerData: { item, config: CONFIG } });
    w.once('message', resolve);
    w.once('error', () => resolve(null));
    w.once('exit', (code) => { if (code !== 0) resolve(null); });
  });
}

async function finalise(documents, totalDocs) {
  let totalTokens = 0;
  for (const id in documents) totalTokens += documents[id].tokenCount;
  const avgDocLen = totalTokens / totalDocs;

  const termIndex = {};

  for (const docId in documents) {
    const { termFreqs } = documents[docId];
    for (const [term, tf] of Object.entries(termFreqs)) {
      if (!termIndex[term]) termIndex[term] = {};
      termIndex[term][docId] = tf;
    }
    delete documents[docId].termFreqs;
  }

  const output = { index: termIndex, documents, totalDocs, avgDocLen, builtAt: new Date().toISOString() };
  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(output));
  fs.writeFileSync(CONFIG.FRONTIER_FILE, JSON.stringify({ queue: [], visited: [] }));
  process.exit(0);
}

async function runWorker() {
  const { item, config } = workerData;
  const result = await fetchAndParse(item.url, config);
  parentPort.postMessage(result);
}

async function fetchAndParse(url, config) {
  for (let attempt = 1; attempt <= config.RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.USER_AGENT },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return null;

      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('title').text().trim().slice(0, 200) || url;
      const h1Text = $('h1').map((_, el) => $(el).text()).get().join(' ').slice(0, 400);
      const metaDesc = $('meta[name="description"]').attr('content') || '';

      $('script, style, noscript, nav, footer, header, aside').remove();
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 12000);

      const combined = [title, title, h1Text, h1Text, metaDesc, bodyText].join(' ');
      const tokens = tokenize(combined);

      const counts = {};
      for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
      const termFreqs = {};
      for (const [t, c] of Object.entries(counts)) termFreqs[t] = c / tokens.length;

      const base = new URL(url);
      const links = [];
      $('a[href]').each((_, el) => {
        try {
          const abs = new URL($(el).attr('href'), base).href;
          if (/^https?:/.test(abs) && abs !== url) links.push(abs);
        } catch {}
      });

      return {
        doc: {
          url, title, text: bodyText.slice(0, 300),
          metaDesc, tokenCount: tokens.length, termFreqs,
          domain: base.hostname,
        },
        links: [...new Set(links)].slice(0, config.MAX_LINKS_PER_PAGE),
      };

    } catch (err) {
      if (attempt < config.RETRY_ATTEMPTS) {
        await sleep(config.RETRY_BASE_MS * 2 ** (attempt - 1));
      } else {
        return null;
      }
    }
  }
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
