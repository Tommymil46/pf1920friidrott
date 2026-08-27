/* ===========================================================
   Ledartjänst för "Aktuellt träningspass" – PF 19/20, Hagunda IF.
   Körs i Docker på hallenskog. Sköter inloggning och skriver
   alla ändringar som commits i GitHub-repot.
   =========================================================== */
"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const gh = require("./github");
const anv = require("./anvandare");

const PORT = Number(process.env.PORT || 8080);
const HEMLIGHET = process.env.JWT_SECRET || "";
const GILTIGHET = process.env.TOKEN_TIMMAR || "12";
const DATA_DIR = process.env.DATA_DIR || "/data";
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, "..", "web");
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, "..", "content");
const CACHE_DIR = path.join(DATA_DIR, "uploads");
const ARKIV_DIR = process.env.ARKIV_PATH || "content/arkiv";

/* Under uppbyggnaden kan ledarna jobba kvar med kontonamnet som lösenord
   (t.ex. anna/anna). Sätt KRAV_LOSENORDSBYTE=1 i .env när ni är redo att
   tvinga fram riktiga lösenord – se docs/SAKERHET.md. */
const KRAV_LOSENORDSBYTE = process.env.KRAV_LOSENORDSBYTE === "1";

if (!HEMLIGHET) {
  console.error("FEL: JWT_SECRET måste sättas. Skapa en med:  openssl rand -hex 32");
  process.exit(1);
}
fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = express();
/* Bara på när tjänsten står bakom en omvänd proxy OCH porten är bunden
   till 127.0.0.1. Annars kan vem som helst förfalska X-Forwarded-For och
   gå runt spärren mot lösenordsgissning. */
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});
app.use(express.json({ limit: "2mb" }));

/* ---------- CORS ---------- */
const TILLATNA = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                  // samma server / curl
    if (!TILLATNA.length) return cb(null, true);         // inget satt = tillåt allt
    cb(null, TILLATNA.includes(origin));
  }
}));

if (!TILLATNA.length) {
  console.warn("VARNING: ALLOWED_ORIGINS är tomt – alla webbplatser får anropa API:t. " +
               "Sätt den till adressen där sidan publiceras.");
}
if (!KRAV_LOSENORDSBYTE) {
  console.warn("VARNING: KRAV_LOSENORDSBYTE är avstängt – ledarna kan logga in och " +
               "ändra passet med kontonamnet som lösenord (t.ex. anna/anna). " +
               "Sätt KRAV_LOSENORDSBYTE=1 i .env innan sidan är i skarp drift.");
}

/* ---------- Enkelt skydd mot lösenordsgissning ---------- */
const forsok = new Map();
function forsokNyckel(req, anvandarnamn) {
  return (req.ip || "") + "|" + String(anvandarnamn || "").toLowerCase();
}
function farForsoka(nyckel) {
  const p = forsok.get(nyckel);
  if (!p) return true;
  if (Date.now() - p.tid > 15 * 60 * 1000) { forsok.delete(nyckel); return true; }
  return p.antal < 10;
}
function raknaFel(nyckel) {
  const p = forsok.get(nyckel) || { antal: 0, tid: Date.now() };
  p.antal += 1; p.tid = Date.now();
  forsok.set(nyckel, p);
  /* Rensa gamla poster så att registret inte kan användas för att
     äta upp minnet med påhittade användarnamn. */
  if (forsok.size > 5000) {
    const grans = Date.now() - 15 * 60 * 1000;
    for (const [k, v] of forsok) if (v.tid < grans) forsok.delete(k);
    if (forsok.size > 5000) forsok.clear();
  }
}

