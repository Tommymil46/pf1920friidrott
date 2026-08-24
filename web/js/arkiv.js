/* ===========================================================
   Arkivsidan: listar genomförda pass och visar ett valt pass
   med samma layout som förstasidan.
   =========================================================== */
(function () {
  var el, poster = [];

  function status(typ, text) {
    var v = document.getElementById("status");
    if (!text) { v.hidden = true; return; }
    v.className = "status no-print " + typ;
    v.textContent = text;
    v.hidden = false;
  }

  function visaLista() {
    document.getElementById("arkivlista").hidden = false;
    document.getElementById("arkivpass").hidden = true;
    document.getElementById("sidrubrik").textContent = "Arkiv";
    document.getElementById("group-name").textContent = "Genomförda träningspass";
    document.title = "Arkiv – Friidrott PF 19/20";
    document.getElementById("block-nav").innerHTML = "";
    if (location.hash) history.replaceState(null, "", location.pathname);
  }

  function ritaLista(data) {
    poster = (data && data.pass) || [];
    var v = document.getElementById("arkivposter");
    v.innerHTML = "";

    if (!poster.length) {
      v.appendChild(el("p", "arkiv-tomt",
        "Arkivet är tomt än så länge. När ett pass är genomfört kan en ledare " +
        "arkivera det från förstasidan, så hamnar det här."));
      return;
    }

    poster.forEach(function (p) {
      var a = el("a", "arkiv-kort");
      a.href = "#" + p.fil;

      var d = el("div", "arkiv-datum");
      var datum = window.Render.datumText(p.datum);
      d.appendChild(el("strong", null, datum || "Utan datum"));
      a.appendChild(d);

      var t = el("div", "arkiv-text");
      t.appendChild(el("h2", null, p.titel || "Träningspass"));
      var rader = [];
      if (p.plats) rader.push(p.plats);
      if ((p.ledare || []).length) rader.push("Ledare: " + p.ledare.join(", "));
      if (rader.length) t.appendChild(el("p", "arkiv-meta", rader.join(" · ")));
      if ((p.block || []).length) {
        var lista = el("div", "arkiv-block");
        p.block.forEach(function (namn) { lista.appendChild(el("span", "arkiv-etikett", namn)); });
        t.appendChild(lista);
      }
      a.appendChild(t);
      v.appendChild(a);
    });
  }

  function visaPass(fil) {
    status("info", "Hämtar passet…");
    window.API.arkivPass(fil).then(function (d) {
      status(null);
      document.getElementById("arkivlista").hidden = true;
      document.getElementById("arkivpass").hidden = false;
      window.Render.rita(d.pass, false);

      var post = poster.filter(function (p) { return p.fil === fil; })[0] || {};
      document.getElementById("sidrubrik").textContent = "Arkiverat pass";
      document.getElementById("group-name").textContent =
        window.Render.datumText(d.pass.datum || post.datum) || "";

      if (d.pass.arkiverad) {
        var rad = document.getElementById("meta-line");
        rad.textContent = "Arkiverat " + window.Render.tidText(d.pass.arkiverad) +
          (d.pass.arkiveradAv ? " av " + d.pass.arkiveradAv : "") + " · " + rad.textContent;
      }
      window.scrollTo(0, 0);
    }).catch(function (e) {
      status("fel", "Kunde inte hämta passet: " + e.message);
    });
  }

  function ruttning() {
    var fil = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (fil && /\.json$/.test(fil)) visaPass(fil);
    else visaLista();
  }

  function start() {
    el = window.Render.el;
    document.getElementById("btn-print").addEventListener("click", function () { window.print(); });
    document.getElementById("btn-tillbaka").addEventListener("click", function () {
      location.hash = ""; visaLista();
    });
    window.addEventListener("hashchange", ruttning);

    window.API.arkiv().then(function (data) {
      ritaLista(data);
      ruttning();
    }).catch(function (e) {
      document.getElementById("arkivposter").textContent =
        "Kunde inte läsa arkivet: " + e.message;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
