const { chromium } = require('playwright'); const fs = require('fs');
const logo = fs.readFileSync('/home/claude/recall/apps/desktop/brand/icon.svg', 'utf8').replace('width="512" height="512"', 'width="230" height="230"');
const T = {
  ru: { t: 'Spark', s: 'Карточки с умными повторениями —<br>прямо в Telegram', chips: ['Колоды с озвучкой', 'Умный таймер', 'Созвездие серий', 'Все устройства'], cta: 'Нажмите «Открыть Spark» ↓' },
  en: { t: 'Spark', s: 'Flashcards with smart repetition —<br>right inside Telegram', chips: ['Decks with audio', 'Smart timer', 'Streak constellations', 'Every device'], cta: 'Tap “Open Spark” ↓' },
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('file:///home/claude/recall/apps/desktop/dist/Spark.html'); await p.waitForFunction(() => window.__spark);
  for (const L of ['ru', 'en']) {
    const x = T[L];
    await p.evaluate(({ x, logo }) => {
      const dm = window.__spark.dayMark, sm = window.__spark.streakMark;
      document.documentElement.dataset.dark = '1';
      document.body.innerHTML = `<div id="w" style="position:fixed;inset:0;overflow:hidden;font-family:-apple-system,'Segoe UI',Inter,Roboto,sans-serif;color:#fff;
        background:radial-gradient(1000px 620px at 78% 30%, #4c1d95 0%, #1e0b45 45%, #0b0716 100%)">
        <div style="position:absolute;inset:0;background-image:radial-gradient(#ffffff55 1px, transparent 1.4px);background-size:44px 44px;opacity:.35"></div>
        <div style="position:absolute;left:84px;top:96px;width:640px">
          <div style="font-size:120px;font-weight:850;letter-spacing:-3px;line-height:1">${x.t}<span style="color:#fbbf24">.</span></div>
          <div style="font-size:40px;font-weight:600;line-height:1.25;margin-top:22px;color:#e9e3ff">${x.s}</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:40px">${x.chips.map((c) => `<span style="padding:12px 20px;border-radius:999px;background:#ffffff14;border:1.5px solid #ffffff2e;font-size:24px;font-weight:600">${c}</span>`).join('')}</div>
          <div style="margin-top:52px;font-size:26px;font-weight:700;color:#fbbf24">${x.cta}</div>
        </div>
        <div style="position:absolute;right:120px;top:150px;transform:rotate(-6deg);filter:drop-shadow(0 30px 60px #0008)">${logo}</div>
        <div style="position:absolute;right:430px;top:96px" class="big1">${dm(9)}</div>
        <div style="position:absolute;right:96px;top:480px" class="big2">${dm(15)}</div>
        <div style="position:absolute;right:400px;top:520px"><span class="combo lv6" style="font-size:30px;padding:10px 20px 10px 14px">${sm(6)}<b>20</b></span></div>
        <style>.big1 .dmark{width:120px;height:120px}.big2 .dmark{width:150px;height:150px}.combo .smark{width:40px;height:40px}.combo .spk{margin:0}</style></div>`;
    }, { x, logo });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `/home/claude/recall/apps/desktop/web/bot/welcome-${L}.jpg`, type: 'jpeg', quality: 88 });
  }
  await b.close();
})();
