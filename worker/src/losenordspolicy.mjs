/* ===========================================================
   Lösenordspolicy – samma regler i worker/, server/ och web/.
   Längd framför krångel: inga krav på siffror eller specialtecken,
   bara spärr mot det en angripare provar först. Se docs/SAKERHET.md.
   =========================================================== */
const MIN_LANGD = 8;

/* Jämförs efter att siffror, mellanslag och specialtecken tagits bort,
   så att även "Hagunda2026!" och "lösenord 123" stoppas. */
const SPARRLISTA = [
  "hagunda", "hagundaif", "friidrott", "pf", "lösenord", "losenord",
  "password", "passw", "qwerty", "qwertyuiop", "asdf", "asdfgh", "abc", "abcd", "abcdef"
];

/* Returnerar ett felmeddelande, eller null om lösenordet godkänns. */
function kontrolleraNyttLosenord(nytt, { anvandarnamn = "", namn = "", gammalt = null } = {}) {
  const s = String(nytt || "");
  if ([...s].length < MIN_LANGD) return `Det nya lösenordet måste vara minst ${MIN_LANGD} tecken.`;
  if (gammalt !== null && s === String(gammalt)) return "Det nya lösenordet måste skilja sig från det nuvarande.";
  const liten = s.toLowerCase();
  const egna = [anvandarnamn, namn].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  if (egna.some((x) => liten.includes(x))) return "Lösenordet får inte innehålla ditt namn.";
  return lattgissat(s);
}

/* Lättgissat oavsett vem man är: ett och samma tecken, bara siffror/tecken,
   eller ett ord på spärrlistan. Returnerar felmeddelande eller null. */
function lattgissat(nytt) {
  const liten = String(nytt || "").toLowerCase();
  if (/^(.)\1*$/u.test(liten.replace(/\s/g, ""))) return "Lösenordet får inte bestå av ett och samma tecken.";
  const bokstaver = liten.replace(/[^\p{L}]/gu, "");
  if (!bokstaver) return "Lösenordet får inte bara bestå av siffror och tecken – använd gärna ett par ord.";
  if (SPARRLISTA.includes(bokstaver)) return "Det lösenordet är för lätt att gissa. Välj något annat, gärna ett par ord.";
  return null;
}

export { kontrolleraNyttLosenord, lattgissat, MIN_LANGD };