/* ---------- Auth ---------- */
function kravInloggad(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return res.status(401).json({ fel: "Du måste vara inloggad.", kod: "session" });
  try {
    const p = jwt.verify(t, HEMLIGHET);
    const l = anv.hitta(p.sub);
    if (!l) return res.status(401).json({ fel: "Kontot finns inte längre.", kod: "session" });
    /* Byter någon lösenord slutar alla äldre sessioner att gälla – annars
       skulle en inkräktares token leva kvar i upp till TOKEN_TIMMAR. */
    if (p.pv !== anv.losenordsversion(l)) {
      return res.status(401).json({
        fel: "Lösenordet har ändrats. Logga in igen.", kod: "session"
      });
    }
    req.ledare = l;
    next();
  } catch {
    res.status(401).json({ fel: "Sessionen har gått ut. Logga in igen.", kod: "session" });
  }
}

/* Kort minnescache för publika läsningar. Utan den kan vem som helst
   tömma GitHub-tokenens anropsbudget genom att ladda om sidan i loop. */
const LAS_CACHE_MS = Number(process.env.LAS_CACHE_MS || 20000);
const cache = new Map();
async function cachat(nyckel, hamta) {
  const t = cache.get(nyckel);
  if (t && Date.now() - t.tid < LAS_CACHE_MS) return t.varde;
  const varde = await hamta();
  cache.set(nyckel, { tid: Date.now(), varde });
  if (cache.size > 200) cache.clear();
  return varde;
}
function rensaCache() { cache.clear(); }

/* Konton som fortfarande har startlösenordet får bara byta lösenord.
   Utan detta räcker det att gissa "anna/anna" för att kunna ändra
   innehållet – och namnen står på den öppna sidan. */
function kravRiktigtLosenord(req, res, next) {
  if (KRAV_LOSENORDSBYTE && req.ledare && req.ledare.startlosenord) {
    return res.status(403).json({
      fel: "Byt ditt startlösenord innan du ändrar något.",
      kod: "startlosenord"
    });
  }
  next();
}

/* ===========================================================
   API
   =========================================================== */
const api = express.Router();

/* Publik status: säger bara att tjänsten lever och är konfigurerad.
   Ledarnas användarnamn är inloggningsnamn och lämnas inte ut. */
api.get("/status", (req, res) => {
  res.json({ ok: true, konfigurerad: gh.konfig().konfigurerad, tid: new Date().toISOString() });
});

api.get("/status/detaljer", kravInloggad, (req, res) => {
  const k = gh.konfig();
  res.json({
    ok: true,
    github: { owner: k.owner, repo: k.repo, branch: k.branch, konfigurerad: k.konfigurerad },
    ledare: anv.alla(),
    tid: new Date().toISOString()
  });
});

api.post("/login", (req, res) => {
  const { anvandarnamn, losenord } = req.body || {};
  const nyckel = forsokNyckel(req, anvandarnamn);
  if (!farForsoka(nyckel)) {
    return res.status(429).json({ fel: "För många försök. Vänta 15 minuter och försök igen." });
  }
  const l = anv.kontrollera(anvandarnamn, losenord);
  if (!l) {
    raknaFel(nyckel);
    return res.status(401).json({ fel: "Fel användarnamn eller lösenord." });
  }
  forsok.delete(nyckel);
  const token = jwt.sign({ sub: l.id, namn: l.namn, pv: anv.losenordsversion(l) },
                         HEMLIGHET, { expiresIn: Number(GILTIGHET) + "h" });
  res.json({
    token, namn: l.namn,
    maste_byta_losenord: !!l.startlosenord,
    krav_losenordsbyte: KRAV_LOSENORDSBYTE
  });
});

api.post("/losenord", kravInloggad, (req, res) => {
  const { gammalt, nytt } = req.body || {};
  try {
    anv.bytLosenord(req.ledare.id, gammalt, nytt);
    /* Bytet ogiltigförklarar alla tidigare sessioner. Den som just bytte
       får en ny direkt, så hen slipper logga in på nytt. */
    const l = anv.hitta(req.ledare.id);
    const token = jwt.sign({ sub: l.id, namn: l.namn, pv: anv.losenordsversion(l) },
                           HEMLIGHET, { expiresIn: Number(GILTIGHET) + "h" });
    res.json({ ok: true, token });
  } catch (e) {
    res.status(e.status || 400).json({ fel: e.message });
  }
});

