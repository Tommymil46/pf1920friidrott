/* ===========================================================
   Mycket liten markdown -> HTML. All text escapas först,
   så ledare kan aldrig råka (eller avsiktligt) injicera HTML.
   Stöd: **fet**, *kursiv*, - punktlista, 1. numrerad lista,
         [text](länk), tomrad = nytt stycke.
   =========================================================== */
(function () {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
               '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function md(text) {
    var rader = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var ut = [], lista = null, stycke = [];

    function stangStycke() {
      if (stycke.length) { ut.push("<p>" + stycke.join("<br>") + "</p>"); stycke = []; }
    }
    function stangLista() {
      if (lista) { ut.push("</" + lista + ">"); lista = null; }
    }

    rader.forEach(function (rad) {
      var t = rad.trim();
      if (!t) { stangStycke(); stangLista(); return; }

      var punkt = t.match(/^[-*•]\s+(.*)$/);
      var siffra = t.match(/^\d+[.)]\s+(.*)$/);

      if (punkt || siffra) {
        stangStycke();
        var typ = punkt ? "ul" : "ol";
        if (lista !== typ) { stangLista(); ut.push("<" + typ + ">"); lista = typ; }
        ut.push("<li>" + inline(punkt ? punkt[1] : siffra[1]) + "</li>");
        return;
      }
      stangLista();
      stycke.push(inline(t));
    });

    stangStycke(); stangLista();
    return ut.join("");
  }

  window.MD = { html: md, esc: esc };
})();
