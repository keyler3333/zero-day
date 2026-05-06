import { search } from './search.js';
export async function navigate(input) {
    input = input.trim();
    if (input.includes('.') && !input.includes(' ')) {
        return {
            type: "url",
            url: input.startsWith('http') ? input : 'https://' + input
        };
    }
    const results = await search(input);
    return {
        type: "html",
        html: `
            <h2>Results</h2>
            ${results.map(r =>
                `<p><a href="${r.url}" target="_blank">${r.title}</a></p>`
            ).join('')}
        `
    };
}
