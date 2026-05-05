const { parseHTML } = require('linkedom');

const ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: (doc) => {
      const results = [];
      doc.querySelectorAll('.result').forEach(el => {
        const title = el.querySelector('.result__title');
        const snippet = el.querySelector('.result__snippet');
        const urlEl = el.querySelector('.result__url');
        const link = title?.querySelector('a')?.getAttribute('href');
        if (title && snippet) {
          results.push({
            title: title.textContent.trim(),
            snippet: snippet.textContent.trim(),
            url: link || '',
            displayUrl: urlEl ? urlEl.textContent.trim() : (link || '')
          });
        }
      });
      return results.slice(0, 10);
    }
  },
  brave: {
    name: 'Brave',
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
    parse: (doc) => {
      const results = [];
      doc.querySelectorAll('.snippet').forEach(el => {
        const title = el.querySelector('.snippet-title');
        const desc = el.querySelector('.snippet-description');
        const link = el.querySelector('a')?.getAttribute('href');
        if (title && desc) results.push({
          title: title.textContent.trim(),
          snippet: desc.textContent.trim(),
          url: link || '',
          displayUrl: link || ''
        });
      });
      return results.slice(0, 10);
    }
  }
};

export default async function handler(req, res) {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing ?q= parameter' });
  }

  const engineKey = req.query.engine || 'duckduckgo';
  const engine = ENGINES[engineKey];
  if (!engine) {
    return res.status(400).json({ error: 'Unknown engine. Supported: duckduckgo, brave' });
  }

  try {
    const response = await fetch(engine.url(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream engine returned ${response.status}`);
    }

    const html = await response.text();
    const { document } = parseHTML(html);
    const results = engine.parse(document);

    return res.json({
      engine: engine.name,
      query,
      results
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Failed to fetch search results: ' + err.message });
  }
}