/* Innehållsgranskning. Håller nere storleken och ser till att inga
   konstiga adresser (javascript:, data:, andra värdar) kan sparas – även
   om någon skulle komma åt ett ledarkonto. */
const SAKER_URL = /^(https?:\/\/[^\s"'<>]{1,300}|content\/uploads\/[\w.-]{1,120})$/;
const MINST_MOMENT = 4;
const ID_MONSTER = /^[a-z0-9-]{1,60}$/;

function nyGranskare() {
  const fel = [];
  const strang = (v, max, namn) => {
    if (v == null) return "";
    if (typeof v !== "string") { fel.push(namn + " måste vara text"); return ""; }
    if (v.length > max) fel.push(namn + " är för lång (max " + max + " tecken)");
    return v;
  };
  /* Delas av friidrottsmoment (inom ett pass) och lekar (den fristående
     lekbanken) – båda har samma form: namn, ikon, text, bilder, filer. */
  function granskaKort(m, mNamn) {
    if (!m || typeof m !== "object") { fel.push(mNamn + " är trasigt"); return; }
    strang(m.namn, 120, mNamn + ": namnet");
    strang(m.text, 30000, mNamn + ": innehållet");
    strang(m.syfte, 300, mNamn + ": syftet");
    strang(m.ansvarig, 120, mNamn + ": ledaren");
    strang(m.ikon, 16, mNamn + ": ikonen");
    ["bilder", "filer"].forEach((falt) => {
      if (m[falt] == null) return;
      if (!Array.isArray(m[falt])) { fel.push(mNamn + ": " + falt + " är trasigt"); return; }
      if (m[falt].length > 30) fel.push(mNamn + ": för många " + falt + " (max 30)");
      m[falt] = m[falt].filter((x) => x && typeof x === "object" && SAKER_URL.test(String(x.url)));
      m[falt].forEach((x) => {
        x.bildtext = strang(x.bildtext, 300, mNamn + ": bildtexten");
        x.namn = strang(x.namn, 200, mNamn + ": filnamnet");
      });
    });
  }
  return { fel, strang, granskaKort };
}

function granskaPassObjekt(p, forvantatId) {
  if (!p || typeof p !== "object" || !Array.isArray(p.moment)) return ["Passet är trasigt."];
  const { fel, strang, granskaKort } = nyGranskare();
  if (p.id !== forvantatId) fel.push("Passets id stämmer inte med adressen");
  strang(p.namn, 120, "Namnet");
  strang(p.ikon, 16, "Ikonen");
  strang(p.plats, 200, "Platsen");
  strang(p.tid, 100, "Tiden");
  strang(p.grupp, 200, "Gruppen");
  strang(p.samling, 5000, "Samlingen");
  strang(p.uppvarmning, 5000, "Uppvärmningen");
  strang(p.avslutning, 5000, "Avslutningen");
  if (p.datum && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.datum))) {
    fel.push("Datumet måste skrivas som ÅÅÅÅ-MM-DD");
  }
  if (p.moment.length > 40) fel.push("För många moment (max 40)");
  if (p.moment.length < MINST_MOMENT) fel.push("Passet behöver minst " + MINST_MOMENT + " friidrottsmoment");
  p.moment.forEach((m, j) => granskaKort(m, "Moment " + (j + 1)));
  return fel;
}

function granskaLekar(data) {
  if (!data || !Array.isArray(data.lekar)) return ["Lekbanken är trasig."];
  const { fel, granskaKort } = nyGranskare();
  if (data.lekar.length > 60) fel.push("För många lekar (max 60)");
  data.lekar.forEach((l, i) => granskaKort(l, "Lek " + (i + 1)));
  return fel;
}

