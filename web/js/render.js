/* ===========================================================
   Rendering av träningspasset.
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

  /* ---------- Sidhuvud / fakta ---------- */
  function ritaFakta(pass) {
    var v = document.getElementById("pass-facts");
    v.innerHTML = "";
    v.appendChild(el("h2", "pass-titel", pass.titel || "Aktuellt träningspass"));

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
    document.title = (pass.titel || "Aktuellt träningspass") + " – " + (pass.grupp || "Friidrott");
  }

  function ritaGemensamt(pass) {
    var v = document.getElementById("pass-common");
    v.innerHTML = "";
    var g = pass.gemensamt || {};
    var poster = [
      ["Uppvärmning", g.uppvarmning],
      ["Upplägg", g.info],
      ["Avslutning", g.avslutning]
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

  /* ---------- Block ---------- */
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

  function ritaBlock(block, kanRedigera) {
    var kort = el("article", "block");
    kort.id = "block-" + block.id;
    kort.dataset.blockId = block.id;

    var huvud = el("div", "block-head");
    if (block.ikon) huvud.appendChild(el("span", "block-ikon", block.ikon));
    huvud.appendChild(el("h2", null, block.namn || "Block"));
    if (block.ansvarig) huvud.appendChild(el("span", "block-ansvarig", "Ledare: " + block.ansvarig));

    if (kanRedigera) {
      var verktyg = el("div", "block-verktyg no-print");
      var red = el("button", "btn btn-liten", "Redigera");
      red.type = "button"; red.dataset.action = "redigera"; red.dataset.blockId = block.id;
      var upp = el("button", "btn btn-liten", "▲");
      upp.type = "button"; upp.title = "Flytta upp";
      upp.dataset.action = "upp"; upp.dataset.blockId = block.id;
      var ned = el("button", "btn btn-liten", "▼");
      ned.type = "button"; ned.title = "Flytta ned";
      ned.dataset.action = "ned"; ned.dataset.blockId = block.id;
      verktyg.appendChild(upp); verktyg.appendChild(ned); verktyg.appendChild(red);
      huvud.appendChild(verktyg);
    }
    kort.appendChild(huvud);

    var kropp = el("div", "block-body");
    if (block.syfte) kropp.appendChild(el("p", "block-syfte", block.syfte));

    var text = el("div", "block-text");
    text.innerHTML = window.MD.html(block.text);
    kropp.appendChild(text);

    if ((block.bilder || []).length) {
      var rad = el("div", "bild-rad");
      block.bilder.forEach(function (b) { rad.appendChild(ritaBild(b)); });
      kropp.appendChild(rad);
    }

    if ((block.filer || []).length) {
      var lista = el("ul", "fil-lista");
      block.filer.forEach(function (f) {
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
    (pass.block || []).forEach(function (b) {
      var a = el("a", null, b.namn);
      a.href = "#block-" + b.id;
      nav.appendChild(a);
    });
  }

  function ritaFot(pass) {
    var rader = [];
    if (pass.uppdaterad) {
      rader.push("Senast ändrad " + tidText(pass.uppdaterad) +
                 (pass.uppdateradAv ? " av " + pass.uppdateradAv : ""));
    }
    rader.push("Hagunda IF · " + (pass.grupp || "Friidrott"));
    document.getElementById("meta-line").textContent = rader.join(" · ");
  }

  function rita(pass, kanRedigera) {
    ritaFakta(pass);
    ritaGemensamt(pass);
    ritaBlockNav(pass);

    var v = document.getElementById("blocks");
    v.innerHTML = "";
    (pass.block || [])
      .slice()
      .sort(function (a, b) { return (a.ordning || 0) - (b.ordning || 0); })
      .forEach(function (b) { v.appendChild(ritaBlock(b, kanRedigera)); });

    ritaFot(pass);
    document.getElementById("add-block-row").hidden = !kanRedigera;
  }

  window.Render = { rita: rita, el: el, datumText: datumText, tidText: tidText };
})();
