const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');

const documents = {};
let docIdCounter = 0;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
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
    const id = ++docIdCounter;
    documents[id] = { url, title, text: body, tokens: tokenize(body) };
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
    console.log(`Crawled: ${url}`);
    return links.slice(0, 3);
  } catch (e) {
    console.error(`Failed: ${url}`, e.message);
    return [];
  }
}

async function crawl(startUrls, depth = 2) {
  const queue = [...startUrls];
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

function buildIndex() {
  const index = {};
  let totalDocs = Object.keys(documents).length;
  for (let docId in documents) {
    const tokens = documents[docId].tokens;
    const tokenSet = new Set(tokens);
    tokenSet.forEach(token => {
      if (!index[token]) index[token] = {};
      const tf = tokens.filter(t => t === token).length / tokens.length;
      index[token][docId] = tf;
    });
  }
  return { index, documents, totalDocs };
}

(async () => {
  await crawl(['https://en.wikipedia.org/wiki/Search_engine', 'https://developer.mozilla.org'], 2);
  const data = buildIndex();
  fs.writeFileSync('search-index.json', JSON.stringify(data));
  console.log('Index built and saved to search-index.json');
})();
