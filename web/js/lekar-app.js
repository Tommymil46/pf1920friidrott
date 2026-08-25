/* ===========================================================
   Lekbanken: en fristående samling lekar (namn, hur den går till,
   bilder/PDF) som ledarna kan använda inom vilket träningspass som
   helst. Lagras i samma content/pass.json-fil som passen, under
   fältet "lekar", men är inte kopplad till något enskilt pass.
   =========================================================== */
(function () {
  var state = { data: null, sha: null, kalla: null };

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

  function lekar() {
    if (!state.data.lekar) state.data.lekar = [];
    return state.data.lekar;
  }

  function rita() {
    window.Render.ritaLekar(lekar(), kanRedigera());
    document.body.classList.toggle("redigerar", kanRedigera());
  }

  function laddaOm() {
    return window.API.hamtaPass().then(function (d) {
      state.data = d.pass; state.sha = d.sha || null; state.kalla = d.kalla;
      rita();
      return d;
    }).catch(function (e) {
      status("fel", "Kunde inte hämta lekbanken: " + e.message, true);
    });
  }

  /* ---------- Spara ---------- */
  function spara(meddelande) {
    if (!kanRedigera()) {
      status("fel", "Du måste vara inloggad som ledare för att spara.");
      return Promise.reject(new Error("ej inloggad"));
    }
    status("info", "Sparar till GitHub…", true);
    state.data.uppdaterad = new Date().toISOString();
    state.data.uppdateradAv = (window.API.anvandare() || {}).namn || "";
    return window.API.sparaPass(state.data, meddelande, state.sha)
      .then(function (r) {
        state.sha = r.sha || state.sha;
        if (r.pass) state.data = r.pass;
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
          throw e;
        }
        if (e.status === 409) {
          status("varning", "Någon annan ledare hann spara före dig. Sidan laddas om – " +
                            "gör om din ändring. Inget har gått förlorat.", true);
          return laddaOm().then(function () { throw e; });
        }
        status("fel", "Kunde inte spara: " + e.message, true);
        throw e;
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
    window.API.historik().then(function (poster) {
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
            if (!confirm("Återställa till den här versionen?\n\n" +
                         "Den nuvarande versionen finns kvar i historiken.")) return;
            window.API.aterstall(p.sha).then(function () {
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

  /* ---------- Start ---------- */
  function start() {
    window.Edit.init({
      lekar: lekar,
      spara: spara, rita: rita, laddaOm: laddaOm, status: status
    });

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
      window.API.loggaIn(anv, los).then(function (d) {
        document.getElementById("dlg-login").close();
        document.getElementById("form-login").reset();
        uppdateraInloggningsvy();
        return laddaOm().then(function () {
          if (d.maste_byta_losenord && d.krav_losenordsbyte) {
            status("varning", "Du använder fortfarande startlösenordet. Du måste byta det " +
                              "innan du kan ändra något – klicka \"Byt lösenord\".", true);
            oppnaDialog("dlg-password");
          } else if (d.maste_byta_losenord) {
            status("info", "Välkommen " + d.namn + "! Du kan redigera lekbanken. Kom ihåg att byta " +
                           "bort startlösenordet innan sidan är i skarp drift.");
          } else {
            status("ok", "Välkommen " + d.namn + "! Du kan nu redigera lekbanken.");
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
        status("ok", "Lösenordet är bytt. Nu kan du redigera lekbanken.");
        uppdateraInloggningsvy();
        return laddaOm();
      }).catch(function (err) {
        fel.textContent = err.message; fel.hidden = false;
      });
    });

    /* Stäng-knappar i dialoger */
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });

    /* Lekverktyg */
    document.getElementById("blocks").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-action]");
      if (!b) return;
      if (b.dataset.action === "redigera") window.Edit.redigeraLek(b.dataset.blockId);
      if (b.dataset.action === "upp") window.Edit.flyttaLek(b.dataset.blockId, "upp");
      if (b.dataset.action === "ned") window.Edit.flyttaLek(b.dataset.blockId, "ned");
    });
    document.getElementById("btn-add-block").addEventListener("click", window.Edit.nyLek);

    uppdateraInloggningsvy();
    laddaOm().then(function () {
      if (!window.API.harApi()) return;
      if (!window.API.anvandare()) return;
      status("info", "Inloggad som ledare – klicka Redigera i en lek för att ändra.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