function granskaSchema(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.tillfallen)) {
    return ["Schemat är trasigt."];
  }
  const { fel, strang } = nyGranskare();
  strang(data.termin, 100, "Terminen");
  if (data.tillfallen.length > 60) fel.push("För många tillfällen (max 60)");

  data.tillfallen.forEach((t, i) => {
    const namn = "Tillfälle " + (i + 1);
    if (!t || typeof t !== "object") { fel.push(namn + " är trasigt"); return; }
    if (!Number.isInteger(t.vecka) || t.vecka < 1 || t.vecka > 53) {
      fel.push(namn + ": veckan måste vara 1–53");
    }
    if (!t.datum || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.datum))) {
      fel.push(namn + ": datumet måste skrivas som ÅÅÅÅ-MM-DD");
    }
    if (t.pass != null && !ID_MONSTER.test(t.pass)) {
      fel.push(namn + ": ogiltigt pass-id");
    }
    if (t.ansvariga != null) {
      if (!Array.isArray(t.ansvariga)) { fel.push(namn + ": ansvariga är trasigt"); return; }
      if (t.ansvariga.length > 4) fel.push(namn + ": för många ansvariga (max 4)");
      t.ansvariga.forEach((a, j) => strang(a, 60, namn + ": ansvarig " + (j + 1)));
    }
    strang(t.notering, 300, namn + ": noteringen");
  });
  return fel;
}

function granskaIndex(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.pass)) return ["Indexet är trasigt."];
  const { fel, strang } = nyGranskare();
  if (data.pass.length < 1 || data.pass.length > 12) fel.push("Antalet pass måste vara 1–12");
  data.pass.forEach((id, i) => {
    if (typeof id !== "string" || !ID_MONSTER.test(id)) fel.push("Pass-id " + (i + 1) + " är ogiltigt");
  });
  strang(data.aktivt, 60, "Aktivt");
  if (data.aktivt && !data.pass.includes(data.aktivt)) {
    fel.push("Det aktuella passet (aktivt) pekar på ett pass som inte finns i listan");
  }
  return fel;
}

/* --- Läsa/spara en enskild innehållsfil (index, ett pass eller lekbanken) ---
   Varje fil har sin egen sha, historik och återställning – det är hela
   poängen med att dela upp innehållet i flera filer i stället för en. */
async function sparaContent(vag, cacheNyckel, data, granska, meddelandeStandard, req, res) {
  const brister = granska(data);
  if (brister.length) return res.status(400).json({ fel: brister.slice(0, 5).join(". ") + "." });

  const nuvarande = await gh.hamtaJson(vag);
  const { sha } = req.body || {};
  if (sha && sha !== nuvarande.sha) {
    return res.status(409).json({
      fel: "Någon annan har hunnit spara. Ladda om och gör om ändringen.",
      sha: nuvarande.sha
    });
  }
  data.uppdaterad = new Date().toISOString();
  data.uppdateradAv = req.ledare.namn;
  const text = (req.body.meddelande || meddelandeStandard).replace(/\s+/g, " ").slice(0, 120);
  const r = await gh.sparaJson(vag, data, `${text} (${req.ledare.namn})`, nuvarande.sha,
    anv.commitForfattare(req.ledare));
  cache.delete(cacheNyckel);
  res.json({ ok: true, sha: r.sha, commit: r.commit, data });
}

api.get("/index", async (req, res, next) => {
  try { res.json(await cachat("index", () => gh.hamtaJson(gh.INDEX_PATH))); }
  catch (e) { next(e); }
});

api.put("/index", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { data } = req.body || {};
    await sparaContent(gh.INDEX_PATH, "index", data, granskaIndex, "Uppdaterade indexet", req, res);
  } catch (e) { next(e); }
});

api.get("/pass/:id", async (req, res, next) => {
  try {
    if (!ID_MONSTER.test(req.params.id)) return res.status(400).json({ fel: "Ogiltigt pass-id." });
    res.json(await cachat("pass:" + req.params.id, () => gh.hamtaJson(gh.passPath(req.params.id))));
  } catch (e) { next(e); }
});

