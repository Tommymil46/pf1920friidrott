/* ===========================================================
   Ledartjänst för "Aktuellt träningspass" – PF 19/20, Hagunda IF.
   Cloudflare Worker: samma API-kontrakt som server/src/index.js
   (Docker/hallenskog-varianten), men utan egen server att drifta.

   Routrarna ligger i roten (inget /api-prefix) – Workern gör
   ingenting annat än API:t, så det behövs ingen uppdelning.
   web/js/config.js apiBase ska pekas mot Workerns fulla URL.

   Bindningar som krävs (se wrangler.toml):
     APP_KV        – KV-namnrymd: ledarkonton, filcache, spärrar
     JWT_SECRET    – hemlighet (secret), signerar sessionerna
     GITHUB_TOKEN  – hemlighet (secret), fine-grained, Contents: RW
     GITHUB_OWNER, GITHUB_REPO         – var passet lagras
     GITHUB_BRANCH                     – standard "main"
     LEDARE                            – kommaseparerad ledarlista
     ALLOWED_ORIGINS                   – kommaseparerad lista, tom = alla
     KRAV_LOSENORDSBYTE                – "1" för att tvinga lösenordsbyte
     TOKEN_TIMMAR, MAX_FIL_MB, LAS_CACHE_MS  – valfria, har standardvärden
   =========================================================== */

import * as gh from "./github.mjs";
import * as anv from "./anvandare.mjs";
import { signJwt, verifieraJwt } from "./kodning.mjs";

const ARKIV_DIR_STANDARD = "content/arkiv";

/* ---------- Hjälpare: svar ---------- */
function jsonSvar(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function felTillSvar(e) {
  const kod = e.status || 500;
  if (kod >= 500) console.error("Fel:", kod, e && e.message);
  return jsonSvar({
    fel: kod >= 500 ? "Något gick fel i tjänsten. Se Workerns loggar." : (e.message || "Fel"),
    ...(e.kod ? { kod: e.kod } : {})
  }, kod);
}

function fel(status, meddelande, kod) {
  const e = new Error(meddelande);
  e.status = status;
  if (kod) e.kod = kod;
  return e;
}

/* ---------- CORS ---------- */
function tillatnaUrsprung(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHuvuden(request, env) {
  const ursprung = request.headers.get("Origin");
  const tillatna = tillatnaUrsprung(env);
  const tillatet = !ursprung || !tillatna.length || tillatna.includes(ursprung);
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (ursprung && tillatet) h["Access-Control-Allow-Origin"] = ursprung;
  return h;
}

/* ---------- Säkerhetsrubriker ---------- */
const SAKERHETSHUVUDEN = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "cross-origin"
};

/* ---------- Spärr mot lösenordsgissning (KV, "best effort" – se
   worker/README.md om KV:s gratisplan och eventuell konsistens) ---------- */
async function farForsoka(env, nyckel) {
  const rad = await env.APP_KV.get("forsok:" + nyckel);
  if (!rad) return true;
  const p = JSON.parse(rad);
  if (Date.now() - p.tid > 15 * 60 * 1000) return true;
  return p.antal < 10;
}
async function raknaFel(env, nyckel) {
  const rad = await env.APP_KV.get("forsok:" + nyckel);
  const p = rad ? JSON.parse(rad) : { antal: 0 };
  p.antal += 1; p.tid = Date.now();
  await env.APP_KV.put("forsok:" + nyckel, JSON.stringify(p), { expirationTtl: 20 * 60 });
}
async function nollstallForsok(env, nyckel) {
  await env.APP_KV.delete("forsok:" + nyckel).catch(() => {});
}

/* ---------- Auth ---------- */
async function kravInloggad(request, env) {
  const h = request.headers.get("Authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) throw fel(401, "Du måste vara inloggad.", "session");
  let p;
  try { p = await verifieraJwt(t, env.JWT_SECRET); }
  catch { throw fel(401, "Sessionen har gått ut. Logga in igen.", "session"); }
  const l = await anv.hitta(env, p.sub);
  if (!l) throw fel(401, "Kontot finns inte längre.", "session");
  /* Byter någon lösenord slutar alla äldre sessioner att gälla direkt. */
  if (p.pv !== (await anv.losenordsversion(l))) {
    throw fel(401, "Lösenordet har ändrats. Logga in igen.", "session");
  }
  return l;
}

function kravLosenordsbyte(env) { return env.KRAV_LOSENORDSBYTE === "1"; }

function kravRiktigtLosenord(env, ledare) {
  if (kravLosenordsbyte(env) && ledare.startlosenord) {
    throw fel(403, "Byt ditt startlösenord innan du ändrar något.", "startlosenord");
  }
}

async function utfardaToken(env, l) {
  return signJwt(
    { sub: l.id, namn: l.namn, pv: await anv.losenordsversion(l) },
    env.JWT_SECRET,
    Number(env.TOKEN_TIMMAR || 12) * 3600
  );
}

/* ---------- Läscache via Cache API (per edge-nod, inte global) ----------
   Skyddar GitHub-tokenens anropsbudget om sidan laddas om i loop. Byggs
   som en syntetisk request så Cache API:t har något att nyckla på. */
function cacheNyckel(namn) { return new Request("https://cache.internal/" + namn); }

async function cachat(ctx, namn, ttlSekunder, hamta) {
  const cache = caches.default;
  const nyckel = cacheNyckel(namn);
  const traff = await cache.match(nyckel);
  if (traff) return traff.json();
  const varde = await hamta();
  const svar = new Response(JSON.stringify(varde), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + ttlSekunder }
  });
  ctx.waitUntil(cache.put(nyckel, svar));
  return varde;
}

