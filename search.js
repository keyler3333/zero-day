const BM25_K1 = 1.5;
const BM25_B = 0.75;
const PHRASE_BOOST = 2.0;
const TITLE_MATCH_BOOST = 1.4;
const SPAM_DENSITY_LIMIT = 0.18;

export class SearchEngine {
  constructor() {
    this.index = null;
    this.docs = null;
    this.pageRank = {};
    this.N = 0;
    this.avgDL = 0;
    this.ready = false;
  }

  async load(indexPath = 'search-index.json', pageRankPath = 'pagerank.json') {
    try {
      const resp = await fetch(indexPath);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      this.index = data.index || {};
      this.docs = data.documents || {};
      this.N = data.totalDocs || Object.keys(this.docs).length;
      this.avgDL = data.avgDocLen || this._computeAvgDL();
      try {
        const prResp = await fetch(pageRankPath);
        if (prResp.ok) this.pageRank = await prResp.json();
      } catch {}
      this.ready = true;
      return { ok: true, docCount: this.N };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _computeAvgDL() {
    const ids = Object.keys(this.docs);
    if (!ids.length) return 1;
    return ids.reduce((s, id) => s + (this.docs[id].tokenCount || 100), 0) / ids.length;
  }

  search(query, { limit = 20 } = {}) {
    if (!this.ready) return { engine: 'BM25+', error: 'Index not loaded', results: [] };
    const tokens = this._tokenize(query);
    if (!tokens.length) return { engine: 'BM25+', results: [] };

    const candidates = this._getCandidates(tokens);
    const scored = [];

    for (const docId of candidates) {
      const doc = this.docs[docId];
      if (this._isSpam(doc)) continue;

      const docDL = doc.tokenCount || 100;
      let score = 0;

      for (const term of tokens) {
        const postings = this.index[term];
        if (!postings || !postings[docId]) continue;
        const df = Object.keys(postings).length;
        const idf = Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
        const tf = postings[docId] * docDL;
        const norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docDL / this.avgDL));
        score += idf * norm;
      }

      if (tokens.length > 1 && this._titleContainsPhrase(doc.title || '', tokens)) {
        score *= PHRASE_BOOST;
      } else if (this._titleContainsAllTerms(doc.title || '', tokens)) {
        score *= TITLE_MATCH_BOOST;
      }

      score *= this._domainBoost(doc.domain || '', doc.url || '');
      score *= this._pageRankBoost(docId);
      score *= this._freshnessBoost(doc.crawledAt);

      if (score > 0) scored.push({ docId, score: Math.round(score * 1000) / 1000 });
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      engine: 'BM25+',
      results: scored.slice(0, limit).map(({ docId, score }) => ({
        ...this.docs[docId],
        score,
        snippet: this._buildSnippet(this.docs[docId].text || '', tokens),
      }))
    };
  }

  _getCandidates(tokens) {
    const set = new Set();
    for (const term of tokens) {
      const postings = this.index[term];
      if (postings) for (const docId of Object.keys(postings)) set.add(docId);
    }
    return set;
  }

  _titleContainsPhrase(title, tokens) {
    return title.toLowerCase().includes(tokens.join(' '));
  }

  _titleContainsAllTerms(title, tokens) {
    const lower = title.toLowerCase();
    return tokens.every(t => lower.includes(t));
  }

  _isSpam(doc) {
    if (!doc.text) return false;
    const tokens = this._tokenize(doc.text);
    if (!tokens.length) return false;
    const counts = {};
    for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
    return Math.max(...Object.values(counts)) / tokens.length > SPAM_DENSITY_LIMIT;
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

  _domainBoost(domain, url) {
    let boost = 1.0;
    const trusted = ['wikipedia.org', 'developer.mozilla.org', 'github.com', 'stackoverflow.com',
                     'docs.python.org', 'arxiv.org', 'w3.org', 'ietf.org'];
    for (const t of trusted) if (domain.endsWith(t)) { boost *= 1.2; break; }
    if (url.startsWith('https://')) boost *= 1.05;
    if ((domain.match(/\./g) || []).length >= 3) boost *= 0.88;
    if (url.length > 120) boost *= 0.9;
    return boost;
  }

  _pageRankBoost(docId) {
    const pr = this.pageRank[docId];
    if (!pr) return 1.0;
    return 1.0 + Math.log10(1 + pr * 100);
  }

  _freshnessBoost(crawledAt) {
    if (!crawledAt) return 1.0;
    const days = (Date.now() - new Date(crawledAt).getTime()) / 86400000;
    if (days < 7) return 1.15;
    if (days < 30) return 1.05;
    if (days < 180) return 1.0;
    return 0.95;
  }

  _tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  }
}
