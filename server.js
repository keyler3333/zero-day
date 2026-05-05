const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let documents = {};
let docIdCounter = 0;
let invertedIndex = {};
let totalDocs = 0;
let idfCache = {};

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function computeTF(tokens) {
  const freq = {};
  tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const total = tokens.length;
  const tf = {};
  for (let [word, count] of Object.entries(freq)) {
    tf[word] = count / total;
  }
  return tf;
}

function computeIDF(term) {
  if (idfCache[term] !== undefined) return idfCache[term];
  const docFreq = Object.values(documents).filter(doc => doc.tf[term]).length;
  if (docFreq === 0) {
    idfCache[term] = 0;
  } else {
    idfCache[term] = Math.log10(totalDocs / docFreq);
  }
  return idfCache[term];
}

function addDocument(url, title, text) {
  const id = ++docIdCounter;
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  documents[id] = { url, title, text, tokens, tf };
  totalDocs++;
  Object.keys(tf).forEach(word => {
    if (!invertedIndex[word]) invertedIndex[word] = new Map();
    invertedIndex[word].set(id, tf[word]);
  });
  idfCache = {};
}

async function crawlPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('title').text().trim().substring(0, 200);
    $('script, style, noscript').remove();
    const body = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 10000);
    addDocument(url, title, body);
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && (href.startsWith('/') || href.startsWith('http'))) {
        try {
          const absolute = new URL(href, url).href;
          if (!Object.values(documents).some(doc => doc.url === absolute)) {
            links.push(absolute);
          }
        } catch (e) {}
      }
    });
    return links.slice(0, 5);
  } catch (e) {
    return [];
  }
}

async function crawlSeed(urls, depth = 1) {
  const queue = urls.slice();
  const visited = new Set();
  while (queue.length && depth > 0) {
    const batch = queue.splice(0, 3);
    for (const url of batch) {
      if (visited.has(url)) continue;
      visited.add(url);
      const newLinks = await crawlPage(url);
      queue.push(...newLinks);
    }
    depth--;
  }
}

app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  const tokens = tokenize(q);
  const scores = {};
  tokens.forEach(token => {
    const idf = computeIDF(token);
    const postings = invertedIndex[token];
    if (postings) {
      for (let [docId, tf] of postings) {
        scores[docId] = (scores[docId] || 0) + tf * idf;
      }
    }
  });
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([docId, score]) => ({
      ...documents[docId],
      score: Math.round(score * 100) / 100
    }));
  res.json({ query: q, results: sorted });
});

app.get('/api/crawl', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Provide ?url=' });
  await crawlSeed([url], 2);
  res.json({ status: 'Crawling finished', totalPages: totalDocs });
});

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Search engine running on port ${PORT}`);
});
