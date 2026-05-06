import fs from 'fs';
export async function crawl(urls) {
    const out = [];
    for (const url of urls) {
        try {
            const r = await fetch(url);
            const html = await r.text();
            out.push({
                url,
                title: html.match(/<title>(.*?)<\/title>/)?.[1] || url,
                text: html.replace(/<[^>]*>/g, '').slice(0, 3000)
            });
        } catch {}
    }
    fs.writeFileSync('./data/index.json', JSON.stringify(out, null, 2));
}
