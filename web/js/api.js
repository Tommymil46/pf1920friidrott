/* ===========================================================
   API-klient mot ledartjänsten (Docker på hallenskog).
   Sidan fungerar utan API:t – då är den bara läsbar.
   =========================================================== */
(function () {
  var CFG = window.PASS_CONFIG || {};
  var BAS = (CFG.apiBase || "").replace(/\/+$/, "");
  var NYCKEL = "pf1920.token";

  function token() { try { return localStorage.getItem(NYCKEL) || ""; } catch (e) { return ""; } }
  function sattToken(t) {
    try { t ? localStorage.setItem(NYCKEL, t) : localStorage.removeItem(NYCKEL); } catch (e) {}
  }

  function harApi() { return !!BAS; }

  function anrop(vag, opts) {
    opts = opts || {};
    var h = opts.headers || {};
    if (!(opts.body instanceof FormData)) h["Content-Type"] = "application/json";
    if (token()) h["Authorization"] = "Bearer " + token();
    return fetch(BAS + vag, {
      method: opts.method || "GET",
      headers: h,
      body: opts.body instanceof FormData ? opts.body
           : (opts.body ? JSON.stringify(opts.body) : undefined)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { fel: txt }; }
        if (!r.ok) {
          /* Logga bara ut vid trasig session – inte när någon skrivit
             fel nuvarande lösenord i lösenordsdialogen. */
          if (r.status === 401 && data.kod === "session") { sattToken(""); }
          var e = new Error(data.fel || ("Fel " + r.status));
          e.status = r.status;
          throw e;
        }
        return data;
      });
    });
  }

  /* --- Användare --- */
  function anvandare() {
    var t = token(); if (!t) return null;
    try {
      var p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (p.exp && p.exp * 1000 < Date.now()) { sattToken(""); return null; }
      return { namn: p.namn || p.sub, id: p.sub };
    } catch (e) { sattToken(""); return null; }
  }

  function loggaIn(anv, los) {
    return anrop("/login", { method: "POST", body: { anvandarnamn: anv, losenord: los } })
      .then(function (d) { sattToken(d.token); return d; });
  }

  function loggaUt() { sattToken(""); }

  function bytLosenord(gammalt, nytt) {
    return anrop("/losenord", { method: "POST", body: { gammalt: gammalt, nytt: nytt } });
  }

  /* --- Innehåll --- */
  /* Läser i första hand live från API:t (färskast), annars den statiska
     filen som GitHub Pages publicerar. */
  function hamtaPass() {
    var statisk = function () {
      return fetch(CFG.contentUrl + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Kunde inte läsa " + CFG.contentUrl);
          return r.json();
        })
        .then(function (p) { return { pass: p, kalla: "github" }; });
    };
    if (!harApi()) return statisk();
    return anrop("/pass")
      .then(function (d) { return { pass: d.pass, sha: d.sha, kalla: "api" }; })
      .catch(function () { return statisk(); });
  }

  function sparaPass(pass, meddelande, sha) {
    return anrop("/pass", { method: "PUT", body: { pass: pass, meddelande: meddelande, sha: sha } });
  }

  function laddaUpp(fil, blockId) {
    var fd = new FormData();
    fd.append("fil", fil);
    if (blockId) fd.append("block", blockId);
    return anrop("/upload", { method: "POST", body: fd });
  }

  /* --- Historik --- */
  function historik() { return anrop("/historik"); }
  function historikVersion(sha) { return anrop("/historik/" + encodeURIComponent(sha)); }
  function aterstall(sha) { return anrop("/aterstall", { method: "POST", body: { sha: sha } }); }
  function status() { return anrop("/status"); }

  /* --- Filadresser --- */
  function filUrl(rel) {
    if (/^https?:\/\//.test(rel)) return rel;
    return rel;                                   // relativ mot GitHub Pages
  }
  function filUrlReserv(rel) {                    // om Pages inte hunnit publicera än
    if (!harApi() || /^https?:\/\//.test(rel)) return "";
    return BAS + "/filer/" + rel.split("/").pop();
  }

  window.API = {
    harApi: harApi, anvandare: anvandare, loggaIn: loggaIn, loggaUt: loggaUt,
    bytLosenord: bytLosenord, hamtaPass: hamtaPass, sparaPass: sparaPass,
    laddaUpp: laddaUpp, historik: historik, historikVersion: historikVersion,
    aterstall: aterstall, status: status, filUrl: filUrl, filUrlReserv: filUrlReserv
  };
})();
