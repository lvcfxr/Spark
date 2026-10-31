const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const svg = fs.readFileSync('/home/claude/brand/icon.svg', 'utf8');
  for (const [size, out, round] of [[512, '/home/claude/recall/apps/desktop/brand/icon-512.png', true], [640, '/home/claude/brand/spark-avatar-640.png', false], [640, '/home/claude/recall/apps/desktop/brand/telegram-avatar-640.png', false], [1024, '/home/claude/recall/apps/desktop/brand/icon-1024.png', true]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`).replace('rx="116" fill="url(#spkbg)"', round ? 'rx="116" fill="url(#spkbg)"' : 'fill="url(#spkbg)"')}</body>`);
    await p.screenshot({ path: out, omitBackground: true }); await p.close();
  }
  await b.close();
})();
