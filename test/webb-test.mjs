import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
const fel = [];
p.on('pageerror', e => fel.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/500|Failed to load resource/.test(m.text())) fel.push('KONSOL ' + m.text()); });
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);

/* Appen öppnar lösenordsrutan automatiskt för konton med startlösenord. */
const stangDialoger = async (p) => {
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await p.waitForTimeout(200);
};

const kollar = [];
const k = (namn, v) => kollar.push([namn, v]);
k('5 passflikar', await p.locator('#pass-tabs button').count() === 5);
k('4 moment i löpning', await p.locator('.block').count() === 4);
k('navlänkar', await p.locator('#block-nav a').count() === 4);
k('utloggad: ingen redigera-knapp', await p.locator('button[data-action=redigera]').count() === 0);
k('utloggad: user-box dold', !(await p.locator('#user-box').isVisible()));
k('sidräknare visas', await p.locator('.sidvarning').isVisible());

await p.click('#btn-login');
await p.fill('#login-user','Johan'); await p.fill('#login-pass','Johan');
await p.click('#form-login button[type=submit]');
await p.waitForTimeout(1500);
k('lösenordsrutan öppnas direkt', await p.locator('#dlg-password').evaluate(d => d.open));
await stangDialoger(p);
k('inloggad: 4 redigera-knappar', await p.locator('button[data-action=redigera]').count() === 4);
k('inloggad: passinfo-knapp', await p.locator('#pass-facts button').count() === 1);
k('inloggad: lägg till block', await p.locator('#btn-add-block').isVisible());

// byt lösenord: fel gammalt
await stangDialoger(p);
await p.click('#btn-password');
await p.fill('#pw-old','fel'); await p.fill('#pw-new','nyttlosen123'); await p.fill('#pw-new2','nyttlosen123');
await p.click('#form-password button[type=submit]');
await p.waitForTimeout(600);
k('fel gammalt lösenord ger felmeddelande', await p.locator('#pw-error').isVisible());
// olika nya
await p.fill('#pw-new2','annat123456');
await p.click('#form-password button[type=submit]');
await p.waitForTimeout(300);
k('olika nya lösenord fångas', (await p.locator('#pw-error').textContent()).includes('inte lika'));
// rätt
await p.fill('#pw-old','Johan'); await p.fill('#pw-new','nyttlosen123'); await p.fill('#pw-new2','nyttlosen123');
await p.click('#form-password button[type=submit]');
await p.waitForTimeout(900);
k('lösenordsbyte lyckas', (await p.locator('#status').textContent()).includes('bytt'));

// logga ut / in med nya lösenordet
await stangDialoger(p);
await p.click('#btn-logout'); await p.waitForTimeout(800);
await p.click('#btn-login');
await p.fill('#login-user','johan'); await p.fill('#login-pass','nyttlosen123');
await p.click('#form-login button[type=submit]');
await p.waitForTimeout(1200);
k('inloggning med nytt lösenord', await p.locator('#user-box').isVisible());
k('ingen "byt lösenord"-varning längre', !(await p.locator('#status').textContent()).includes('startlösenordet'));

// gammalt lösenord ska inte funka
await stangDialoger(p);
await p.click('#btn-logout'); await p.waitForTimeout(500);
await p.click('#btn-login');
await p.fill('#login-user','johan'); await p.fill('#login-pass','Johan');
await p.click('#form-login button[type=submit]');
await p.waitForTimeout(900);
k('gammalt lösenord avvisas', await p.locator('#login-error').isVisible());

console.log(kollar.map(([n,v]) => (v?'  OK   ':'  FEL  ')+n).join('\n'));
console.log('misslyckade:', kollar.filter(([,v])=>!v).length);
console.log('sidfel:', fel.length?fel:'inga');
await b.close();
