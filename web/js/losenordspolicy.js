(function () {
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

  window.Losenordspolicy = { kontrollera: kontrolleraNyttLosenord, lattgissat: lattgissat, MIN_LANGD: MIN_LANGD };
})();

/* "Visa lösenorden" i dialogen Byt lösenord – underlättar långa
   lösenord på mobilen. */
(function () {
  var kryss = document.getElementById("pw-visa");
  if (!kryss) return;
  function satt() {
    ["pw-old", "pw-new", "pw-new2"].forEach(function (id) {
      var f = document.getElementById(id);
      if (f) f.type = kryss.checked ? "text" : "password";
    });
  }
  kryss.addEventListener("change", satt);
  var dlg = document.getElementById("dlg-password");
  if (dlg) dlg.addEventListener("close", function () { kryss.checked = false; satt(); });
})();

/* Checklistan i dialogen Byt lösenord bockas av medan ledaren skriver,
   så att reglerna syns precis när de behövs. Tjänsten kontrollerar
   samma regler igen när lösenordet sparas. */
(function () {
  var lista = document.getElementById("pw-regler");
  if (!lista) return;
  var P = window.Losenordspolicy;
  function falt(id) { return document.getElementById(id); }
  function markera(regel, ok, tomt) {
    var li = lista.querySelector('[data-regel="' + regel + '"]');
    if (!li) return;
    li.classList.toggle("ok", !tomt && ok);
    li.classList.toggle("nej", !tomt && !ok);
  }
  function uppdatera() {
    var nytt = falt("pw-new").value, igen = falt("pw-new2").value, gammalt = falt("pw-old").value;
    var jag = (window.API && window.API.anvandare()) || {};
    var liten = nytt.toLowerCase();
    var egna = [jag.id, jag.namn].map(function (x) { return String(x || "").trim().toLowerCase(); })
                                 .filter(Boolean);
    var tomt = !nytt;
    markera("langd", Array.from(nytt).length >= P.MIN_LANGD, tomt);
    markera("namn", !egna.some(function (x) { return liten.indexOf(x) !== -1; }), tomt);
    markera("olikt", !gammalt || nytt !== gammalt, tomt);
    markera("gissa", !P.lattgissat(nytt), tomt);
    markera("lika", nytt === igen, tomt || !igen);
  }
  ["pw-old", "pw-new", "pw-new2"].forEach(function (id) {
    var f = falt(id);
    if (f) f.addEventListener("input", uppdatera);
  });
  var dlg = document.getElementById("dlg-password");
  if (dlg) dlg.addEventListener("close", function () { setTimeout(uppdatera, 0); });
})();