api.put("/pass/:id", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!ID_MONSTER.test(id)) return res.status(400).json({ fel: "Ogiltigt pass-id." });
    const { data } = req.body || {};
    await sparaContent(gh.passPath(id), "pass:" + id, data,
      (d) => granskaPassObjekt(d, id), `Uppdaterade passet ${id}`, req, res);
  } catch (e) { next(e); }
});

api.get("/lekar", async (req, res, next) => {
  try { res.json(await cachat("lekar", () => gh.hamtaJson(gh.LEKAR_PATH))); }
  catch (e) { next(e); }
});

api.put("/lekar", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { data } = req.body || {};
    await sparaContent(gh.LEKAR_PATH, "lekar", data, granskaLekar, "Uppdaterade lekbanken", req, res);
  } catch (e) { next(e); }
});

api.get("/schema", async (req, res, next) => {
  try { res.json(await cachat("schema", () => gh.hamtaJson(gh.SCHEMA_PATH))); }
  catch (e) { next(e); }
});

api.put("/schema", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { data } = req.body || {};
    await sparaContent(gh.SCHEMA_PATH, "schema", data, granskaSchema, "Uppdaterade terminsschemat", req, res);
  } catch (e) { next(e); }
});

/* --- Uppladdning av bild/PDF --- */
const TILLATNA_TYPER = {
  "image/jpeg": { ext: "jpg", typ: "bild" },
  "image/png": { ext: "png", typ: "bild" },
  "image/gif": { ext: "gif", typ: "bild" },
  "image/webp": { ext: "webp", typ: "bild" },
  "application/pdf": { ext: "pdf", typ: "pdf" },
  "text/plain": { ext: "txt", typ: "text" },
  "text/markdown": { ext: "md", typ: "text" }
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_FIL_MB || 10) * 1024 * 1024 }
});

function rentNamn(namn) {
  return String(namn || "fil")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "fil";
}

api.post("/upload", kravInloggad, kravRiktigtLosenord, upload.single("fil"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ fel: "Ingen fil skickades." });
    const info = TILLATNA_TYPER[req.file.mimetype];
    if (!info) {
      return res.status(415).json({
        fel: "Filtypen stöds inte. Tillåtet: JPG, PNG, GIF, WEBP, PDF, TXT, MD."
      });
    }
    /* multer tolkar filnamnet som latin1 – tolka om det som UTF-8 så att
       åäö i filnamn inte blir förvanskade. */
    const originalNamn = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const bas = rentNamn(originalNamn.replace(/\.[^.]+$/, ""));
    const stampel = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filnamn = `${stampel}-${bas}-${Date.now().toString(36)}.${info.ext}`;

    const r = await gh.sparaFil(
      filnamn, req.file.buffer,
      `Laddade upp ${filnamn} (${req.ledare.namn})`,
      anv.commitForfattare(req.ledare)
    );

    /* Lokal kopia så att bilden syns direkt, innan GitHub Pages hunnit bygga om. */
    fs.writeFileSync(path.join(CACHE_DIR, filnamn), req.file.buffer);

    res.json({
      ok: true, url: r.vag, namn: originalNamn,
      typ: info.typ, commit: r.commit
    });
  } catch (e) { next(e); }
});

