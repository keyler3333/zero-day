export function rank(pages) {
    return pages
        .map(p => ({
            ...p,
            rank: 1 + (p.links?.length || 0) * 0.2
        }))
        .sort((a,b) => b.rank - a.rank);
}
