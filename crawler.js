const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');
const Database = require('better-sqlite3');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CONFIG = {
  START_URLS: ['https://en.wikipedia.org/wiki/Search_engine', 'https://developer.mozilla.org'],
  MAX_DEPTH: 3,
  CONCURRENCY: 6,
  MAX_DOCS: 2000,
  DEFAULT_POLITENESS_MS: 800,
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_MS: 500,
  OUTPUT_FILE: 'search-index.json',
  DB_FILE: 'frontier.db',
  USER_AGENT: 'SerfXBot/2.0 (+https://github.com/keyler3333/zero-day)',
  RESPECT_ROBOTS: true,
  MAX_LINKS_PER_PAGE: 20,
  TITLE_WEIGHT: 3,
  HEADER_WEIGHT: 2,
  BODY_WEIGHT: 1,
};

if (!isMainThread) {
  runWorker();
} else {
  runMain();
}

async function runMain() {
  const db = new Database(CONFIG.DB_FILE);

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      depth INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS visited (
      url TEXT PRIMARY KEY,
      content_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      snippet TEXT,
      meta_desc TEXT,
      domain TEXT,
      token_count INTEGER,
      term_freqs TEXT,
      links TEXT,
      crawled_at TEXT
    );
  `);

  const enqueue = db.prepare(`INSERT OR IGNORE INTO queue (url, depth) VALUES (?, ?)`);
  const markDone = db.prepare(`UPDATE queue SET status='done' WHERE url=?`);
  const markFailed = db.prepare(`UPDATE queue SET status='failed' WHERE url=?`);
  const addVisited = db.prepare(`INSERT OR IGNORE INTO visited (url, content_hash) VALUES (?, ?)`);
  const hasHash = db.prepare(`SELECT url FROM visited WHERE content_hash=?`);
  const getCount = db.prepare(`SELECT COUNT(*) as c FROM documents`);
  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO documents (url, title, snippet, meta_desc, domain, token_count, term_freqs, links, crawled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (getCount.get().c === 0) {
    for (const u of CONFIG.START_URLS) enqueue.run(u, 0);
  }

  const robotsCache = {};
  const domainLastSeen = {};

  async function fetchRobots(domain, protocol) {
    if (robotsCache[domain]) return robotsCache[domain];
    const rules = { disallow: [], allow: [], crawlDelay: null };
    try {
      const r = await fetch(`${protocol}//${domain}/robots.txt`, {
        headers: { 'User-Agent': CONFIG.USER_AGENT },
        signal: AbortSignal.timeout(5000)
      });
      const text = await r.text();
      let inBlock = false;
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim().replace(/#.*$/, '').trim();
        if (!line) { inBlock = false; continue; }
        const lower = line.toLowerCase();
        if (lower.startsWith('user-agent:')) {
          const val = line.split(':')[1].trim();
          inBlock = val === '*' || val.toLowerCase().includes('serfx');
        } else if (inBlock && lower.startsWith('disallow:')) {
          const p = line.split(':')[1].trim();
          if (p) rules.disallow.push(p);
        } else if (inBlock && lower.startsWith('allow:')) {
          const p = line.split(':')[1].trim();
          if (p) rules.allow.push(p);
        } else if (inBlock && lower.startsWith('crawl-delay:')) {
          const d = parseFloat(line.split(':')[1].trim());
          if (!isNaN(d)) rules.crawlDelay = d * 1000;
        }
      }
    } catch {}
    robotsCache[domain] = rules;
    return rules;
  }

  function matchesPattern(path, pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
    return new RegExp('^' + escaped).test(path);
  }

  async function isAllowed(url) {
    if (!CONFIG.RESPECT_ROBOTS) return true;
    const { hostname, protocol, pathname } = new URL(url);
    const rules = await fetchRobots(hostname, protocol);
    for (const allow of rules.allow) {
      if (matchesPattern(pathname, allow)) return true;
    }
    for (const disallow of rules.disallow) {
      if (matchesPattern(pathname, disallow)) return false;
    }
    return true;
  }

  async function waitForPoliteness(domain) {
    const rules = robotsCache[domain];
    const delay = (rules && rules.crawlDelay) ? rules.crawlDelay : CONFIG.DEFAULT_POLITENESS_MS;
    const now = Date.now();
    const wait = delay - (now - (domainLastSeen[domain] || 0));
    if (wait > 0) await sleep(wait);
    domainLastSeen[domain] = Date.now();
  }

  function canonicalize(rawUrl, base) {
    try {
      const u = new URL(rawUrl, base);
      u.protocol = 'https:';
      u.hostname = u.hostname.toLowerCase();
      u.hash = '';
      if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      const allowed = ['q', 'id', 'page', 'p', 's', 'search'];
      const cleaned = new URLSearchParams();
      for (const [k, v] of [...u.searchParams].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (allowed.includes(k)) cleaned.set(k, v);
      }
      u.search = cleaned.toString() ? '?' + cleaned.toString() : '';
      return u.href;
    } catch {
      return null;
    }
  }

  let activeWorkers = 0;
  let done = false;
  const getPending = db.prepare(`SELECT url, depth FROM queue WHERE status='pending' LIMIT 1`);

  async function dispatch() {
    while (!done && activeWorkers < CONFIG.CONCURRENCY) {
      const item = getPending.get();
      if (!item) break;
      markDone.run(item.url);

      const canonical = canonicalize(item.url, item.url);
      if (!canonical || !(await isAllowed(canonical))) continue;

      const domain = new URL(canonical).hostname;
      await waitForPoliteness(domain);
      activeWorkers++;

      spawnWorker({ url: canonical, depth: item.depth }).then(result => {
        activeWorkers--;
        if (result) {
          const dup = hasHash.get(result.doc.contentHash);
          if (!dup) {
            addVisited.run(canonical, result.doc.contentHash);
            insertDoc.run(
              result.doc.url, result.doc.title, result.doc.snippet,
              result.doc.metaDesc, result.doc.domain, result.doc.tokenCount,
              JSON.stringify(result.doc.termFreqs), JSON.stringify(result.links),
              new Date().toISOString()
            );
            const count = getCount.get().c;
            process.stdout.write(`\r[${count}/${CONFIG.MAX_DOCS}] ${result.doc.url.slice(0, 80)}`);
            if (count >= CONFIG.MAX_DOCS) { done = true; return finalise(db); }
          }
          if (item.depth + 1 <= CONFIG.MAX_DEPTH) {
            for (const link of result.links) {
              const c = canonicalize(link, canonical);
              if (c) enqueue.run(c, item.depth + 1);
            }
          }
        } else {
          markFailed.run(item.url);
        }
        dispatch();
      });
    }
    if (activeWorkers === 0) await finalise(db);
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

async function finalise(db) {
  const rows = db.prepare(`SELECT * FROM documents`).all();
  const totalDocs = rows.length;
  let totalTokens = 0;
  const documents = {};

  for (const row of rows) {
    documents[row.id] = {
      url: row.url, title: row.title, text: row.snippet,
      metaDesc: row.meta_desc, domain: row.domain,
      tokenCount: row.token_count,
      termFreqs: JSON.parse(row.term_freqs),
      links: JSON.parse(row.links || '[]'),
      crawledAt: row.crawled_at,
    };
    totalTokens += row.token_count;
  }

  const avgDocLen = totalTokens / totalDocs;
  const termIndex = {};

  for (const docId in documents) {
    for (const [term, tf] of Object.entries(documents[docId].termFreqs)) {
      if (!termIndex[term]) termIndex[term] = {};
      termIndex[term][docId] = tf;
    }
    delete documents[docId].termFreqs;
  }

  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify({ index: termIndex, documents, totalDocs, avgDocLen, builtAt: new Date().toISOString() }));
  process.exit(0);
}