/* Reservväg för nyss uppladdade filer. */
api.get("/filer/:namn", (req, res) => {
  const namn = path.basename(req.params.namn);
  const p = path.join(CACHE_DIR, namn);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

/* --- Arkiv över genomförda pass --- */
function arkivSlug(pass) {
  const datum = (pass.datum && /^\d{4}-\d{2}-\d{2}$/.test(pass.datum))
    ? pass.datum
    : new Date().toISOString().slice(0, 10);
  const namn = rentNamn(String(pass.namn || "traningspass").toLowerCase())
    .replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "traningspass";
  return `${datum}-${namn}`;
}

async function hamtaArkivIndex() {
  try {
    return await gh.hamtaJson(`${ARKIV_DIR}/index.json`);
  } catch (e) {
    if (e.status === 404) return { data: { schemaVersion: 1, pass: [] }, sha: null };
    throw e;
  }
}

api.get("/arkiv", async (req, res, next) => {
  try {
    res.json(await cachat("arkiv", async () => (await hamtaArkivIndex()).data));
  } catch (e) { next(e); }
});

api.get("/arkiv/:fil", async (req, res, next) => {
  try {
    const fil = path.basename(req.params.fil);
    if (!/^[\w.-]+\.json$/.test(fil) || fil === "index.json") {
      return res.status(400).json({ fel: "Ogiltigt filnamn." });
    }
    const data = await cachat("arkiv:" + fil,
      async () => (await gh.hamtaJson(`${ARKIV_DIR}/${fil}`)).data);
    res.json({ pass: data });
  } catch (e) { next(e); }
});

api.post("/arkivera", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { passId } = req.body || {};
    if (!passId || !ID_MONSTER.test(passId)) return res.status(400).json({ fel: "Okänt träningspass." });
    let original;
    try {
      original = (await gh.hamtaJson(gh.passPath(passId))).data;
    } catch (e) {
      if (e.status === 404) return res.status(400).json({ fel: "Okänt träningspass." });
      throw e;
    }
    const pass = JSON.parse(JSON.stringify(original));

    const index = await hamtaArkivIndex();
    let bas = arkivSlug(pass), fil = `${bas}.json`, n = 2;
    while (index.data.pass.some((p) => p.fil === fil)) { fil = `${bas}-${n++}.json`; }

    pass.arkiverad = new Date().toISOString();
    pass.arkiveradAv = req.ledare.namn;

    await gh.sparaJson(`${ARKIV_DIR}/${fil}`, pass,
      `Arkiverade passet ${pass.namn || fil} (${req.ledare.namn})`, null,
      anv.commitForfattare(req.ledare));

    const post = {
      fil,
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

    await gh.sparaJson(`${ARKIV_DIR}/index.json`, index.data,
      `Uppdaterade arkivlistan (${req.ledare.namn})`, index.sha,
      anv.commitForfattare(req.ledare));

    rensaCache();
    res.json({ ok: true, post });
  } catch (e) { next(e); }
});

/* --- Historik och återställning, en fil i taget ---
   Varje pass, index och lekbanken har sin egen historik, så en
   återställning av t.ex. Höjd rör inte de andra passen. */
function malVag(target) {
  if (target === "index") return gh.INDEX_PATH;
  if (target === "lekar") return gh.LEKAR_PATH;
  if (target === "schema") return gh.SCHEMA_PATH;
  if (target && target.startsWith("pass/")) {
    const id = target.slice(5);
    return ID_MONSTER.test(id) ? gh.passPath(id) : null;
  }
  return null;
}

api.get("/historik/index", kravInloggad, async (req, res, next) => {
  try { res.json(await gh.historikForVag(gh.INDEX_PATH, Number(req.query.antal) || 40)); }
  catch (e) { next(e); }
});
api.get("/historik/lekar", kravInloggad, async (req, res, next) => {
  try { res.json(await gh.historikForVag(gh.LEKAR_PATH, Number(req.query.antal) || 40)); }
  catch (e) { next(e); }
});
api.get("/historik/schema", kravInloggad, async (req, res, next) => {
  try { res.json(await gh.historikForVag(gh.SCHEMA_PATH, Number(req.query.antal) || 40)); }
  catch (e) { next(e); }
});
api.get("/historik/pass/:id", kravInloggad, async (req, res, next) => {
  try {
    if (!ID_MONSTER.test(req.params.id)) return res.status(400).json({ fel: "Ogiltigt pass-id." });
    res.json(await gh.historikForVag(gh.passPath(req.params.id), Number(req.query.antal) || 40));
  } catch (e) { next(e); }
});

api.post("/aterstall", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { target, sha } = req.body || {};
    if (!sha) return res.status(400).json({ fel: "Ingen version angiven." });
    const vag = malVag(target);
    if (!vag) return res.status(400).json({ fel: "Okänt mål för återställning." });

    const gammalt = await gh.jsonVidCommit(vag, sha);
    const nuvarande = await gh.hamtaJson(vag);
    gammalt.uppdaterad = new Date().toISOString();
    gammalt.uppdateradAv = req.ledare.namn;
    const r = await gh.sparaJson(
      vag, gammalt,
      `Återställde ${target} till version ${String(sha).slice(0, 7)} (${req.ledare.namn})`,
      nuvarande.sha,
      anv.commitForfattare(req.ledare)
    );
    cache.delete(target.startsWith("pass/") ? "pass:" + target.slice(5) : target);
    res.json({ ok: true, sha: r.sha, commit: r.commit, data: gammalt });
  } catch (e) { next(e); }
});

