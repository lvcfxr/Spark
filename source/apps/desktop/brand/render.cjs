const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const svg = fs.readFileSync('icon.svg', 'utf8');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  const shot = async (html, w, h, out, transparent) => { await p.setViewportSize({ width: w, height: h }); await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`); await p.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } }); };
  const sized = (n) => svg.replace('width="512" height="512"', `width="${n}" height="${n}"`);
  await shot(sized(1024), 1024, 1024, 'icon-1024.png', true);
  await shot(sized(512), 512, 512, 'icon-512.png', true);
  // Telegram: аватар бота 640x640 (круглая обрезка — знак по центру на сплошном фоне)
  await shot(`<div style="width:640px;height:640px;background:#0B0B0F;display:grid;place-items:center">${sized(420).replace('rx="116"', 'rx="0"').replace('fill="#0B0B0F"/>', 'fill="#0B0B0F"/>')}</div>`, 640, 640, 'telegram-avatar-640.png', false);
  // Telegram: картинка Mini App 640x360
  await shot(`<div style="width:640px;height:360px;background:#0B0B0F;display:flex;align-items:center;justify-content:center;gap:28px;font-family:-apple-system,'Segoe UI',Arial,sans-serif">${sized(200)}<div><div style="color:#fff;font-size:76px;font-weight:700;letter-spacing:-2px">Spark</div><div style="color:#A78BFA;font-size:24px;margin-top:2px">карточки для памяти · flashcards</div></div></div>`, 640, 360, 'telegram-app-640x360.png', false);
  await b.close();
})();
