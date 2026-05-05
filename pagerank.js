const fs = require('fs');

const DAMPING = 0.85;
const ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 1e-6;

function run() {
  const data = JSON.parse(fs.readFileSync('search-index.json', 'utf8'));
  const docs = data.documents;
  const ids = Object.keys(docs);
  const N = ids.length;

  const urlToId = {};
  for (const id of ids) urlToId[docs[id].url] = id;

  const outLinks = {};
  const inLinks = {};
  for (const id of ids) { outLinks[id] = []; inLinks[id] = []; }

  for (const id of ids) {
    for (const link of (docs[id].links || [])) {
      const targetId = urlToId[link];
      if (targetId && targetId !== id) {
        outLinks[id].push(targetId);
        inLinks[targetId].push(id);
      }
    }
  }

  let pr = {};
  for (const id of ids) pr[id] = 1 / N;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = {};
    let delta = 0;
    for (const id of ids) {
      let rank = (1 - DAMPING) / N;
      for (const src of inLinks[id]) {
        rank += DAMPING * (pr[src] / (outLinks[src].length || 1));
      }
      next[id] = rank;
      delta += Math.abs(rank - pr[id]);
    }
    pr = next;
    if (delta < CONVERGENCE_THRESHOLD) break;
  }

  fs.writeFileSync('pagerank.json', JSON.stringify(pr));
}

run();