app.use("/api", api);

/* ===========================================================
   Statisk webb (så hallenskog kan visa sidan även om
   GitHub Pages ligger nere).
   =========================================================== */
if (fs.existsSync(WEB_DIR)) {
  /* config.js serveras dynamiskt så att apiBase pekar rätt. */
  app.get("/js/config.js", (req, res) => {
    res.type("application/javascript").send(
      "window.PASS_CONFIG = " + JSON.stringify({
        apiBase: "/api",
        maxSidor: Number(process.env.MAX_SIDOR || 3),
        klubb: process.env.KLUBB || "Hagunda IF · Friidrott"
      }, null, 2) + ";\n");
  });
  app.use(express.static(WEB_DIR, { extensions: ["html"] }));
}
if (fs.existsSync(CONTENT_DIR)) {
  /* Läs alltid färskt innehåll från GitHub när filerna efterfrågas statiskt
     (t.ex. index.json, pass/lopning.json, lekar.json) – annars faller vi
     tillbaka på den lokala kopian på disk. */
  app.get(/^\/content\/(index\.json|pass\/[\w-]+\.json|lekar\.json|schema\.json)$/, async (req, res) => {
    const relativVag = req.path.replace(/^\/content\//, "");
    const passMatch = relativVag.match(/^pass\/([\w-]+)\.json$/);
    const fullVag = relativVag === "index.json" ? gh.INDEX_PATH
      : relativVag === "lekar.json" ? gh.LEKAR_PATH
      : relativVag === "schema.json" ? gh.SCHEMA_PATH
      : passMatch ? gh.passPath(passMatch[1])
      : null;
    try {
      if (!fullVag) throw new Error("okänd sökväg");
      const d = await cachat("statisk:" + relativVag, () => gh.hamtaJson(fullVag));
      res.json(d.data);
    } catch {
      res.sendFile(path.resolve(CONTENT_DIR, relativVag));
    }
  });
  app.use("/content", express.static(CONTENT_DIR));
  app.use("/content/uploads", express.static(CACHE_DIR));
}

/* ---------- Felhantering ---------- */
app.use((err, req, res, next) => {                        // eslint-disable-line no-unused-vars
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ fel: "Filen är för stor." });
  }
  const kod = err.status || 500;
  console.error("Fel:", kod, err && err.message);
  /* Interna fel kan innehålla detaljer om GitHub-anropet – dem behåller
     vi i loggen i stället för att skicka ut dem. */
  res.status(kod).json({
    fel: kod >= 500 ? "Något gick fel i tjänsten. Se serverloggen." : (err.message || "Fel")
  });
});

app.listen(PORT, () => {
  const k = gh.konfig();
  console.log(`Ledartjänsten lyssnar på port ${PORT}`);
  console.log(`GitHub: ${k.owner}/${k.repo}@${k.branch} ` +
              `(${k.konfigurerad ? "konfigurerad" : "SAKNAR TOKEN/OWNER/REPO"})`);
  console.log(`Ledare: ${anv.alla().map((l) => l.namn).join(", ")}`);
  console.log(`Kontofil: ${anv.FIL}`);
});
