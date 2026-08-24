/* ===========================================================
   Redigering – bara aktiv när en ledare är inloggad.
   Varje sparning skickas till API:t som gör en commit i GitHub,
   så ingen information kan försvinna.
   =========================================================== */
(function () {
  var el = null;   // sätts i init (Render.el)

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

  /* ---------- Redigera passets fakta ---------- */
  function redigeraPass() {
    var pass = App.pass();
    var form = el("div", "redigera-form no-print");

    var titel = faltText("Rubrik", pass.titel);
    var datum = el("label", null, "Datum");
    var dInput = el("input"); dInput.type = "date"; dInput.value = pass.datum || "";
    datum.appendChild(dInput);
    var tid = faltText("Tid", pass.tid, "T.ex. 18:00–19:30");
    var plats = faltText("Plats", pass.plats);
    var grupp = faltText("Grupp", pass.grupp);
    var ledare = faltText("Ansvariga ledare", (pass.ansvarigaLedare || []).join(", "),
                          "Skriv namn separerade med komma");

    var g = pass.gemensamt || {};
    var upp = faltTextarea("Uppvärmning", g.uppvarmning);
    var info = faltTextarea("Upplägg / gemensam info", g.info);
    var slut = faltTextarea("Avslutning", g.avslutning);

    form.appendChild(titel.label);
    var rad1 = el("div", "form-rad");
    rad1.appendChild(datum); rad1.appendChild(tid.label); rad1.appendChild(plats.label);
    form.appendChild(rad1);
    var rad2 = el("div", "form-rad");
    rad2.appendChild(grupp.label); rad2.appendChild(ledare.label);
    form.appendChild(rad2);
    form.appendChild(upp.label); form.appendChild(info.label); form.appendChild(slut.label);

    var actions = el("div", "form-actions");
    actions.appendChild(knapp("Spara", "btn-primary", function () {
      pass.titel = titel.input.value.trim();
      pass.datum = dInput.value;
      pass.tid = tid.input.value.trim();
      pass.plats = plats.input.value.trim();
      pass.grupp = grupp.input.value.trim();
      pass.ansvarigaLedare = ledare.input.value.split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);
      pass.gemensamt = {
        uppvarmning: upp.input.value,
        info: info.input.value,
        avslutning: slut.input.value
      };
      App.spara("Uppdaterade passinformationen").catch(function () {});
    }));
    actions.appendChild(knapp("Avbryt", "btn-ghost", function () { App.rita(); }));
    actions.appendChild(knapp("Arkivera passet", "btn-ghost", function () {
      App.arkivera();
    }));
    form.appendChild(actions);

    var v = document.getElementById("pass-head");
    var gammal = v.querySelector(".redigera-form");
    if (gammal) gammal.remove();
    v.appendChild(form);
    titel.input.focus();
  }

  /* ---------- Bilagor (bild / pdf) ---------- */
  function bilagePanel(block, ritaOm) {
    var box = el("div");

    if ((block.bilder || []).length) {
      box.appendChild(el("p", "hjalp", "Bilder i blocket:"));
      var lb = el("ul", "bilaga-lista");
      block.bilder.forEach(function (b, i) {
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
          block.bilder.splice(i, 1); ritaOm();
        }));
        lb.appendChild(li);
      });
      box.appendChild(lb);
    }

    if ((block.filer || []).length) {
      box.appendChild(el("p", "hjalp", "Bilagor (PDF/dokument):"));
      var lf = el("ul", "bilaga-lista");
      block.filer.forEach(function (f, i) {
        var li = el("li", "bilaga-rad");
        li.appendChild(el("span", null, f.typ === "pdf" ? "📄" : "📎"));
        var txt = el("input"); txt.type = "text"; txt.value = f.namn || "";
        txt.addEventListener("input", function () { f.namn = txt.value; });
        li.appendChild(txt);
        li.appendChild(knapp("Ta bort", "btn-liten btn-fara", function () {
          block.filer.splice(i, 1); ritaOm();
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
      "Bilder visas i blocket, PDF/dokument läggs som bilaga. Filerna sparas i GitHub tillsammans med passet."));
    fil.addEventListener("change", function () {
      var filer = Array.prototype.slice.call(fil.files || []);
      if (!filer.length) return;
      App.status("info", "Laddar upp " + filer.length + " fil(er)…");
      var kedja = Promise.resolve();
      filer.forEach(function (f) {
        kedja = kedja.then(function () {
          return window.API.laddaUpp(f, block.id).then(function (r) {
            if (r.typ === "bild") {
              block.bilder = block.bilder || [];
              block.bilder.push({ url: r.url, bildtext: "" });
            } else {
              block.filer = block.filer || [];
              block.filer.push({ url: r.url, namn: r.namn, typ: r.typ });
            }
          });
        });
      });
      kedja.then(function () {
        App.status("ok", "Uppladdat. Kom ihåg att spara blocket.");
        ritaOm();
      }).catch(function (e) {
        App.status("fel", "Uppladdning misslyckades: " + e.message);
      });
    });
    box.appendChild(uppLabel);
    return box;
  }

  /* ---------- Redigera ett block ---------- */
  function redigeraBlock(blockId) {
    var pass = App.pass();
    var block = (pass.block || []).filter(function (b) { return b.id === blockId; })[0];
    if (!block) return;

    var kort = document.getElementById("block-" + blockId);
    if (!kort) return;
    var gammal = kort.querySelector(".redigera-form");
    if (gammal) { gammal.remove(); return; }

    var form = el("div", "redigera-form no-print");
    var namn = faltText("Blockets namn", block.namn);
    var ikon = faltText("Ikon (emoji)", block.ikon, "T.ex. 🏃 🤸 🎯");
    var ansvarig = faltText("Ledare för blocket", block.ansvarig);
    var syfte = faltText("Syfte / fokus", block.syfte);
    var text = faltTextarea("Innehåll", block.text,
      "Enkel formatering: **fet**, *kursiv*, - punktlista, 1. numrerad lista, [text](länk).");

    var rad = el("div", "form-rad");
    rad.appendChild(namn.label); rad.appendChild(ikon.label); rad.appendChild(ansvarig.label);
    form.appendChild(rad);
    form.appendChild(syfte.label);
    form.appendChild(text.label);

    function ritaOm() { App.rita(); redigeraBlock(blockId); }
    form.appendChild(bilagePanel(block, ritaOm));

    var actions = el("div", "form-actions");
    actions.appendChild(knapp("Spara block", "btn-primary", function () {
      block.namn = namn.input.value.trim() || block.namn;
      block.ikon = ikon.input.value.trim();
      block.ansvarig = ansvarig.input.value.trim();
      block.syfte = syfte.input.value.trim();
      block.text = text.input.value;
      App.spara("Uppdaterade blocket " + block.namn).catch(function () {});
    }));
    actions.appendChild(knapp("Avbryt", "btn-ghost", function () { App.laddaOm(); }));
    actions.appendChild(knapp("Ta bort blocket", "btn-fara", function () {
      if (!confirm("Ta bort blocket \"" + block.namn + "\" från det aktuella passet?\n\n" +
                   "Innehållet finns kvar i historiken i GitHub och kan återställas.")) return;
      pass.block = pass.block.filter(function (b) { return b.id !== blockId; });
      pass.block.forEach(function (b, i) { b.ordning = i + 1; });
      App.spara("Tog bort blocket " + block.namn).catch(function () {});
    }));
    form.appendChild(actions);

    kort.appendChild(form);
    namn.input.focus();
  }

  /* ---------- Nytt block ---------- */
  function nyttBlock() {
    var pass = App.pass();
    var namn = prompt("Vad ska det nya blocket heta?", "Nytt block");
    if (namn === null) return;
    namn = namn.trim(); if (!namn) return;

    var bas = namn.toLowerCase()
      .replace(/å|ä/g, "a").replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "block";
    var id = bas, n = 2;
    while (pass.block.some(function (b) { return b.id === id; })) { id = bas + "-" + (n++); }

    pass.block.push({
      id: id, namn: namn, ikon: "", ordning: pass.block.length + 1,
      ansvarig: "", syfte: "", text: "", bilder: [], filer: []
    });
    App.spara("Lade till blocket " + namn)
       .then(function () { redigeraBlock(id); })
       .catch(function () {});
  }

  /* ---------- Flytta block ---------- */
  function flytta(blockId, riktning) {
    var pass = App.pass();
    var lista = pass.block.slice().sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); });
    var i = lista.findIndex(function (b) { return b.id === blockId; });
    var j = i + (riktning === "upp" ? -1 : 1);
    if (i < 0 || j < 0 || j >= lista.length) return;
    var tmp = lista[i]; lista[i] = lista[j]; lista[j] = tmp;
    lista.forEach(function (b, k) { b.ordning = k + 1; });
    pass.block = lista;
    App.spara("Ändrade ordningen på blocken").catch(function () {});
  }

  window.Edit = {
    init: init,
    redigeraPass: redigeraPass,
    redigeraBlock: redigeraBlock,
    nyttBlock: nyttBlock,
    flytta: flytta,
    knapp: knapp
  };
})();
