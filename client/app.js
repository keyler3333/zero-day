import { navigate } from './tabs.js';
const frame = document.getElementById('frame');
const input = document.getElementById('q');
document.getElementById('go').onclick = async () => {
    const res = await navigate(input.value);
    if (res.type === "url") {
        frame.src = res.url;
    } else {
        frame.srcdoc = res.html;
    }
};