async function rensaCache(ctx) {
  const cache = caches.default;
  ctx.waitUntil(Promise.all(
    ["pass", "arkiv"].map((n) => cache.delete(cacheNyckel(n)))
  ));
}

/* ---------- Innehållsgranskning (samma regler som Docker-varianten) ---------- */
const SAKER_URL = /^(https?:\/\/[^\s"'<>]{1,300}|content\/uploads\/[\w.-]{1,120})$/;
const MINST_MOMENT = 4;

function granskaContent(data) {
  const felLista = [];
  const strang = (v, max, namn) => {
    if (v == null) return "";
    if (typeof v !== "string") { felLista.push(namn + " måste vara text"); return ""; }
    if (v.length > max) felLista.push(namn + " är för lång (max " + max + " tecken)");
    return v;
  };

  if (data.pass.length > 12) felLista.push("För många träningspass (max 12)");
  const anvandaId = new Set();

  data.pass.forEach((p, i) => {
    const namn = "Pass " + (i + 1);
    if (!p || typeof p !== "object" || !Array.isArray(p.moment)) {
      felLista.push(namn + " är trasigt"); return;
    }
    strang(p.id, 60, namn + ": id");
    strang(p.namn, 120, namn + ": namnet");
    strang(p.ikon, 16, namn + ": ikonen");
    strang(p.plats, 200, namn + ": platsen");
    strang(p.tid, 100, namn + ": tiden");
    strang(p.grupp, 200, namn + ": gruppen");
    strang(p.samling, 5000, namn + ": samlingen");
    strang(p.uppvarmning, 5000, namn + ": uppvärmningen");
    strang(p.avslutning, 5000, namn + ": avslutningen");
    if (p.datum && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.datum))) {
      felLista.push(namn + ": datumet måste skrivas som ÅÅÅÅ-MM-DD");
    }
    if (anvandaId.has(p.id)) felLista.push(namn + ": id:t måste vara unikt");
    anvandaId.add(p.id);

    if (p.moment.length > 40) felLista.push(namn + ": för många moment (max 40)");
    if (p.moment.length < MINST_MOMENT) {
      felLista.push(namn + ": behöver minst " + MINST_MOMENT + " friidrottsmoment");
    }

    p.moment.forEach((m, j) => {
      const mNamn = namn + ", moment " + (j + 1);
      if (!m || typeof m !== "object") { felLista.push(mNamn + " är trasigt"); return; }
      strang(m.namn, 120, mNamn + ": namnet");
      strang(m.text, 30000, mNamn + ": innehållet");
      strang(m.syfte, 300, mNamn + ": syftet");
      strang(m.ansvarig, 120, mNamn + ": ledaren");
      strang(m.ikon, 16, mNamn + ": ikonen");

      ["bilder", "filer"].forEach((faltNamn) => {
        if (m[faltNamn] == null) return;
        if (!Array.isArray(m[faltNamn])) { felLista.push(mNamn + ": " + faltNamn + " är trasigt"); return; }
        if (m[faltNamn].length > 30) felLista.push(mNamn + ": för många " + faltNamn + " (max 30)");
        m[faltNamn] = m[faltNamn].filter((x) => x && typeof x === "object" && SAKER_URL.test(String(x.url)));
        m[faltNamn].forEach((x) => {
          x.bildtext = strang(x.bildtext, 300, mNamn + ": bildtexten");
          x.namn = strang(x.namn, 200, mNamn + ": filnamnet");
        });
      });
    });
  });

  if (data.aktivt && !anvandaId.has(data.aktivt)) {
    felLista.push("Det aktuella passet (aktivt) pekar på ett pass som inte finns");
  }
  return felLista;
}

