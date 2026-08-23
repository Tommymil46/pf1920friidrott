import { chromium } from 'playwright';
import fs from 'node:fs';
const SP = process.env.SP || '.';
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

await p.goto('http://127.0.0.1:8096/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
k('läser passet från GitHub', (await p.locator('.pass-titel').textContent()).includes('Aktuellt'));

await p.click('#btn-login');
await p.fill('#login-user','Eric'); await p.fill('#login-pass','Eric');
await p.click('#form-login button[type=submit]');
await p.waitForTimeout(1200);
k('inloggad', await p.locator('#user-box').isVisible());

k('lösenordsrutan öppnas direkt vid startlösenord',
  await p.locator('#dlg-password').evaluate(d => d.open));

// startlösenordet ska inte räcka för att ändra något
await stangDialoger(p);
await p.locator('#block-lopning button[data-action=redigera]').click();
await p.waitForTimeout(400);
await p.locator('#block-lopning .form-actions button', { hasText: 'Spara block' }).click();
await p.waitForTimeout(1200);
k('startlösenord blockeras vid sparning',
  (await p.locator('#status').textContent()).includes('byta ditt startlösenord'));
await byteLosenord(p, 'Eric', 'ettLangtLosenord1');
k('lösenordsbyte klart', (await p.locator('#status').textContent()).includes('bytt'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

await p.locator('#block-lopning button[data-action=redigera]').click();
await p.waitForTimeout(400);
await p.locator('#block-lopning textarea').fill('**Nytt innehåll** från testet.\n\n- Punkt ett\n- Punkt två');
await p.locator('#block-lopning input[type=text]').nth(2).fill('Eric');
await p.locator('#block-lopning .form-actions button', { hasText: 'Spara block' }).click();
await p.waitForTimeout(1600);
k('sparat till GitHub', (await p.locator('#status').textContent()).includes('incheckad'));
k('nytt innehåll visas', (await p.locator('#block-lopning .block-text').textContent()).includes('Nytt innehåll'));
k('fet stil renderas', await p.locator('#block-lopning .block-text strong').count() > 0);
k('ansvarig visas', (await p.locator('#block-lopning .block-ansvarig').textContent()).includes('Eric'));

await p.locator('#block-lopning button[data-action=redigera]').click();
await p.waitForTimeout(400);
fs.writeFileSync(SP+'/uppladdning.png', Buffer.from('89504e470d0a1a0a0000000d49484452','hex'));
await p.locator('#block-lopning input[type=file]').setInputFiles(SP+'/uppladdning.png');
await p.waitForTimeout(1800);
k('uppladdning bekräftad', (await p.locator('#status').textContent()).includes('Uppladdat'));
k('bilagelistan visar bilden', await p.locator('#block-lopning .bilaga-rad').count() === 1);
await p.locator('#block-lopning .form-actions button', { hasText: 'Spara block' }).click();
await p.waitForTimeout(1600);
k('bilden med i sparat block', await p.locator('#block-lopning .bild-kort').count() === 1);

await p.evaluate(() => { window.prompt = () => 'Häck'; });
await p.click('#btn-add-block');
await p.waitForTimeout(1800);
k('nytt block skapat', await p.locator('.block').count() === 6);
k('nytt block i navigeringen', (await p.locator('#block-nav').textContent()).includes('Häck'));

await p.locator('#block-hack button[data-action=upp]').click();
await p.waitForTimeout(1600);
const ordning = await p.locator('.block h2').allTextContents();
k('blocket flyttades upp (' + ordning.join(',') + ')', ordning[4] === 'Häck');

await p.locator('#block-hack button[data-action=redigera]').click();
await p.waitForTimeout(400);
await p.locator('#block-hack .form-actions button', { hasText: 'Ta bort blocket' }).click();
await p.waitForTimeout(1800);
k('blocket borttaget', await p.locator('.block').count() === 5);

await p.click('#btn-history');
await p.waitForTimeout(1400);
const rader = await p.locator('.hist-rad').count();
k('historiken listar alla ändringar (' + rader + ')', rader >= 5);
k('historiken visar vem', (await p.locator('.hist-vem').first().textContent()) === 'Eric');

await p.locator('.hist-rad').nth(rader - 1).locator('button').click();
await p.waitForTimeout(2200);
k('återställd text', !(await p.locator('#block-lopning .block-text').textContent()).includes('Nytt innehåll'));
k('återställningen bekräftad', (await p.locator('#status').textContent()).includes('Återställt'));

console.log(kollar.map(([n,v]) => (v?'  OK   ':'  FEL  ')+n).join('\n'));
console.log('misslyckade:', kollar.filter(([,v])=>!v).length);
console.log('sidfel:', fel.length?fel:'inga');
await b.close();
