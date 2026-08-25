/* ===========================================================
   Redigering – bara aktiv när en ledare är inloggad.
   Varje sparning skickas till API:t som gör en commit i GitHub,
   så ingen information kan försvinna.
   =========================================================== */
(function () {
  var el = null;   // sätts i init (Render.el)
  var MINST_MOMENT = 4;

  var App = null;  // sätts i init

  function init(app) { App = app; el = window.Render.el; }

  /* ---------- Hjälpare ---------- */
  function faltText(etikett, varde, hjalp) {
    var l = el("label", null, etikett);
    var i = el("input"); i.type = "text"; i.value = varde || "";
    l.appendChild(i);
    if (hjalp) l.appendChild(el("p", "hjalp", hjalp));
    return { label: l, input: i };
  }
  function faltTextarea(etikett, varde, hjalp) {
    var l = el("label", null, etikett);
    var t = el("textarea"); t.value = varde || "";
    l.appendChild(t);
    if (hjalp) l.appendChild(el("p", "hjalp", hjalp));
    return { label: l, input: t };
  }
  function knapp(text, klass, fn) {
    var b = el("button", "btn " + klass, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /* ---------- Redigera det valda passets fakta ---------- */
  function redigeraPass() {
    var pass = App.pass();
    var form = el("div", "redigera-form no-print");

    var namn = faltText("Namn", pass.namn);
    var ikon = faltText("Ikon (emoji)", pass.ikon, "T.ex. 🏃 🤸 🎯 ⬆️ ↔️");
    var datum = el("label", null, "Datum");
    var dInput = el("input"); dInput.type = "date"; dInput.value = pass.datum || "";
    datum.appendChild(dInput);
    var tid = faltText("Tid", pass.tid, "T.ex. 18:00–19:30");
    var plats = faltText("Plats", pass.plats);
    var grupp = faltText("Grupp", pass.grupp);
    var ledare = faltText("Ansvariga ledare", (pass.ansvarigaLedare || []).join(", "),
                          "Skriv namn separerade med komma");

    var samling = faltTextarea("Samling", pass.samling);
    var upp = faltTextarea("Uppvärmning", pass.uppvarmning);
    var slut = faltTextarea("Avslutning", pass.avslutning);

    var rad0 = el("div", "form-rad");
    rad0.appendChild(namn.label); rad0.appendChild(ikon.label);
    form.appendChild(rad0);
    var rad1 = el("div", "form-rad");
    rad1.appendChild(datum); rad1.appendChild(tid.label); rad1.appendChild(plats.label);
    form.appendChild(rad1);
    var rad2 = el("div", "form-rad");
    rad2.appendChild(grupp.label); rad2.appendChild(ledare.label);
    form.appendChild(rad2);
    form.appendChild(samling.label); form.appendChild(upp.label); form.appendChild(slut.label);

    var actions = el("div", "form-actions");
    actions.appendChild(knapp("Spara", "btn-primary", function () {
      pass.namn = namn.input.value.trim() || pass.namn;
      pass.ikon = ikon.input.value.trim();
      pass.datum = dInput.value;
      pass.tid = tid.input.value.trim();
      pass.plats = plats.input.value.trim();
      pass.grupp = grupp.input.value.trim();
      pass.ansvarigaLedare = ledare.input.value.split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);
      pass.samling = samling.input.value;
      pass.uppvarmning = upp.input.value;
      pass.avslutning = slut.input.value;
      App.spara("Uppdaterade passinformationen för " + pass.namn).catch(function () {});
    }));
    actions.appendChild(knapp("Avbryt", "btn-ghost", function () { App.rita(); }));
    if (!App.arAktivt()) {
      actions.appendChild(knapp("Sätt som aktuellt pass", "btn-ghost", function () {
        App.sattAktivt();
      }));
    }
    actions.appendChild(knapp("Arkivera passet", "btn-ghost", function () {
      App.arkivera();
    }));
    form.appendChild(actions);

    var v = document.getElementById("pass-head");
    var gammal = v.querySelector(".redigera-form");
    if (gammal) gammal.remove();
    v.appendChild(form);
    namn.input.focus();
  }

  /* ---------- Bilagor (bild / pdf) ---------- */
  function bilagePanel(moment, ritaOm) {
    var box = el("div");

    if ((moment.bilder || []).length) {
      box.appendChild(el("p", "hjalp", "Bilder i momentet:"));
      var lb = el("ul", "bilaga-lista");
      moment.bilder.forEach(function (b, i) {
        var li = el("li", "bilaga-rad");
        var img = el("img"); img.src = window.API.filUrl(b.url); img.alt = "";
        var reserv = window.API.filUrlReserv(b.url);
        if (reserv) {                       /* nyss uppladdad, inte publicerad än */
          img.addEventListener("error", function omErr() {
            img.removeEventListener("error", omErr); img.src = reserv;
          });
        }
        var txt = el("input"); txt.type = "text"; txt.value = b.bildtext || "";
        txt.placeholder = "Bildtext";
        txt.addEventListener("input", function () { b.bildtext = txt.value; });
        li.appendChild(img); li.appendChild(txt);
        li.appendChild(knapp("Ta bort", "btn-liten btn-fara", function () {
          moment.bilder.splice(i, 1); ritaOm();
        }));
        lb.appendChild(li);
      });
      box.appendChild(lb);
    }

    if ((moment.filer || []).length) {
      box.appendChild(el("p", "hjalp", "Bilagor (PDF/dokument):"));
      var lf = el("ul", "bilaga-lista");
      moment.filer.forEach(function (f, i) {
        var li = el("li", "bilaga-rad");
        li.appendChild(el("span", null, f.typ === "pdf" ? "📄" : "📎"));
        var txt = el("input"); txt.type = "text"; txt.value = f.namn || "";
        txt.addEventListener("input", function () { f.namn = txt.value; });
        li.appendChild(txt);
        li.appendChild(knapp("Ta bort", "btn-liten btn-fara", function () {
          moment.filer.splice(i, 1); ritaOm();
        }));
        lf.appendChild(li);
      });
      box.appendChild(lf);
    }

    var uppLabel = el("label", null, "Ladda upp bild eller PDF");
    var fil = el("input");
    fil.type = "file";
    fil.accept = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md";
    fil.multiple = true;
    uppLabel.appendChild(fil);
    uppLabel.appendChild(el("p", "hjalp",
      "Bilder visas i momentet, PDF/dokument läggs som bilaga. Filerna sparas i GitHub tillsammans med passet."));
    fil.addEventListener("change", function () {
      var filer = Array.prototype.slice.call(fil.files || []);
      if (!filer.length) return;
      App.status("info", "Laddar upp " + filer.length + " fil(er)…");
      var kedja = Promise.resolve();
      filer.forEach(function (f) {
        kedja = kedja.then(function () {
          return window.API.laddaUpp(f, moment.id).then(function (r) {
            if (r.typ === "bild") {
              moment.bilder = moment.bilder || [];
              moment.bilder.push({ url: r.url, bildtext: "" });
            } else {
              moment.filer = moment.filer || [];
              moment.filer.push({ url: r.url, namn: r.namn, typ: r.typ });
            }
          });
        });
      });
      kedja.then(function () {
        App.status("ok", "Uppladdat. Kom ihåg att spara momentet.");
        ritaOm();
      }).catch(function (e) {
        App.status("fel", "Uppladdning misslyckades: " + e.message);
      });
    });
    box.appendChild(uppLabel);
    return box;
  }

  /* ---------- Redigera ett friidrottsmoment ---------- */
  function redigeraMoment(momentId) {
    var pass = App.pass();
    var moment = (pass.moment || []).filter(function (m) { return m.id === momentId; })[0];
    if (!moment) return;

    var kort = document.getElementById("block-" + momentId);
    if (!kort) return;
    var gammal = kort.querySelector(".redigera-form");
    if (gammal) { gammal.remove(); return; }

    var form = el("div", "redigera-form no-print");
    var namn = faltText("Momentets namn", moment.namn);
    var ikon = faltText("Ikon (emoji)", moment.ikon, "T.ex. 🏃 🤸 🎯");
    var ansvarig = faltText("Ledare för momentet", moment.ansvarig);
    var syfte = faltText("Syfte / fokus", moment.syfte);
    var text = faltTextarea("Innehåll", moment.text,
      "Enkel formatering: **fet**, *kursiv*, - punktlista, 1. numrerad lista, [text](länk).");

    var rad = el("div", "form-rad");
    rad.appendChild(namn.label); rad.appendChild(ikon.label); rad.appendChild(ansvarig.label);
    form.appendChild(rad);
    form.appendChild(syfte.label);
    form.appendChild(text.label);

    function ritaOm() { App.rita(); redigeraMoment(momentId); }
    form.appendChild(bilagePanel(moment, ritaOm));

    var actions = el("div", "form-actions");
    actions.appendChild(knapp("Spara moment", "btn-primary", function () {
      moment.namn = namn.input.value.trim() || moment.namn;
      moment.ikon = ikon.input.value.trim();
      moment.ansvarig = ansvarig.input.value.trim();
      moment.syfte = syfte.input.value.trim();
      moment.text = text.input.value;
      App.spara("Uppdaterade momentet " + moment.namn).catch(function () {});
    }));
    actions.appendChild(knapp("Avbryt", "btn-ghost", function () { App.laddaOm(); }));
    actions.appendChild(knapp("Ta bort momentet", "btn-fara", function () {
      if (pass.moment.length <= MINST_MOMENT) {
        alert("Passet \"" + pass.namn + "\" behöver minst " + MINST_MOMENT + " friidrottsmoment. " +
              "Lägg till ett nytt moment innan du tar bort det här.");
        return;
      }
      if (!confirm("Ta bort momentet \"" + moment.namn + "\" från passet \"" + pass.namn + "\"?\n\n" +
                   "Innehållet finns kvar i historiken i GitHub och kan återställas.")) return;
      pass.moment = pass.moment.filter(function (m) { return m.id !== momentId; });
      pass.moment.forEach(function (m, i) { m.ordning = i + 1; });
      App.spara("Tog bort momentet " + moment.namn + " från " + pass.namn).catch(function () {});
    }));
    form.appendChild(actions);

    kort.appendChild(form);
    namn.input.focus();
  }

  /* ---------- Nytt friidrottsmoment ---------- */
  function nyttMoment() {
    var pass = App.pass();
    var namn = prompt("Vad ska det nya momentet heta?", "Nytt moment");
    if (namn === null) return;
    namn = namn.trim(); if (!namn) return;

    var bas = namn.toLowerCase()
      .replace(/å|ä/g, "a").replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "moment";
    var id = bas, n = 2;
    while (pass.moment.some(function (m) { return m.id === id; })) { id = bas + "-" + (n++); }

    pass.moment.push({
      id: id, namn: namn, ikon: pass.ikon || "", ordning: pass.moment.length + 1,
      ansvarig: "", syfte: "", text: "", bilder: [], filer: []
    });
    App.spara("Lade till momentet " + namn + " i " + pass.namn)
       .then(function () { redigeraMoment(id); })
       .catch(function () {});
  }

  /* ---------- Flytta ett moment ---------- */
  function flyttaMoment(momentId, riktning) {
    var pass = App.pass();
    var lista = pass.moment.slice().sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); });
    var i = lista.findIndex(function (m) { return m.id === momentId; });
    var j = i + (riktning === "upp" ? -1 : 1);
    if (i < 0 || j < 0 || j >= lista.length) return;
    var tmp = lista[i]; lista[i] = lista[j]; lista[j] = tmp;
    lista.forEach(function (m, k) { m.ordning = k + 1; });
    pass.moment = lista;
    App.spara("Ändrade ordningen på momenten i " + pass.namn).catch(function () {});
  }

  window.Edit = {
    init: init,
    redigeraPass: redigeraPass,
    redigeraMoment: redigeraMoment,
    nyttMoment: nyttMoment,
    flyttaMoment: flyttaMoment,
    knapp: knapp
  };
})();