async function runWorker() {
  const { item, config } = workerData;
  parentPort.postMessage(await fetchAndParse(item.url, config));
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
      const contentHash = crypto.createHash('sha256').update(html).digest('hex');
      const $ = cheerio.load(html);

      const title = $('title').text().trim().slice(0, 200) || url;
      const metaDesc = $('meta[name="description"]').attr('content') || '';
      const h1 = $('h1').map((_, el) => $(el).text()).get().join(' ');
      const h2 = $('h2').map((_, el) => $(el).text()).get().join(' ');

      $('script, style, noscript, nav, footer, header, aside').remove();
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 12000);

      const weighted = [
        ...Array(config.TITLE_WEIGHT).fill(null).map(() => tokenize(title)).flat(),
        ...Array(config.HEADER_WEIGHT).fill(null).map(() => tokenize(h1 + ' ' + h2)).flat(),
        ...tokenize(bodyText),
      ];

      const counts = {};
      for (const t of weighted) counts[t] = (counts[t] || 0) + 1;
      const termFreqs = {};
      for (const [t, c] of Object.entries(counts)) termFreqs[t] = c / weighted.length;

      const base = new URL(url);
      const links = [];
      $('a[href]').each((_, el) => {
        try {
          const abs = new URL($(el).attr('href'), base).href;
          if (/^https?:/.test(abs)) links.push(abs);
        } catch {}
      });

      return {
        doc: {
          url, title, snippet: bodyText.slice(0, 300), metaDesc, contentHash,
          domain: base.hostname, tokenCount: weighted.length, termFreqs,
        },
        links: [...new Set(links)].slice(0, config.MAX_LINKS_PER_PAGE),
      };

    } catch {
      if (attempt < config.RETRY_ATTEMPTS) await sleep(config.RETRY_BASE_MS * 2 ** (attempt - 1));
      else return null;
    }
  }
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
