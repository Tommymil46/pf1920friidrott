/* Testar arkivet: arkivera från förstasidan, lista och visa i arkivsidan. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 950 } });
const fel = [];
p.on('pageerror', e => fel.push('PAGEERROR ' + e.message));
p.on('dialog', d => d.accept());

/* Startlösenordet duger bara till att byta lösenord – gör det först.
   Appen öppnar lösenordsrutan automatiskt vid inloggning. */
async function stangDialoger(p) {
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await p.waitForTimeout(200);
}

async function byteLosenord(p, start, nytt) {
  await stangDialoger(p);
  await p.click('#btn-password');
  await p.waitForTimeout(300);
  await p.fill('#pw-old', start);
  await p.fill('#pw-new', nytt);
  await p.fill('#pw-new2', nytt);
  await p.click('#form-password button[type=submit]');
  await p.waitForTimeout(1000);
}

const kollar = [];
const k = (n, v) => kollar.push([n, !!v]);
const BAS = process.env.BAS || 'http://127.0.0.1:8096';

// tomt arkiv
await p.goto(BAS + '/arkiv.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
k('tomt arkiv förklaras', (await p.locator('#arkivposter').textContent()).includes('tomt'));

// arkivera från förstasidan
await p.goto(BAS + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.click('#btn-login');
await p.fill('#login-user','Johan'); await p.fill('#login-pass','Johan');
await p.click('#form-login button[type=submit]');
await p.waitForTimeout(1200);
await byteLosenord(p, 'Johan', 'ettLangtLosenord2');
await p.locator('#pass-facts button').click();          // Redigera passinfo
await p.waitForTimeout(400);
await p.locator('#pass-head .form-actions button', { hasText: 'Arkivera passet' }).click();
await p.waitForTimeout(2000);
const st = await p.locator('#status').textContent();
k('arkivering bekräftad (' + st.trim() + ')', st.includes('arkiverat'));
k('filnamn av datum + rubrik', /2026-08-26-lopning\.json/.test(st));

// listan
await p.goto(BAS + '/arkiv.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
k('ett kort i arkivet', await p.locator('.arkiv-kort').count() === 1);
k('datum skrivs ut på svenska', (await p.locator('.arkiv-datum').textContent()).includes('onsdag 26 augusti 2026'));
k('momenten listas som etiketter', await p.locator('.arkiv-etikett').count() === 4);

// öppna passet
await p.locator('.arkiv-kort').click();
await p.waitForTimeout(1500);
k('passet visas', await p.locator('#arkivpass .block').count() === 4);
k('inga redigeringsknappar i arkivet', await p.locator('button[data-action=redigera]').count() === 0);
k('arkiveringsinfo i foten', (await p.locator('#meta-line').textContent()).includes('Arkiverat'));
k('rubriken byts', (await p.locator('#sidrubrik').textContent()).startsWith('Arkiverat pass'));

// tillbaka
await p.click('#btn-tillbaka');
await p.waitForTimeout(500);
k('tillbaka till listan', await p.locator('#arkivlista').isVisible());

console.log(kollar.map(([n,v]) => (v?'  OK   ':'  FEL  ')+n).join('\n'));
console.log('misslyckade:', kollar.filter(([,v])=>!v).length);
console.log('sidfel:', fel.length?fel:'inga');
await b.close();
