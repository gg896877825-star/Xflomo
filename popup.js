const button = document.querySelector('#toggle');
let enabled = true;
chrome.storage.local.get({ enabled: true }).then(value => { enabled = value.enabled; render(); });
function render() { button.textContent = enabled ? '关闭 flomo 样式' : '开启 flomo 样式'; }
button.addEventListener('click', async () => { enabled = !enabled; await chrome.storage.local.set({ enabled }); render(); });
