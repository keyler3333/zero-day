import index from '../data/index.json' assert { type: 'json' };
export async function search(q) {
    q = q.toLowerCase();
    return index
        .map(d => {
            let score = 0;
            if (d.title?.toLowerCase().includes(q)) score += 5;
            if (d.text?.toLowerCase().includes(q)) score += 2;
            return { ...d, score };
        })
        .filter(d => d.score > 0)
        .sort((a,b) => b.score - a.score)
        .slice(0, 10);
}
