const BM25_K1 = 1.5;
const BM25_B = 0.75;

export class SearchEngine {

  constructor() {
    this.index = null;
    this.docs = null;
    this.N = 0;
    this.avgDL = 0;
    this.ready = false;
  }

  async load(path = 'search-index.json') {
    try {
      const resp = await fetch(path);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      this.index = data.index || {};
      this.docs = data.documents || {};
      this.N = data.totalDocs || Object.keys(this.docs).length;
      this.avgDL = data.avgDocLen || this._computeAvgDL();
      this.ready = true;
      return { ok: true, docCount: this.N };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _computeAvgDL() {
    const ids = Object.keys(this.docs);
    if (!ids.length) return 1;
    const total = ids.reduce((s, id) => s + (this.docs[id].tokenCount || 100), 0);
    return total / ids.length;
  }

  search(query, { limit = 20 } = {}) {
    if (!this.ready) return { engine: 'BM25', error: 'Index not loaded', results: [] };

    const tokens = this._tokenize(query);
    if (!tokens.length) return { engine: 'BM25', results: [] };

    const candidates = this._getCandidates(tokens);
    const scored = [];

    for (const docId of candidates) {
      const doc = this.docs[docId];
      const docDL = doc.tokenCount || 100;
      let score = 0;

      for (const term of tokens) {
        const postings = this.index[term];
        if (!postings || !postings[docId]) continue;

        const df = Object.keys(postings).length;
        const idf = Math.log((this.N - df + 0.5) / (df + 0.5) + 1);

        const rawTF = postings[docId];
        const tf = rawTF * docDL;
        const norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docDL / this.avgDL));

        score += idf * norm;
      }

      score *= this._domainBoost(doc.domain || '');
      score *= this._urlLengthPenalty(doc.url || '');

      if (score > 0) scored.push({ docId, score: Math.round(score * 1000) / 1000 });
    }

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, limit).map(({ docId, score }) => ({
      ...this.docs[docId],
      score,
      snippet: this._buildSnippet(this.docs[docId].text || '', tokens),
    }));

    return { engine: 'BM25', results };
  }

  _getCandidates(tokens) {
    const set = new Set();
    for (const term of tokens) {
      const postings = this.index[term];
      if (postings) for (const docId of Object.keys(postings)) set.add(docId);
    }
    return set;
  }

  _buildSnippet(text, queryTokens, maxChars = 240) {
    if (!text) return '';
    const lower = text.toLowerCase();
    let best = 0;
    for (const term of queryTokens) {
      const idx = lower.indexOf(term);
      if (idx !== -1) { best = Math.max(0, idx - 60); break; }
    }
    const raw = text.slice(best, best + maxChars);
    return (best > 0 ? '…' : '') + raw + (raw.length === maxChars ? '…' : '');
  }

  _domainBoost(domain) {
    const trusted = ['wikipedia.org', 'developer.mozilla.org', 'github.com', 'stackoverflow.com',
                     'docs.python.org', 'arxiv.org', 'w3.org', 'ietf.org'];
    for (const t of trusted) if (domain.endsWith(t)) return 1.15;
    const dots = (domain.match(/\./g) || []).length;
    if (dots >= 3) return 0.9;
    return 1.0;
  }

  _urlLengthPenalty(url) {
    const len = url.length;
    if (len < 60) return 1.0;
    if (len < 120) return 0.95;
    return 0.85;
  }

  _tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  }
}
