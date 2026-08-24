/* Kontrollerar att sidan fungerar oavsett hur GitHub Pages är inställd:
   publicerad via Actions (web/ i roten) eller direkt från grenen (/web/). */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
const kollar = [];
const k = (n, v) => kollar.push([n, !!v]);

for (const [namn, url] of [
  ['Actions-läge', process.env.URL_ACTIONS || 'http://127.0.0.1:8094/'],
  ['grenläge',     process.env.URL_GREN     || 'http://127.0.0.1:8095/web/']
]) {
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const fel = [];
  p.on('pageerror', e => fel.push(e.message));
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  k(namn + ': passet laddas', await p.locator('.block').count() === 5);
  k(namn + ': rubriken syns', (await p.locator('.pass-titel').textContent() || '').includes('träningspass'));
  k(namn + ': ingen felruta', await p.locator('#status.fel').count() === 0);
  k(namn + ': sidräknaren mäter', /A4-sid/.test(await p.locator('.sidvarning').textContent() || ''));
  k(namn + ': inga skriptfel', fel.length === 0);

  await p.goto(url.replace(/\/$/, '') + '/arkiv.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const arkivtext = await p.locator('#arkivposter').textContent() || '';
  k(namn + ': arkivsidan läser index', !arkivtext.includes('Kunde inte'));
  await p.close();
}

console.log(kollar.map(([n, v]) => (v ? '  OK   ' : '  FEL  ') + n).join('\n'));
console.log('misslyckade:', kollar.filter(([, v]) => !v).length);
await b.close();
