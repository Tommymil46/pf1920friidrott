/* ===========================================================
   Rendering av träningspassen. Det finns fem träningspass
   (Löpning, Rörelse, Kast, Höjd, Längd) som visas som flikar.
   Varje pass har: samling, uppvärmning, minst fyra
   friidrottsmoment och en avslutning.
   =========================================================== */
(function () {
  var CFG = window.PASS_CONFIG || {};

  function el(tagg, klass, text) {
    var n = document.createElement(tagg);
    if (klass) n.className = klass;
    if (text != null) n.textContent = text;
    return n;
  }

  function datumText(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    var dag = ["söndag","måndag","tisdag","onsdag","torsdag","fredag","lördag"][d.getDay()];
    var man = ["januari","februari","mars","april","maj","juni","juli",
               "augusti","september","oktober","november","december"][d.getMonth()];
    return dag + " " + d.getDate() + " " + man + " " + d.getFullYear();
  }

  function tidText(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  }

  function hittaPass(data, id) {
    var lista = (data && data.pass) || [];
    return lista.filter(function (p) { return p.id === id; })[0] || lista[0] || null;
  }

  /* ---------- Flikar mellan de fem träningspassen ---------- */
  function ritaPassTabs(data, valtId, vaxlaPass) {
    var nav = document.getElementById("pass-tabs");
    if (!nav) return;
    nav.innerHTML = "";
    (data.pass || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (p) {
        var knapp = el("button");
        knapp.type = "button";
        knapp.className = p.id === valtId ? "aktiv" : "";
        if (p.ikon) knapp.appendChild(el("span", "block-ikon", p.ikon + " "));
        knapp.appendChild(document.createTextNode(p.namn || p.id));
        if (p.id === data.aktivt) knapp.appendChild(el("span", "pass-markering", " ★"));
        knapp.addEventListener("click", function () { vaxlaPass(p.id); });
        nav.appendChild(knapp);
      });
  }

  /* ---------- Sidhuvud / fakta för det valda passet ---------- */
  function ritaFakta(pass, arAktivt) {
    var v = document.getElementById("pass-facts");
    v.innerHTML = "";
    var rubrikRad = el("div", "pass-titel-rad");
    rubrikRad.appendChild(el("h2", "pass-titel", (pass.namn || "Träningspass") + " – träningspass"));
    if (arAktivt) rubrikRad.appendChild(el("span", "pass-aktuell-etikett", "Aktuellt just nu"));
    v.appendChild(rubrikRad);

    var rad = el("div", "fakta-rad");
    function post(etikett, varde) {
      if (!varde) return;
      var s = el("span");
      s.appendChild(el("strong", null, etikett + ": "));
      s.appendChild(document.createTextNode(varde));
      rad.appendChild(s);
    }
    post("Datum", datumText(pass.datum));
    post("Tid", pass.tid);
    post("Plats", pass.plats);
    post("Grupp", pass.grupp);
    post("Ledare", (pass.ansvarigaLedare || []).join(", "));
    v.appendChild(rad);

    document.getElementById("group-name").textContent = pass.grupp || CFG.klubb;
    document.title = (pass.namn || "Träningspass") + " – " + (pass.grupp || "Friidrott");
  }

  function ritaSamlingUppvarmning(pass) {
    var v = document.getElementById("pass-common");
    v.innerHTML = "";
    var poster = [
      ["Samling", pass.samling],
      ["Uppvärmning", pass.uppvarmning]
    ].filter(function (p) { return p[1] && String(p[1]).trim(); });

    v.hidden = poster.length === 0;
    poster.forEach(function (p) {
      var d = el("div", "gem-post");
      d.appendChild(el("h3", null, p[0]));
      var kropp = el("div");
      kropp.innerHTML = window.MD.html(p[1]);
      d.appendChild(kropp);
      v.appendChild(d);
    });
  }

  function ritaAvslutning(pass) {
    var v = document.getElementById("pass-avslutning");
    if (!v) return;
    v.innerHTML = "";
    var text = pass.avslutning;
    v.hidden = !(text && String(text).trim());
    if (v.hidden) return;
    v.appendChild(el("h3", null, "Avslutning"));
    var kropp = el("div");
    kropp.innerHTML = window.MD.html(text);
    v.appendChild(kropp);
  }

  /* ---------- Friidrottsmoment ---------- */
  function ritaBild(b) {
    var fig = el("figure", "bild-kort");
    var img = el("img");
    img.src = window.API.filUrl(b.url);
    img.alt = b.bildtext || "";
    /* Ingen lazy-laddning: bilder som inte hunnit laddas kommer inte med
       i utskriften och räknas inte in i sidberäkningen. */
    img.loading = "eager";
    img.decoding = "sync";
    var reserv = window.API.filUrlReserv(b.url);
    if (reserv) {
      img.addEventListener("error", function omErr() {
        img.removeEventListener("error", omErr);
        img.src = reserv;
      });
    }
    /* Klickbar: öppnar bilden i full storlek. */
    var lank = el("a");
    lank.href = window.API.filUrl(b.url);
    lank.target = "_blank"; lank.rel = "noopener noreferrer";
    lank.appendChild(img);
    fig.appendChild(lank);
    if (b.bildtext) fig.appendChild(el("figcaption", null, b.bildtext));
    return fig;
  }

  function ritaBlock(moment, kanRedigera) {
    var kort = el("article", "block");
    kort.id = "block-" + moment.id;
    kort.dataset.blockId = moment.id;

    var huvud = el("div", "block-head");
    if (moment.ikon) huvud.appendChild(el("span", "block-ikon", moment.ikon));
    huvud.appendChild(el("h2", null, moment.namn || "Moment"));
    if (moment.ansvarig) huvud.appendChild(el("span", "block-ansvarig", "Ledare: " + moment.ansvarig));

    if (kanRedigera) {
      var verktyg = el("div", "block-verktyg no-print");
      var red = el("button", "btn btn-liten", "Redigera");
      red.type = "button"; red.dataset.action = "redigera"; red.dataset.blockId = moment.id;
      var upp = el("button", "btn btn-liten", "▲");
      upp.type = "button"; upp.title = "Flytta upp";
      upp.dataset.action = "upp"; upp.dataset.blockId = moment.id;
      var ned = el("button", "btn btn-liten", "▼");
      ned.type = "button"; ned.title = "Flytta ned";
      ned.dataset.action = "ned"; ned.dataset.blockId = moment.id;
      verktyg.appendChild(upp); verktyg.appendChild(ned); verktyg.appendChild(red);
      huvud.appendChild(verktyg);
    }
    kort.appendChild(huvud);

    var kropp = el("div", "block-body");
    if (moment.syfte) kropp.appendChild(el("p", "block-syfte", moment.syfte));

    var text = el("div", "block-text");
    text.innerHTML = window.MD.html(moment.text);
    kropp.appendChild(text);

    if ((moment.bilder || []).length) {
      var rad = el("div", "bild-rad");
      moment.bilder.forEach(function (b) { rad.appendChild(ritaBild(b)); });
      kropp.appendChild(rad);
    }

    if ((moment.filer || []).length) {
      var lista = el("ul", "fil-lista");
      moment.filer.forEach(function (f) {
        var li = el("li");
        var a = el("a", null, (f.typ === "pdf" ? "📄 " : "📎 ") + (f.namn || "Bilaga"));
        a.href = window.API.filUrl(f.url);
        a.target = "_blank"; a.rel = "noopener noreferrer";
        li.appendChild(a); lista.appendChild(li);
      });
      kropp.appendChild(lista);
    }

    kort.appendChild(kropp);
    return kort;
  }

  function ritaBlockNav(pass) {
    var nav = document.getElementById("block-nav");
    nav.innerHTML = "";
    (pass.moment || []).forEach(function (m) {
      var a = el("a", null, m.namn);
      a.href = "#block-" + m.id;
      nav.appendChild(a);
    });
  }

  function ritaFotPass(fot) {
    var rader = [];
    if (fot.uppdaterad) {
      rader.push("Senast ändrad " + tidText(fot.uppdaterad) +
                 (fot.uppdateradAv ? " av " + fot.uppdateradAv : ""));
    }
    rader.push("Hagunda IF · " + (fot.grupp || "Friidrott"));
    document.getElementById("meta-line").textContent = rader.join(" · ");
  }

  /* ---------- Innehållet för ett enskilt pass (delas av start- och
     arkivsidan) ---------- */
  function ritaPassInnehall(pass, kanRedigera, arAktivt, fot) {
    ritaFakta(pass, arAktivt);
    ritaSamlingUppvarmning(pass);
    ritaBlockNav(pass);

    var v = document.getElementById("blocks");
    v.innerHTML = "";
    (pass.moment || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (m) { v.appendChild(ritaBlock(m, kanRedigera)); });

    ritaAvslutning(pass);
    ritaFotPass(fot || { uppdaterad: pass.uppdaterad, uppdateradAv: pass.uppdateradAv, grupp: pass.grupp });
    document.getElementById("add-block-row").hidden = !kanRedigera;
  }

  /* Förstasidan: alla fem passen som flikar, det valda passet visas. */
  function rita(data, valtId, kanRedigera, vaxlaPass) {
    ritaPassTabs(data, valtId, vaxlaPass);
    var pass = hittaPass(data, valtId);
    if (!pass) return null;
    ritaPassInnehall(pass, kanRedigera, pass.id === data.aktivt,
      { uppdaterad: data.uppdaterad, uppdateradAv: data.uppdateradAv, grupp: pass.grupp });
    return pass;
  }

  /* Arkivsidan: ett enskilt, arkiverat pass utan flikar. */
  function ritaEnstaka(pass, kanRedigera) {
    var nav = document.getElementById("pass-tabs");
    if (nav) nav.innerHTML = "";
    ritaPassInnehall(pass, kanRedigera, false);
  }

  /* Leksidan: lekbanken, korten återanvänder samma utseende som momenten. */
  function ritaLekar(lekar, kanRedigera) {
    var v = document.getElementById("blocks");
    v.innerHTML = "";
    (lekar || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (l) { v.appendChild(ritaBlock(l, kanRedigera)); });
    var rad = document.getElementById("add-block-row");
    if (rad) rad.hidden = !kanRedigera;
  }

  window.Render = {
    rita: rita, ritaEnstaka: ritaEnstaka, ritaLekar: ritaLekar, hittaPass: hittaPass,
    el: el, datumText: datumText, tidText: tidText
  };
})();