/* ---------- Filnamnssanering ---------- */
function rentNamn(namn) {
  return String(namn || "fil")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "fil";
}

function arkivSlug(pass) {
  const datum = (pass.datum && /^\d{4}-\d{2}-\d{2}$/.test(pass.datum))
    ? pass.datum
    : new Date().toISOString().slice(0, 10);
  const namn = rentNamn(String(pass.namn || "traningspass").toLowerCase())
    .replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "traningspass";
  return `${datum}-${namn}`;
}

async function hamtaArkivIndex(env) {
  try {
    return await gh.hamtaJson(env, `${env.ARKIV_PATH || ARKIV_DIR_STANDARD}/index.json`);
  } catch (e) {
    if (e.status === 404) return { data: { schemaVersion: 1, pass: [] }, sha: null };
    throw e;
  }
}

/* ---------- Uppladdning ---------- */
const TILLATNA_TYPER = {
  "image/jpeg": { ext: "jpg", typ: "bild" },
  "image/png": { ext: "png", typ: "bild" },
  "image/gif": { ext: "gif", typ: "bild" },
  "image/webp": { ext: "webp", typ: "bild" },
  "application/pdf": { ext: "pdf", typ: "pdf" },
  "text/plain": { ext: "txt", typ: "text" },
  "text/markdown": { ext: "md", typ: "text" }
};

