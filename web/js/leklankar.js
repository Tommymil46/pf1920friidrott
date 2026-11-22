/* ===========================================================
   Länkar lekar i löpande text till lekbanken.

   Matchningen sker på ord: skiftläge i resten av namnet, kommatecken och
   andra skiljetecken saknar betydelse (träffen ska dock börja med stor bokstav), så "Rött ljus grönt ljus"
   matchar leken "Rött ljus, grönt ljus". Längsta träff vinner.
   Inget skrivs in i texten – länkarna läggs på först vid
   rendering, så nya lekar och nya pass fungerar av sig själva.
   =========================================================== */
(function () {
  var ORD = /[\p{L}\p{N}]+/gu;

  function ordLista(text) {
    var ut = [], m;
    text = String(text || "").normalize("NFC");
    ORD.lastIndex = 0;
    while ((m = ORD.exec(text))) {
      ut.push({ ord: m[0].toLocaleLowerCase("sv"), start: m.index, slut: m.index + m[0].length });
    }
    return ut;
  }

  /* Bygger ett index {forstaOrd: [{ord:[...], lek}]} sorterat längst först. */
  function byggIndex(lekar) {
    var index = {};
    (lekar || []).forEach(function (l) {
      var o = ordLista(l && l.namn).map(function (x) { return x.ord; });
      if (!o.length || !l.id) return;
      (index[o[0]] = index[o[0]] || []).push({ ord: o, lek: l });
    });
    Object.keys(index).forEach(function (k) {
      index[k].sort(function (a, b) { return b.ord.length - a.ord.length; });
    });
    return index;
  }

  /* Returnerar träffar [{start, slut, lek}]; positionerna gäller texten NFC-normaliserad. */
  function hitta(text, index) {
    text = String(text || "").normalize("NFC");
    var ord = ordLista(text), traffar = [], i = 0;
    while (i < ord.length) {
      var kandidater = index[ord[i].ord], tr = null;
      if (kandidater) {
        for (var k = 0; k < kandidater.length && !tr; k++) {
          var n = kandidater[k].ord, ok = i + n.length <= ord.length;
          for (var j = 0; ok && j < n.length; j++) if (ord[i + j].ord !== n[j]) ok = false;
          /* Leknamn skrivs som namn: träffen måste börja med stor bokstav,
             så att "alla som är klara" eller "byt bo" i löpande text inte länkas. */
          var f = text.charAt(ord[i].start);
          if (f === f.toLocaleLowerCase("sv")) ok = false;
          if (ok) tr = { n: n.length, lek: kandidater[k].lek };
        }
      }
      if (tr) {
        traffar.push({ start: ord[i].start, slut: ord[i + tr.n - 1].slut, lek: tr.lek });
        i += tr.n;
      } else i++;
    }
    return traffar;
  }

  var API = { hitta: hitta, byggIndex: byggIndex, ordLista: ordLista };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else window.LekLankar = API;
})();
