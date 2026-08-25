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
    return anrop("/losenord", { method: "POST", body: { gammalt: gammalt, nytt: nytt } })
      .then(function (d) {
        /* Bytet avslutar alla tidigare sessioner – ta emot den nya. */
        if (d && d.token) sattToken(d.token);
        return d;
      });
  }

  /* Hämtar en statisk fil. Publiceras sajten via GitHub Actions ligger
     web/ i roten och innehållet under content/. Publiceras den i stället
     direkt från grenen hamnar sidan under /web/ och innehållet en nivå
     upp – då fungerar ../content/. Vi provar båda. */
  var innehallsPrefix = null;

  function hamtaStatisk(vag) {
    var prova = function (prefix) {
      return fetch(prefix + vag + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Hittade inte " + prefix + vag);
          innehallsPrefix = prefix;
          return r.json();
        });
    };
    if (innehallsPrefix !== null) return prova(innehallsPrefix);
    return prova("").catch(function () { return prova("../"); });
  }

  /* Prefixet som visade sig fungera, för bilder och bilagor. */
  function innehallsbas() { return innehallsPrefix || ""; }

  /* --- Innehåll --- */
  /* Läser i första hand live från API:t (färskast), annars den statiska
     filen som GitHub Pages publicerar. */
  function hamtaPass() {
    var statisk = function () {
      return hamtaStatisk(CFG.contentUrl)
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

  /* --- Arkiv --- */
  function arkiv() {
    var statisk = function () { return hamtaStatisk(CFG.arkivUrl); };
    if (!harApi()) return statisk();
    return anrop("/arkiv").catch(statisk);
  }

  function arkivPass(fil) {
    var statisk = function () {
      return hamtaStatisk(CFG.arkivBas + fil).then(function (p) { return { pass: p }; });
    };
    if (!harApi()) return statisk();
    return anrop("/arkiv/" + encodeURIComponent(fil)).catch(statisk);
  }

  function arkivera(passId) { return anrop("/arkivera", { method: "POST", body: { passId: passId } }); }

  /* --- Historik --- */
  function historik() { return anrop("/historik"); }
  function historikVersion(sha) { return anrop("/historik/" + encodeURIComponent(sha)); }
  function aterstall(sha) { return anrop("/aterstall", { method: "POST", body: { sha: sha } }); }
  function status() { return anrop("/status"); }

  /* --- Filadresser ---
     Adresserna kommer ur pass.json. Bara http(s) och vanliga relativa
     sökvägar släpps igenom, så att t.ex. javascript:-länkar aldrig kan
     hamna i ett href eller src. */
  function filUrl(rel) {
    var v = String(rel == null ? "" : rel).trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (v.slice(0, 2) === "//") return "";        // protokollrelativ = annan värd
    if (/^[\w./-]+$/.test(v) && v.indexOf("..") === -1) return innehallsbas() + v;
    return "";
  }
  function filUrlReserv(rel) {                    // om Pages inte hunnit publicera än
    var v = filUrl(rel);
    if (!harApi() || !v || /^https?:\/\//i.test(v)) return "";
    return BAS + "/filer/" + encodeURIComponent(v.split("/").pop());
  }

  window.API = {
    harApi: harApi, anvandare: anvandare, loggaIn: loggaIn, loggaUt: loggaUt,
    bytLosenord: bytLosenord, hamtaPass: hamtaPass, sparaPass: sparaPass,
    laddaUpp: laddaUpp, historik: historik, historikVersion: historikVersion,
    arkiv: arkiv, arkivPass: arkivPass, arkivera: arkivera,
    innehallsbas: innehallsbas,
    aterstall: aterstall, status: status, filUrl: filUrl, filUrlReserv: filUrlReserv
  };
})();
