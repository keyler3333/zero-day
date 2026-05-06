import express from 'express';
import fetch from 'node-fetch';
const app = express();
app.get('/proxy', async (req, res) => {
    const url = req.query.url;
    try {
        const r = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });
        const html = await r.text();
        res.send(html);
    } catch {
        res.status(500).send("error");
    }
});
app.listen(3000);
