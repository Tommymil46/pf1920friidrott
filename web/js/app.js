/* ===========================================================
   Sammanhållande logik: laddning, inloggning, sparning,
   historik och utskrift.
   =========================================================== */
(function () {
  var CFG = window.PASS_CONFIG || {};
  /* Indexet (vilket pass som är aktuellt + i vilken ordning flikarna
     ligger), varje pass och lekbanken lagras var för sig – var och en
     med sin egen sha, historik och återställning. */
  var state = { index: null, indexSha: null, pass: {}, lekar: null, lekarSha: null,
                schema: null, valtId: null, kalla: null };

  /* ---------- Schemastyrt aktuellt pass ----------
     Vilket pass som visas som "aktuellt" styrs i första hand av
     terminsschemat: det senaste tillfället t.o.m. idag som varken är
     inställt eller saknar pass. Håller ett höstlov utan att byta pass –
     det senast hållna passet räknas som aktuellt tills nästa tillfälle.
     Saknar schemat en träff (t.ex. innan/efter terminen) faller vi
     tillbaka på det manuellt satta "aktivt" i index.json. Inget sparas
     här – det är bara vad som visas vid sidladdning. */
  function idagISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }

  function schemaAktivtId() {
    var t = state.schema && state.schema.tillfallen;
    if (!Array.isArray(t)) return null;
    var idag = idagISO();
    var val = null;
    t.forEach(function (r) {
      if (r && r.pass && !r.installt && r.datum && r.datum <= idag) {
        if (!val || r.datum > val.datum) val = r;
      }
    });
    return val ? val.pass : null;
  }

  function effektivtAktivt() {
    return schemaAktivtId() || (state.index ? state.index.aktivt : null);
  }

  /* ---------- Status ---------- */
  var statusTimer = null;
  function status(typ, text, kvar) {
    var v = document.getElementById("status");
    clearTimeout(statusTimer);
    if (!text) { v.hidden = true; return; }
    v.className = "status no-print " + typ;
    v.textContent = text;
    v.hidden = false;
    if (!kvar) statusTimer = setTimeout(function () { v.hidden = true; }, 6000);
  }

  /* ---------- Rendering ---------- */
  function kanRedigera() { return !!(window.API.harApi() && window.API.anvandare()); }

  function visarLekar() { return state.valtId === window.Render.LEKAR_ID; }

  function valtPass() {
    if (visarLekar()) return null;
    var p = state.pass[state.valtId];
    return p ? p.data : null;
  }

  function lekar() {
    if (!state.lekar) state.lekar = { lekar: [] };
    if (!state.lekar.lekar) state.lekar.lekar = [];
    return state.lekar.lekar;
  }

  /* Render.rita förväntar sig en samlad vy {aktivt, pass:[...], lekar:[...]}
     – den byggs ihop här från de separata filerna inför varje ritning. */
  function samladVy() {
    return {
      aktivt: effektivtAktivt(),
      pass: ((state.index && state.index.pass) || []).map(function (id) {
        var p = state.pass[id];
        return p ? p.data : null;
      }).filter(Boolean),
      lekar: state.lekar ? state.lekar.lekar : []
    };
  }

  function vaxlaPass(id) {
    state.valtId = id;
    rita();
    window.scrollTo(0, 0);
  }

  function rita() {
    var visadPass = window.Render.rita(samladVy(), state.valtId, kanRedigera(), vaxlaPass);
    document.body.classList.toggle("redigerar", kanRedigera());
    if (kanRedigera() && visadPass) {
      var v = document.getElementById("pass-facts");
      var b = window.Edit.knapp("Redigera passinfo", "btn-ghost btn-liten no-print",
                                window.Edit.redigeraPass);
      b.style.marginTop = "10px";
      v.appendChild(b);
    }
    visaSidUppskattning();
  }

  function laddaOm() {
    return window.API.hamtaIndex().then(function (idx) {
      state.index = idx.data; state.indexSha = idx.sha || null; state.kalla = idx.kalla;
      var id_er = state.index.pass || [];
      return Promise.all(id_er.map(function (id) {
        return window.API.hamtaPassFil(id).then(function (p) {
          state.pass[id] = { data: p.data, sha: p.sha || null };
        });
      }).concat([
        window.API.hamtaLekar().then(function (l) {
          state.lekar = l.data; state.lekarSha = l.sha || null;
        }),
        window.API.hamtaSchema().then(function (s) {
          state.schema = s.data;
        }).catch(function () { state.schema = null; })
      ]));
    }).then(function () {
      state.valtId = effektivtAktivt();
      rita();
    }).catch(function (e) {
      status("fel", "Kunde inte hämta träningspassen: " + e.message, true);
    });
  }

  /* ---------- Spara ---------- */
  /* Returnerar alltid ett förkastat löfte (aldrig ett synkront kast), så
     att både spara() och sattAktivt() kan hantera det på samma sätt. */
  function hanteraSparaFel(e) {
    if (e.status === 403) {
      status("varning", "Du måste byta ditt startlösenord innan du kan spara. " +
                        "Klicka \"Byt lösenord\".", true);
      oppnaDialog("dlg-password");
      return Promise.reject(e);
    }
    if (e.status === 409) {
      status("varning", "Någon annan ledare hann spara före dig. Sidan laddas om – " +
                        "gör om din ändring. Inget har gått förlorat.", true);
      return laddaOm().then(function () { return Promise.reject(e); });
    }
    status("fel", "Kunde inte spara: " + e.message, true);
    return Promise.reject(e);
  }

  function sparaPassAktuell(meddelande) {
    var id = state.valtId;
    var post = state.pass[id];
    status("info", "Sparar till GitHub…", true);
    post.data.uppdaterad = new Date().toISOString();
    post.data.uppdateradAv = (window.API.anvandare() || {}).namn || "";
    return window.API.sparaPassFil(id, post.data, meddelande, post.sha)
      .then(function (r) {
        post.sha = r.sha || post.sha;
        if (r.data) post.data = r.data;
        rita();
        status("ok", "Sparat. Ändringen är incheckad i GitHub" +
                     (r.commit ? " (" + String(r.commit).slice(0, 7) + ")" : "") + ".");
        return r;
      })
      .catch(hanteraSparaFel);
  }

  function sparaLekarAktuell(meddelande) {
    status("info", "Sparar till GitHub…", true);
    state.lekar.uppdaterad = new Date().toISOString();
    state.lekar.uppdateradAv = (window.API.anvandare() || {}).namn || "";
    return window.API.sparaLekar(state.lekar, meddelande, state.lekarSha)
      .then(function (r) {
        state.lekarSha = r.sha || state.lekarSha;
        if (r.data) state.lekar = r.data;
        rita();
        status("ok", "Sparat. Ändringen är incheckad i GitHub" +
                     (r.commit ? " (" + String(r.commit).slice(0, 7) + ")" : "") + ".");
        return r;
      })
      .catch(hanteraSparaFel);
  }

  function spara(meddelande) {
    if (!kanRedigera()) {
      status("fel", "Du måste vara inloggad som ledare för att spara.");
      return Promise.reject(new Error("ej inloggad"));
    }
    return visarLekar() ? sparaLekarAktuell(meddelande) : sparaPassAktuell(meddelande);
  }

  /* ---------- Sätt det valda passet som aktuellt ---------- */
  function sattAktivt() {
    if (!kanRedigera()) { status("fel", "Du måste vara inloggad som ledare."); return; }
    var p = valtPass();
    if (!p || p.id === state.index.aktivt) return;
    state.index.aktivt = p.id;
    status("info", "Sparar till GitHub…", true);
    state.index.uppdaterad = new Date().toISOString();
    state.index.uppdateradAv = (window.API.anvandare() || {}).namn || "";
    window.API.sparaIndex(state.index, "Satte " + p.namn + " som aktuellt träningspass", state.indexSha)
      .then(function (r) {
        state.indexSha = r.sha || state.indexSha;
        if (r.data) state.index = r.data;
        rita();
        status("ok", "Sparat. " + p.namn + " är nu aktuellt pass" +
                     (r.commit ? " (" + String(r.commit).slice(0, 7) + ")" : "") + ".");
      })
      .catch(function (e) { hanteraSparaFel(e).catch(function () {}); });
  }

  /* ---------- Arkivera det valda passet ---------- */
  function arkivera() {
    if (!kanRedigera()) { status("fel", "Du måste vara inloggad som ledare."); return; }
    var p = valtPass() || {};
    if (!confirm("Arkivera \"" + (p.namn || "passet") + "\"" +
                 (p.datum ? " (" + p.datum + ")" : "") + "?\n\n" +
                 "En kopia sparas i arkivet precis som passet ser ut nu. " +
                 "Det aktuella passet ligger kvar och kan redigeras vidare inför nästa gång.")) return;
    status("info", "Arkiverar…", true);
    window.API.arkivera(p.id).then(function (r) {
      status("ok", "Passet är arkiverat som " + r.post.fil + ". Det finns nu under Arkiv.");
      rita();
    }).catch(function (e) {
      status("fel", "Kunde inte arkivera: " + e.message, true);
    });
  }

  /* ---------- Inloggning ---------- */
  function uppdateraInloggningsvy() {
    var anv = window.API.anvandare();
    var loginKnapp = document.getElementById("btn-login");
    var box = document.getElementById("user-box");
    if (anv) {
      loginKnapp.hidden = true;
      box.hidden = false;
      document.getElementById("user-name").textContent = "Inloggad: " + anv.namn;
    } else {
      loginKnapp.hidden = false;
      box.hidden = true;
    }
  }

  function oppnaDialog(id) {
    var d = document.getElementById(id);
    d.querySelectorAll(".dlg-error").forEach(function (e) { e.hidden = true; });
    d.showModal();
  }

  /* Låser en knapp och byter text medan ett anrop pågår, så det syns att
     klicket registrerats – annars ser ett långsamt anrop ut som ett
     ouppmärksammat klick och man klickar om, i onödan. */
  function knappUnderVantan(knapp, vantetext) {
    var ursprung = knapp.textContent;
    knapp.disabled = true;
    knapp.textContent = vantetext;
    return function aterstall() {
      knapp.disabled = false;
      knapp.textContent = ursprung;
    };
  }

  /* ---------- Historik ---------- Varje pass och lekbanken har sin egen
     historik – dialogen visar historiken för den flik som är öppen just nu,
     och Återställ rör bara den filen. */
  function malForHistorik() {
    if (visarLekar()) return { target: "lekar", namn: "Lekar" };
    var p = valtPass();
    return p ? { target: "pass/" + p.id, namn: p.namn } : null;
  }

  function visaHistorik() {
    var mal = malForHistorik();
    if (!mal) return;
    var lista = document.getElementById("history-list");
    lista.textContent = "Laddar…";
    var rubrik = document.querySelector("#dlg-history h2");
    if (rubrik) rubrik.textContent = "Ändringshistorik – " + mal.namn;
    oppnaDialog("dlg-history");
    window.API.historik(mal.target).then(function (poster) {
      lista.innerHTML = "";
      if (!poster.length) { lista.textContent = "Ingen historik ännu."; return; }
      poster.forEach(function (p, i) {
        var rad = window.Render.el("div", "hist-rad");
        var txt = window.Render.el("div", "hist-text");
        txt.appendChild(window.Render.el("div", null, p.meddelande || "(ingen beskrivning)"));
        var meta = window.Render.el("div", "hist-tid");
        meta.appendChild(window.Render.el("span", "hist-vem", p.vem || "okänd"));
        meta.appendChild(document.createTextNode(" · " + window.Render.tidText(p.tid) +
                                                 " · " + String(p.sha).slice(0, 7)));
        txt.appendChild(meta);
        rad.appendChild(txt);
        if (i > 0) {
          rad.appendChild(window.Edit.knapp("Återställ", "btn-ghost btn-liten", function () {
            if (!confirm("Återställa " + mal.namn + " till den här versionen?\n\n" +
                         "Den nuvarande versionen finns kvar i historiken.")) return;
            window.API.aterstall(mal.target, p.sha).then(function () {
              document.getElementById("dlg-history").close();
              return laddaOm();
            }).then(function () {
              status("ok", "Återställt till version " + String(p.sha).slice(0, 7) + ".");
            }).catch(function (e) { status("fel", "Kunde inte återställa: " + e.message, true); });
          }));
        } else {
          rad.appendChild(window.Render.el("span", "hist-tid", "nuvarande"));
        }
        lista.appendChild(rad);
      });
    }).catch(function (e) {
      lista.textContent = "Kunde inte hämta historik: " + e.message;
    });
  }

  /* ---------- Utskrift: mät hur många A4-sidor underlaget blir ----------
     Sidan renderas om i en dold ram med utskriftsstilen påslagen och
     A4:ans textbredd. Då blir siffran den verkliga, inte en gissning. */
  var A4_BREDD_PX = 703;      // 210 mm - 24 mm marginal, vid 96 dpi
  var A4_HOJD_PX = 1032;      // 297 mm - 24 mm marginal, vid 96 dpi
  var matningPagar = false;

  /* Mäter i en dold ram med utskriftsstilen påslagen: först hur högt
     sidhuvudet + passinfon blir, sedan varje block för sig. Därefter
     simuleras skrivarens sidbrytning – ett block bryts aldrig mitt itu. */
  function matSidor(kompakt) {
    return new Promise(function (klar) {
      var ram = document.createElement("iframe");
      ram.setAttribute("aria-hidden", "true");
      ram.style.cssText = "position:fixed;left:-10000px;top:0;border:0;visibility:hidden;" +
                          "width:" + A4_BREDD_PX + "px;height:" + (A4_HOJD_PX * 3) + "px";
      document.body.appendChild(ram);

      var huvud = document.querySelector(".site-header").cloneNode(true);
      var topp = document.getElementById("pass-head").cloneNode(true);
      var blockNoder = Array.prototype.map.call(
        document.querySelectorAll("#blocks .block"),
        function (n) { return n.cloneNode(true); });
      var avslutning = document.getElementById("pass-avslutning");
      if (avslutning && !avslutning.hidden) blockNoder.push(avslutning.cloneNode(true));
      [huvud, topp].concat(blockNoder).forEach(function (n) {
        n.querySelectorAll(".no-print,.redigera-form").forEach(function (x) { x.remove(); });
      });

      var d = ram.contentDocument;
      d.open();
      d.write('<!doctype html><html lang="sv"><head><meta charset="utf-8">' +
              '<link rel="stylesheet" href="css/style.css">' +
              '<link rel="stylesheet" href="css/print.css" media="all">' +
              '<style>html,body{margin:0;padding:0}</style></head><body></body></html>');
      d.close();

      var slutfor = function () {
        var sidor = 1;
        try {
          d.body.className = kompakt ? "kompakt" : "";

          /* 1. Sidhuvud + passinfo, full bredd */
          var toppBox = d.createElement("div");
          toppBox.appendChild(huvud); toppBox.appendChild(topp);
          d.body.appendChild(toppBox);
          var toppHojd = toppBox.getBoundingClientRect().height;

          /* 2. Blocken, en och en i spaltbredd */
          var matBox = d.createElement("div");
          matBox.className = "blocks";
          d.body.appendChild(matBox);

          var hojder = blockNoder.map(function (n) {
            matBox.appendChild(n);
            var h = n.getBoundingClientRect().height + 7;   // + marginal mellan block
            matBox.removeChild(n);
            return h;
          });

          /* 3. Simulera sidbrytningen */
          var kvar = A4_HOJD_PX - toppHojd;
          hojder.forEach(function (h) {
            if (h > kvar) { sidor += 1; kvar = A4_HOJD_PX; }
            kvar -= h;
          });
        } catch (e) { /* faller tillbaka på 1 */ }
        ram.remove();
        klar(Math.max(1, sidor));
      };

      var lankar = d.querySelectorAll("link[rel=stylesheet]");
      var kvarLankar = lankar.length;
      var timeout = setTimeout(slutfor, 2000);
      if (!kvarLankar) { clearTimeout(timeout); return slutfor(); }
      lankar.forEach(function (l) {
        var av = function () {
          if (--kvarLankar === 0) { clearTimeout(timeout); setTimeout(slutfor, 40); }
        };
        l.addEventListener("load", av);
        l.addEventListener("error", av);
      });
    });
  }

  function visaSidUppskattning() {
    if (matningPagar) return;
    matningPagar = true;
    var max = CFG.maxSidor || 3;
    matSidor(false).then(function (sidor) {
      matningPagar = false;
      var gammal = document.querySelector(".sidvarning");
      if (gammal) gammal.remove();
      var ord = sidor === 1 ? "A4-sida" : "A4-sidor";
      var v = window.Render.el("div", "sidvarning no-print " + (sidor <= max ? "ok" : "varning"));
      v.textContent = sidor <= max
        ? "Utskrift: " + sidor + " " + ord + " (gränsen är " + max + ")."
        : "Utskrift: " + sidor + " " + ord + " – fler än gränsen på " + max + ". " +
          "Korta ned texterna, ta bort någon bild, eller välj kompakt läge när du skriver ut.";
      v.dataset.sidor = String(sidor);
      var main = document.getElementById("main");
      main.insertBefore(v, main.querySelector(".pass-footer"));
    }).catch(function () { matningPagar = false; });
  }

  function skrivUt() {
    var max = CFG.maxSidor || 3;
    var v = document.querySelector(".sidvarning");
    var sidor = v ? Number(v.dataset.sidor || 0) : 0;

    var utskrift = function (kompakt) {
      if (kompakt) {
        document.body.classList.add("kompakt");
        var av = function () {
          document.body.classList.remove("kompakt");
          window.removeEventListener("afterprint", av);
        };
        window.addEventListener("afterprint", av);
      }
      window.print();
    };

    if (!sidor || sidor <= max) return utskrift(false);

    matSidor(true).then(function (kompaktSidor) {
      var svar = confirm(
        "Underlaget blir " + sidor + " sidor, gränsen är " + max + ".\n\n" +
        "OK = skriv ut i kompakt läge (mindre text, utan bilder) – " + kompaktSidor + " sidor.\n" +
        "Avbryt = skriv ut som det är.");
      utskrift(svar);
    });
  }

  /* ---------- Start ---------- */
  function start() {
    window.Edit.init({
      pass: valtPass,
      lekar: lekar,
      arAktivt: function () { var p = valtPass(); return !!p && p.id === effektivtAktivt(); },
      spara: spara, rita: rita, laddaOm: laddaOm, status: status,
      arkivera: arkivera, sattAktivt: sattAktivt
    });

    document.getElementById("btn-print").addEventListener("click", skrivUt);

    /* Inloggning */
    document.getElementById("btn-login").addEventListener("click", function () {
      if (!window.API.harApi()) {
        status("varning", "Ingen ledartjänst är konfigurerad ännu. Sätt apiBase i web/js/config.js " +
                          "när servern på hallenskog är igång.", true);
        return;
      }
      oppnaDialog("dlg-login");
    });

    document.getElementById("form-login").addEventListener("submit", function (e) {
      e.preventDefault();
      var anv = document.getElementById("login-user").value.trim();
      var los = document.getElementById("login-pass").value;
      var fel = document.getElementById("login-error");
      var aterstallKnapp = knappUnderVantan(
        e.target.querySelector("button[type=submit]"), "Loggar in…");
      window.API.loggaIn(anv, los).then(function (d) {
        aterstallKnapp();
        document.getElementById("dlg-login").close();
        document.getElementById("form-login").reset();
        uppdateraInloggningsvy();
        return laddaOm().then(function () {
          if (d.maste_byta_losenord && d.krav_losenordsbyte) {
            status("varning", "Du använder fortfarande startlösenordet. Du måste byta det " +
                              "innan du kan ändra något – klicka \"Byt lösenord\".", true);
            oppnaDialog("dlg-password");
          } else if (d.maste_byta_losenord) {
            status("info", "Välkommen " + d.namn + "! Du kan redigera passet. Kom ihåg att byta " +
                           "bort startlösenordet innan sidan är i skarp drift.");
          } else {
            status("ok", "Välkommen " + d.namn + "! Du kan nu redigera passet.");
          }
        });
      }).catch(function (err) {
        aterstallKnapp();
        fel.textContent = err.status === 401
          ? "Fel användarnamn eller lösenord."
          : "Kunde inte logga in: " + err.message;
        fel.hidden = false;
      });
    });

    document.getElementById("btn-logout").addEventListener("click", function () {
      window.API.loggaUt();
      uppdateraInloggningsvy();
      laddaOm();
      status("info", "Du är utloggad.");
    });

    document.getElementById("btn-history").addEventListener("click", visaHistorik);

    document.getElementById("btn-password").addEventListener("click", function () {
      oppnaDialog("dlg-password");
    });
    document.getElementById("form-password").addEventListener("submit", function (e) {
      e.preventDefault();
      var fel = document.getElementById("pw-error");
      var n1 = document.getElementById("pw-new").value;
      var n2 = document.getElementById("pw-new2").value;
      if (n1 !== n2) { fel.textContent = "De nya lösenorden är inte lika."; fel.hidden = false; return; }
      var aterstallKnapp = knappUnderVantan(
        e.target.querySelector("button[type=submit]"), "Sparar…");
      window.API.bytLosenord(document.getElementById("pw-old").value, n1).then(function () {
        aterstallKnapp();
        document.getElementById("dlg-password").close();
        document.getElementById("form-password").reset();
        status("ok", "Lösenordet är bytt. Nu kan du redigera passet.");
        uppdateraInloggningsvy();
        return laddaOm();
      }).catch(function (err) {
        aterstallKnapp();
        fel.textContent = err.message; fel.hidden = false;
      });
    });

    /* Stäng-knappar i dialoger */
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });

    /* Moment- respektive lekverktyg (samma kort, olika data beroende på flik).
       Lekarna sorteras alltid alfabetiskt, så de har ingen ▲▼-flytt. */
    document.getElementById("blocks").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-action]");
      if (!b) return;
      if (visarLekar()) {
        if (b.dataset.action === "redigera") window.Edit.redigeraLek(b.dataset.blockId);
        return;
      }
      if (b.dataset.action === "redigera") window.Edit.redigeraMoment(b.dataset.blockId);
      if (b.dataset.action === "upp") window.Edit.flyttaMoment(b.dataset.blockId, "upp");
      if (b.dataset.action === "ned") window.Edit.flyttaMoment(b.dataset.blockId, "ned");
    });
    document.getElementById("btn-add-block").addEventListener("click", function () {
      if (visarLekar()) window.Edit.nyLek();
      else window.Edit.nyttMoment();
    });

    document.getElementById("btn-add-lek-moment").addEventListener("click", function () {
      var lista = lekar().slice().sort(function (a, b) {
        return (a.namn || "").localeCompare(b.namn || "", "sv");
      });
      if (!lista.length) {
        status("varning", "Det finns inga lekar i lekbanken ännu. Lägg till en under fliken Lekar.", true);
        return;
      }
      var val = document.getElementById("add-lek-select");
      val.innerHTML = "";
      lista.forEach(function (l) {
        var opt = document.createElement("option");
        opt.value = l.id; opt.textContent = l.namn;
        val.appendChild(opt);
      });
      oppnaDialog("dlg-add-lek");
    });
    document.getElementById("form-add-lek").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = document.getElementById("add-lek-select").value;
      document.getElementById("dlg-add-lek").close();
      if (id) window.Edit.lekSomMoment(id);
    });

    /* Markera aktiv blocklänk vid scroll */
    window.addEventListener("hashchange", function () {
      document.querySelectorAll("#block-nav a").forEach(function (a) {
        a.classList.toggle("aktiv", a.getAttribute("href") === location.hash);
      });
    });

    uppdateraInloggningsvy();
    laddaOm().then(function () {
      /* Djuplänk från t.ex. Arkiv-sidan: index.html?visa=lekar öppnar
         direkt på lekbanksfliken i stället för det aktuella passet. */
      if (new URLSearchParams(location.search).get("visa") === "lekar") {
        vaxlaPass(window.Render.LEKAR_ID);
      }
      if (!window.API.harApi()) return;
      if (!window.API.anvandare()) return;
      status("info", "Inloggad som ledare – klicka Redigera i ett moment för att ändra.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }

  window.App = { status: status, laddaOm: laddaOm };
})();
