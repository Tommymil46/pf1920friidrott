/* Enhetstest för matchningen av lekar i text (web/js/leklankar.js). */
import { createRequire } from 'module';
import fs from 'fs';
const L = createRequire(import.meta.url)('../web/js/leklankar.js');
const lekar = JSON.parse(fs.readFileSync(new URL('../content/lekar.json', import.meta.url))).lekar;
const idx = L.byggIndex(lekar);
const namn = (t) => L.hitta(t, idx).map(x => x.lek.id + '=' + t.slice(x.start, x.slut));
let fel = 0;
const lika = (rubrik, fas, ska) => {
  const a = JSON.stringify(fas), b = JSON.stringify(ska);
  if (a !== b) { fel++; console.log('FEL', rubrik, a, '!=', b); } else console.log('ok ', rubrik);
};
lika('kommatecken i namnet', namn('Rött ljus grönt ljus'), ['rott-ljus-gront-ljus=Rött ljus grönt ljus']);
lika('exakt namn', namn('Rött ljus, grönt ljus.'), ['rott-ljus-gront-ljus=Rött ljus, grönt ljus']);
lika('skiftläge', namn('RÖTT LJUS GRÖNT LJUS'), ['rott-ljus-gront-ljus=RÖTT LJUS GRÖNT LJUS']);
lika('lista med komma', namn('Lekar: Banankull, Rött ljus grönt ljus.'),
  ['banankull=Banankull', 'rott-ljus-gront-ljus=Rött ljus grönt ljus']);
lika('längsta träff (Kasta ärtpåsar – lek 2)', namn('Kasta ärtpåsar - lek 2'), ['kasta-artpasar-lek-2=Kasta ärtpåsar - lek 2']);
lika('delord matchar inte (Banankullen)', namn('Banankullen och Kullager'), []);
lika('okänd lek förblir text', namn('Stafett med ärtpåse i ribbstol'), []);
lika('å/ä/ö skiljs åt', namn('Odlorna på marken'), []);
lika('Ö-namn', namn('Ödlorna på marken'), ['odlorna-pa-marken=Ödlorna på marken']);
lika('tom text', namn(''), []);
process.exit(fel ? 1 : 0);
