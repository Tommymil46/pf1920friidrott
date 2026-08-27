/* ===========================================================
   Terminsschemat: en fristående, publik tabell över vilket pass
   och vilka ledare som gäller varje vecka under terminen. Lagras
   i content/schema.json, en egen fil med egen historik – precis
   som passen och lekbanken.
   =========================================================== */
(function () {
  var el = null; // sätts i start() (Render.el)
  var state = { schema: null, schemaSha: null, index: null, redigerarRad: null };

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

  function kanRedigera() { return !!(window.API.harApi() && window.API.anvandare()); }

  function knapp(text, klass, fn) {
    var b = el("button", "btn " + klass, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /* ---------- Hjälpare: hitta ett pass i indexet ---------- */
  function passInfo(id) {
    if (!id || !state.index) return null;
    var lista = state.index.pass || [];
    if (lista.indexOf(id) === -1) return null;
    return id;
  }

  function passNamnOchIkon(id) {
    /* Namn/ikon finns egentligen i respektive pass-fil, men för att slippa
       hämta alla fem bara för en etikett använder vi id:t som namn – det
       räcker gott i en schemarad, och länken tar en till rätt flik. */
    var namn = { lopning: "Löpning", rorelse: "Rörelse", kast: "Kast", hojd: "Höjd", langd: "Längd" };
    return namn[id] || id;
  }

  /* ---------- Rendering ---------- */
  function rita() {
    var tbody = document.getElementById("schema-rader");
    tbody.innerHTML = "";
    var redigera = kanRedigera();

    document.getElementById("add-tillfalle-row").hidden = !redigera;

    var lista = (state.schema && state.schema.tillfallen) || [];
    lista.forEach(function (t, i) {
      tbody.appendChild(ritaRad(t, i, redigera));
    });

    document.getElementById("group-name").textContent =
      (state.schema && state.schema.termin) || "Friidrott PF 19/20";

    var rader = [];
    if (state.schema && state.schema.uppdaterad) {
      rader.push("Senast ändrad " + window.Render.tidText(state.schema.uppdaterad) +
                 (state.schema.uppdateradAv ? " av " + state.schema.uppdateradAv : ""));
    }
    rader.push("Hagunda IF · Friidrott");
    document.getElementById("meta-line").textContent = rader.join(" · ");
  }

  function ritaRad(t, i, redigera) {
    var tr = el("tr");
    if (t.installt) tr.className = "schema-installt";

    tr.appendChild(el("td", null, "v." + t.vecka));
    tr.appendChild(el("td", null, window.Render.datumText(t.datum)));
    tr.appendChild(el("td", null, (t.ansvariga || []).join(", ") || "–"));

    var passCell = el("td");
    var passId = passInfo(t.pass);
    if (passId) {
      var lank = el("a", null, passNamnOchIkon(passId));
      lank.href = "index.html?visa=" + encodeURIComponent(passId);
      passCell.appendChild(lank);
    } else {
      passCell.textContent = "–";
    }
    tr.appendChild(passCell);

    var noteringCell = el("td", "schema-notering");
    if (t.notering) noteringCell.textContent = t.notering;
    tr.appendChild(noteringCell);

    var verktygCell = el("td", "no-print");
    if (redigera) {
      verktygCell.appendChild(knapp("Redigera", "btn-liten btn-ghost", function () {
        oppnaRedigering(i);
      }));
    }
    tr.appendChild(verktygCell);

    if (state.redigerarRad === i) {
      var formRad = el("tr", "no-print");
      var formCell = el("td");
      formCell.colSpan = 6;
      formCell.appendChild(byggRedigeraForm(t, i));
      formRad.appendChild(formCell);
      return dokumentFragment(tr, formRad);
    }
    return tr;
  }

  function dokumentFragment() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < arguments.length; i++) frag.appendChild(arguments[i]);
    return frag;
  }

  function oppnaRedigering(i) {
    state.redigerarRad = state.redigerarRad === i ? null : i;
    rita();
  }

  function faltText(etikett, varde) {
    var l = el("label", null, etikett);
    var inp = el("input"); inp.type = "text"; inp.value = varde || "";
    l.appendChild(inp);
    return { label: l, input: inp };
  }

  function byggRedigeraForm(t, i) {
    var form = el("div", "redigera-form");

    var vecka = faltText("Vecka", String(t.vecka || ""));
    vecka.input.type = "number"; vecka.input.min = "1"; vecka.input.max = "53";

    var datumL = el("label", null, "Datum");
    var datumInput = el("input"); datumInput.type = "date"; datumInput.value = t.datum || "";
    datumL.appendChild(datumInput);

    var ansvariga = faltText("Ansvariga", (t.ansvariga || []).join(", "), "Skriv namn separerade med komma");

    var passL = el("label", null, "Pass");
    var passSelect = el("select");
    var tomOpt = el("option", null, "– Inget/ej bestämt –"); tomOpt.value = "";
    passSelect.appendChild(tomOpt);
    ((state.index && state.index.pass) || []).forEach(function (id) {
      var opt = el("option", null, passNamnOchIkon(id));
      opt.value = id;
      if (id === t.pass) opt.selected = true;
      passSelect.appendChild(opt);
    });
    passL.appendChild(passSelect);

    var installtL = el("label", null, "");
    var installtInput = el("input"); installtInput.type = "checkbox"; installtInput.checked = !!t.installt;
    installtL.appendChild(installtInput);
    installtL.appendChild(document.createTextNode(" Inställt (t.ex. lov, ingen träning)"));

    var noteringL = el("label", null, "Notering");
    var noteringInput = el("textarea"); noteringInput.value = t.notering || "";
    noteringL.appendChild(noteringInput);

    var rad1 = el("div", "form-rad");
    rad1.appendChild(vecka.label); rad1.appendChild(datumL); rad1.appendChild(passL);
    var rad2 = el("div", "form-rad");
    rad2.appendChild(ansvariga.label);
    form.appendChild(rad1); form.appendChild(rad2);
    form.appendChild(installtL);
    form.appendChild(noteringL);

    var actions = el("div", "form-actions");
    actions.appendChild(knapp("Spara", "btn-primary", function () {
      t.vecka = Number(vecka.input.value) || t.vecka;
      t.datum = datumInput.value || t.datum;
      t.ansvariga = ansvariga.input.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      t.pass = passSelect.value || null;
      t.installt = installtInput.checked;
      t.notering = noteringInput.value.trim();
      state.redigerarRad = null;
      spara("Uppdaterade schemat, vecka " + t.vecka).catch(function () {});
    }));
    actions.appendChild(knapp("Avbryt", "btn-ghost", function () {
      state.redigerarRad = null;
      rita();
    }));
    actions.appendChild(knapp("Ta bort tillfället", "btn-fara", function () {
      if (!confirm("Ta bort vecka " + t.vecka + " ur schemat?\n\nInnehållet finns kvar i historiken i GitHub och kan återställas.")) return;
      state.schema.tillfallen.splice(i, 1);
      state.redigerarRad = null;
      spara("Tog bort vecka " + t.vecka + " ur schemat").catch(function () {});
    }));
    form.appendChild(actions);
    return form;
  }

  function nyTillfalle() {
    var lista = state.schema.tillfallen;
    var sistaVecka = lista.length ? lista[lista.length - 1].vecka : 0;
    lista.push({
      vecka: sistaVecka + 1,
      datum: new Date().toISOString().slice(0, 10),
      ansvariga: [],
      pass: null,
      installt: false,
      notering: ""
    });
    state.redigerarRad = lista.length - 1;
    rita();
  }

  /* ---------- Ladda / spara ---------- */
  function laddaOm() {
    return Promise.all([window.API.hamtaSchema(), window.API.hamtaIndex()]).then(function (r) {
      state.schema = r[0].data; state.schemaSha = r[0].sha || null;
      state.index = r[1].data;
      state.redigerarRad = null;
      rita();
    }).catch(function (e) {
      status("fel", "Kunde inte hämta schemat: " + e.message, true);
    });
  }

  function spara(meddelande) {
    if (!kanRedigera()) {
      status("fel", "Du måste vara inloggad som ledare för att spara.");
      return Promise.reject(new Error("ej inloggad"));
    }
    status("info", "Sparar till GitHub…", true);
    state.schema.uppdaterad = new Date().toISOString();
    state.schema.uppdateradAv = (window.API.anvandare() || {}).namn || "";
    return window.API.sparaSchema(state.schema, meddelande, state.schemaSha)
      .then(function (r) {
        state.schemaSha = r.sha || state.schemaSha;
        if (r.data) state.schema = r.data;
        rita();
        status("ok", "Sparat. Ändringen är incheckad i GitHub" +
                     (r.commit ? " (" + String(r.commit).slice(0, 7) + ")" : "") + ".");
        return r;
      })
      .catch(function (e) {
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

  /* ---------- Historik ---------- */
  function visaHistorik() {
    var lista = document.getElementById("history-list");
    lista.textContent = "Laddar…";
    oppnaDialog("dlg-history");
    window.API.historik("schema").then(function (poster) {
      lista.innerHTML = "";
      if (!poster.length) { lista.textContent = "Ingen historik ännu."; return; }
      poster.forEach(function (p, i) {
        var rad = el("div", "hist-rad");
        var txt = el("div", "hist-text");
        txt.appendChild(el("div", null, p.meddelande || "(ingen beskrivning)"));
        var meta = el("div", "hist-tid");
        meta.appendChild(el("span", "hist-vem", p.vem || "okänd"));
        meta.appendChild(document.createTextNode(" · " + window.Render.tidText(p.tid) +
                                                 " · " + String(p.sha).slice(0, 7)));
        txt.appendChild(meta);
        rad.appendChild(txt);
        if (i > 0) {
          rad.appendChild(knapp("Återställ", "btn-ghost btn-liten", function () {
            if (!confirm("Återställa schemat till den här versionen?\n\n" +
                         "Den nuvarande versionen finns kvar i historiken.")) return;
            window.API.aterstall("schema", p.sha).then(function () {
              document.getElementById("dlg-history").close();
              return laddaOm();
            }).then(function () {
              status("ok", "Återställt till version " + String(p.sha).slice(0, 7) + ".");
            }).catch(function (e) { status("fel", "Kunde inte återställa: " + e.message, true); });
          }));
        } else {
          rad.appendChild(el("span", "hist-tid", "nuvarande"));
        }
        lista.appendChild(rad);
      });
    }).catch(function (e) {
      lista.textContent = "Kunde inte hämta historik: " + e.message;
    });
  }

  /* ---------- Start ---------- */
  function start() {
    el = window.Render.el;

    document.getElementById("btn-login").addEventListener("click", function () {
      if (!window.API.harApi()) {
        status("varning", "Ingen ledartjänst är konfigurerad ännu.", true);
        return;
      }
      oppnaDialog("dlg-login");
    });

    document.getElementById("form-login").addEventListener("submit", function (e) {
      e.preventDefault();
      var anv = document.getElementById("login-user").value.trim();
      var los = document.getElementById("login-pass").value;
      var fel = document.getElementById("login-error");
      window.API.loggaIn(anv, los).then(function (d) {
        document.getElementById("dlg-login").close();
        document.getElementById("form-login").reset();
        uppdateraInloggningsvy();
        return laddaOm().then(function () {
          if (d.maste_byta_losenord && d.krav_losenordsbyte) {
            status("varning", "Du använder fortfarande startlösenordet. Du måste byta det " +
                              "innan du kan ändra något – klicka \"Byt lösenord\".", true);
            oppnaDialog("dlg-password");
          } else {
            status("ok", "Välkommen " + d.namn + "!");
          }
        });
      }).catch(function (err) {
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
      window.API.bytLosenord(document.getElementById("pw-old").value, n1).then(function () {
        document.getElementById("dlg-password").close();
        document.getElementById("form-password").reset();
        status("ok", "Lösenordet är bytt.");
        uppdateraInloggningsvy();
        return laddaOm();
      }).catch(function (err) {
        fel.textContent = err.message; fel.hidden = false;
      });
    });

    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });

    document.getElementById("btn-add-tillfalle").addEventListener("click", nyTillfalle);

    uppdateraInloggningsvy();
    laddaOm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
