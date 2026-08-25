/* ===========================================================
   Rendering av träningspassen. Det finns fem träningspass
   (Löpning, Rörelse, Kast, Höjd, Längd) som visas som flikar.
   Varje pass har: samling, uppvärmning, minst fyra
   friidrottsmoment och en avslutning.
   =========================================================== */
(function () {
  var CFG = window.PASS_CONFIG || {};
  var LEKAR_ID = "lekar";

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

  /* ---------- Flikar: de fem träningspassen + lekbanken ---------- */
  function ritaPassTabs(data, valtId, vaxlaPass) {
    var nav = document.getElementById("pass-tabs");
    if (!nav) return;
    nav.innerHTML = "";

    function lagg(id, namn, ikon, visaAktivtMarkering) {
      var knapp = el("button");
      knapp.type = "button";
      knapp.className = id === valtId ? "aktiv" : "";
      if (ikon) knapp.appendChild(el("span", "block-ikon", ikon + " "));
      knapp.appendChild(document.createTextNode(namn));
      if (visaAktivtMarkering) knapp.appendChild(el("span", "pass-markering", " ★"));
      knapp.addEventListener("click", function () { vaxlaPass(id); });
      nav.appendChild(knapp);
    }

    (data.pass || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (p) { lagg(p.id, p.namn || p.id, p.ikon, p.id === data.aktivt); });

    lagg(LEKAR_ID, "Lekar", "🎲", false);
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

    var radKnapp = document.getElementById("add-block-row");
    radKnapp.hidden = !kanRedigera;
    document.getElementById("btn-add-block").textContent = "+ Lägg till friidrottsmoment";
  }

  /* Lekbanken: samma nivå som ett träningspass i flikraden, men utan
     fakta/samling/uppvärmning/avslutning – bara namngivna kort med
     bilder/PDF, precis som friidrottsmomenten. */
  function ritaLekarVy(lekar, kanRedigera) {
    var fakta = document.getElementById("pass-facts");
    fakta.innerHTML = "";
    var rubrikRad = el("div", "pass-titel-rad");
    rubrikRad.appendChild(el("h2", "pass-titel", "Lekar"));
    fakta.appendChild(rubrikRad);
    fakta.appendChild(el("p", "hjalp",
      "En fristående lekbank – inte ett eget träningspass – att använda som inslag i vilket pass som helst."));

    var common = document.getElementById("pass-common");
    common.innerHTML = "";
    common.hidden = true;

    var nav = document.getElementById("block-nav");
    nav.innerHTML = "";
    (lekar || []).forEach(function (l) {
      var a = el("a", null, l.namn);
      a.href = "#block-" + l.id;
      nav.appendChild(a);
    });

    var v = document.getElementById("blocks");
    v.innerHTML = "";
    (lekar || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (l) { v.appendChild(ritaBlock(l, kanRedigera)); });

    var avslutning = document.getElementById("pass-avslutning");
    if (avslutning) { avslutning.hidden = true; avslutning.innerHTML = ""; }

    document.getElementById("group-name").textContent = "Lekbank";
    document.title = "Lekar – Träningspass";
    document.getElementById("meta-line").textContent = "Hagunda IF · Friidrott";

    var radKnapp = document.getElementById("add-block-row");
    radKnapp.hidden = !kanRedigera;
    document.getElementById("btn-add-block").textContent = "+ Lägg till lek";
  }

  /* Förstasidan: fem träningspass + lekbanken som flikar. */
  function rita(data, valtId, kanRedigera, vaxlaPass) {
    ritaPassTabs(data, valtId, vaxlaPass);
    if (valtId === LEKAR_ID) {
      ritaLekarVy(data.lekar || [], kanRedigera);
      return null;
    }
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

  window.Render = {
    rita: rita, ritaEnstaka: ritaEnstaka, hittaPass: hittaPass, LEKAR_ID: LEKAR_ID,
    el: el, datumText: datumText, tidText: tidText
  };
})();