/* ---------- Routning ---------- */
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const metod = request.method;

  if (metod === "OPTIONS") return new Response(null, { status: 204 });

  /* --- Publikt --- */
  if (path === "/status" && metod === "GET") {
    return jsonSvar({ ok: true, konfigurerad: gh.konfig(env).konfigurerad, tid: new Date().toISOString() });
  }

  if (path === "/login" && metod === "POST") {
    const { anvandarnamn, losenord } = await request.json().catch(() => ({}));
    const ip = request.headers.get("CF-Connecting-IP") || "okänd";
    const nyckel = ip + "|" + String(anvandarnamn || "").toLowerCase();
    if (!(await farForsoka(env, nyckel))) {
      return jsonSvar({ fel: "För många försök. Vänta 15 minuter och försök igen." }, 429);
    }
    const l = await anv.kontrollera(env, anvandarnamn, losenord);
    if (!l) {
      await raknaFel(env, nyckel);
      return jsonSvar({ fel: "Fel användarnamn eller lösenord." }, 401);
    }
    await nollstallForsok(env, nyckel);
    return jsonSvar({
      token: await utfardaToken(env, l),
      namn: l.namn,
      maste_byta_losenord: !!l.startlosenord,
      krav_losenordsbyte: kravLosenordsbyte(env)
    });
  }

  if (path === "/pass" && metod === "GET") {
    return jsonSvar(await cachat(ctx, "pass", Number(env.LAS_CACHE_MS || 20000) / 1000,
      () => gh.hamtaPass(env)));
  }

  if (path === "/arkiv" && metod === "GET") {
    return jsonSvar(await cachat(ctx, "arkiv", Number(env.LAS_CACHE_MS || 20000) / 1000,
      async () => (await hamtaArkivIndex(env)).data));
  }

  let m;
  if ((m = path.match(/^\/arkiv\/([^/]+)$/)) && metod === "GET") {
    const filNamn = decodeURIComponent(m[1]).split("/").pop();
    if (!/^[\w.-]+\.json$/.test(filNamn) || filNamn === "index.json") {
      return jsonSvar({ fel: "Ogiltigt filnamn." }, 400);
    }
    const data = await cachat(ctx, "arkiv:" + filNamn, Number(env.LAS_CACHE_MS || 20000) / 1000,
      async () => (await gh.hamtaJson(env, `${env.ARKIV_PATH || ARKIV_DIR_STANDARD}/${filNamn}`)).data);
    return jsonSvar({ pass: data });
  }

  if ((m = path.match(/^\/filer\/([^/]+)$/)) && metod === "GET") {
    const filNamn = decodeURIComponent(m[1]).split("/").pop();
    const rad = await env.APP_KV.getWithMetadata("fil:" + filNamn, "arrayBuffer");
    if (!rad || !rad.value) return new Response(null, { status: 404 });
    const typ = (rad.metadata && rad.metadata.contentType) || "application/octet-stream";
    return new Response(rad.value, { headers: { "Content-Type": typ } });
  }

  /* --- Kräver inloggning nedanför --- */
  if (path === "/losenord" && metod === "POST") {
    const ledare = await kravInloggad(request, env);
    const { gammalt, nytt } = await request.json().catch(() => ({}));
    const l = await anv.bytLosenord(env, ledare.id, gammalt, nytt);
    return jsonSvar({ ok: true, token: await utfardaToken(env, l) });
  }

  if (path === "/status/detaljer" && metod === "GET") {
    const ledare = await kravInloggad(request, env);           // eslint-disable-line no-unused-vars
    const k = gh.konfig(env);
    return jsonSvar({
      ok: true,
      github: { owner: k.owner, repo: k.repo, branch: k.branch, konfigurerad: k.konfigurerad },
      ledare: await anv.alla(env),
      tid: new Date().toISOString()
    });
  }

  if (path === "/pass" && metod === "PUT") {
    const ledare = await kravInloggad(request, env);
    kravRiktigtLosenord(env, ledare);
    const { pass, meddelande, sha } = await request.json().catch(() => ({}));
    if (!pass || typeof pass !== "object" || !Array.isArray(pass.pass)) {
      return jsonSvar({ fel: "Ogiltigt innehåll." }, 400);
    }
    const brister = granskaContent(pass);
    if (brister.length) return jsonSvar({ fel: brister.slice(0, 5).join(". ") + "." }, 400);

    const nuvarande = await gh.hamtaPass(env);
    if (sha && sha !== nuvarande.sha) {
      return jsonSvar({
        fel: "Någon annan har hunnit spara. Ladda om och gör om ändringen.",
        sha: nuvarande.sha
      }, 409);
    }
    pass.uppdaterad = new Date().toISOString();
    pass.uppdateradAv = ledare.namn;
    const text = (meddelande || "Uppdaterade träningspassen").replace(/\s+/g, " ").slice(0, 120);
    const r = await gh.sparaPass(env, pass, `${text} (${ledare.namn})`, nuvarande.sha,
      anv.commitForfattare(ledare));
    await rensaCache(ctx);
    return jsonSvar({ ok: true, sha: r.sha, commit: r.commit, pass });
  }

  if (path === "/upload" && metod === "POST") {
    const ledare = await kravInloggad(request, env);
    kravRiktigtLosenord(env, ledare);

    const form = await request.formData().catch(() => null);
    const fil = form && form.get("fil");
    if (!fil || typeof fil === "string") return jsonSvar({ fel: "Ingen fil skickades." }, 400);

    const maxBytes = Number(env.MAX_FIL_MB || 10) * 1024 * 1024;
    if (fil.size > maxBytes) return jsonSvar({ fel: "Filen är för stor." }, 413);

    const info = TILLATNA_TYPER[fil.type];
    if (!info) {
      return jsonSvar({ fel: "Filtypen stöds inte. Tillåtet: JPG, PNG, GIF, WEBP, PDF, TXT, MD." }, 415);
    }

    const bas = rentNamn(fil.name.replace(/\.[^.]+$/, ""));
    const stampel = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filnamn = `${stampel}-${bas}-${Date.now().toString(36)}.${info.ext}`;
    const bytes = new Uint8Array(await fil.arrayBuffer());

    const r = await gh.sparaFil(env, filnamn, bytes, `Laddade upp ${filnamn} (${ledare.namn})`,
      anv.commitForfattare(ledare));

    /* Kort KV-cache så filen syns direkt, innan GitHub Pages hunnit
       bygga om. Försvinner av sig själv efter en timme. */
    await env.APP_KV.put("fil:" + filnamn, bytes.buffer, {
      expirationTtl: 3600, metadata: { contentType: fil.type }
    });

    return jsonSvar({ ok: true, url: r.vag, namn: fil.name, typ: info.typ, commit: r.commit });
  }

  if (path === "/historik" && metod === "GET") {
    await kravInloggad(request, env);
    const antal = Number(url.searchParams.get("antal")) || 40;
    return jsonSvar(await gh.historik(env, antal));
  }

  if ((m = path.match(/^\/historik\/([^/]+)$/)) && metod === "GET") {
    await kravInloggad(request, env);
    return jsonSvar({ pass: await gh.passVidCommit(env, decodeURIComponent(m[1])) });
  }

  if (path === "/aterstall" && metod === "POST") {
    const ledare = await kravInloggad(request, env);
    kravRiktigtLosenord(env, ledare);
    const { sha } = await request.json().catch(() => ({}));
    if (!sha) return jsonSvar({ fel: "Ingen version angiven." }, 400);
    const gammalt = await gh.passVidCommit(env, sha);
    const nuvarande = await gh.hamtaPass(env);
    gammalt.uppdaterad = new Date().toISOString();
    gammalt.uppdateradAv = ledare.namn;
    const r = await gh.sparaPass(env, gammalt,
      `Återställde passet till version ${String(sha).slice(0, 7)} (${ledare.namn})`,
      nuvarande.sha, anv.commitForfattare(ledare));
    await rensaCache(ctx);
    return jsonSvar({ ok: true, sha: r.sha, commit: r.commit, pass: gammalt });
  }

  if (path === "/arkivera" && metod === "POST") {
    const ledare = await kravInloggad(request, env);
    kravRiktigtLosenord(env, ledare);

    const { passId } = await request.json().catch(() => ({}));
    const nuvarande = await gh.hamtaPass(env);
    const helaInnehallet = nuvarande.pass;
    const original = (helaInnehallet.pass || []).find((p) => p.id === passId);
    if (!original) return jsonSvar({ fel: "Okänt träningspass." }, 400);
    const pass = JSON.parse(JSON.stringify(original));
    const index = await hamtaArkivIndex(env);

    let bas = arkivSlug(pass), filNamn = `${bas}.json`, n = 2;
    while (index.data.pass.some((p) => p.fil === filNamn)) { filNamn = `${bas}-${n++}.json`; }

    pass.uppdaterad = helaInnehallet.uppdaterad || null;
    pass.uppdateradAv = helaInnehallet.uppdateradAv || "";
    pass.arkiverad = new Date().toISOString();
    pass.arkiveradAv = ledare.namn;
    const arkivPath = env.ARKIV_PATH || ARKIV_DIR_STANDARD;

    await gh.sparaJson(env, `${arkivPath}/${filNamn}`, pass,
      `Arkiverade passet ${pass.namn || filNamn} (${ledare.namn})`, null,
      anv.commitForfattare(ledare));

    const post = {
      fil: filNamn,
      passTyp: pass.id || "",
      titel: pass.namn || "Träningspass",
      datum: pass.datum || "",
      plats: pass.plats || "",
      ledare: pass.ansvarigaLedare || [],
      moment: (pass.moment || []).map((m) => m.namn),
      arkiverad: pass.arkiverad,
      arkiveradAv: pass.arkiveradAv
    };
    index.data.pass.unshift(post);
    index.data.pass.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));

    await gh.sparaJson(env, `${arkivPath}/index.json`, index.data,
      `Uppdaterade arkivlistan (${ledare.namn})`, index.sha, anv.commitForfattare(ledare));

    await rensaCache(ctx);
    return jsonSvar({ ok: true, post });
  }

  return jsonSvar({ fel: "Hittades inte." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (!env.JWT_SECRET) {
      return jsonSvar({ fel: "Workern saknar JWT_SECRET. Kör: wrangler secret put JWT_SECRET" }, 500);
    }
    let svar;
    try {
      svar = await handle(request, env, ctx);
    } catch (e) {
      svar = felTillSvar(e);
    }
    const huvuden = new Headers(svar.headers);
    for (const [k, v] of Object.entries(SAKERHETSHUVUDEN)) huvuden.set(k, v);
    for (const [k, v] of Object.entries(corsHuvuden(request, env))) huvuden.set(k, v);
    return new Response(svar.body, { status: svar.status, headers: huvuden });
  }
};
