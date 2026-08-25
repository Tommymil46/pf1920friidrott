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

api.get("/pass", async (req, res, next) => {
  try {
    res.json(await cachat("pass", () => gh.hamtaPass()));
  } catch (e) { next(e); }
});

/* Innehållsgranskning. Håller nere storleken och ser till att inga
   konstiga adresser (javascript:, data:, andra värdar) kan sparas – även
   om någon skulle komma åt ett ledarkonto. */
const SAKER_URL = /^(https?:\/\/[^\s"'<>]{1,300}|content\/uploads\/[\w.-]{1,120})$/;
const MINST_MOMENT = 4;

function granskaContent(data) {
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

  if (data.pass.length > 12) fel.push("För många träningspass (max 12)");
  const anvandaId = new Set();

  data.pass.forEach((p, i) => {
    const namn = "Pass " + (i + 1);
    if (!p || typeof p !== "object" || !Array.isArray(p.moment)) {
      fel.push(namn + " är trasigt"); return;
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
      fel.push(namn + ": datumet måste skrivas som ÅÅÅÅ-MM-DD");
    }
    if (anvandaId.has(p.id)) fel.push(namn + ": id:t måste vara unikt");
    anvandaId.add(p.id);

    if (p.moment.length > 40) fel.push(namn + ": för många moment (max 40)");
    if (p.moment.length < MINST_MOMENT) {
      fel.push(namn + ": behöver minst " + MINST_MOMENT + " friidrottsmoment");
    }

    p.moment.forEach((m, j) => granskaKort(m, namn + ", moment " + (j + 1)));
  });

  if (data.aktivt && !anvandaId.has(data.aktivt)) {
    fel.push("Det aktuella passet (aktivt) pekar på ett pass som inte finns");
  }

  if (data.lekar != null) {
    if (!Array.isArray(data.lekar)) {
      fel.push("Lekbanken är trasig");
    } else {
      if (data.lekar.length > 60) fel.push("För många lekar (max 60)");
      data.lekar.forEach((l, i) => granskaKort(l, "Lek " + (i + 1)));
    }
  }

  return fel;
}

api.put("/pass", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { pass, meddelande, sha } = req.body || {};
    if (!pass || typeof pass !== "object" || !Array.isArray(pass.pass)) {
      return res.status(400).json({ fel: "Ogiltigt innehåll." });
    }
    const brister = granskaContent(pass);
    if (brister.length) {
      return res.status(400).json({ fel: brister.slice(0, 5).join(". ") + "." });
    }
    const nuvarande = await gh.hamtaPass();
    if (sha && sha !== nuvarande.sha) {
      return res.status(409).json({
        fel: "Någon annan har hunnit spara. Ladda om och gör om ändringen.",
        sha: nuvarande.sha
      });
    }
    pass.uppdaterad = new Date().toISOString();
    pass.uppdateradAv = req.ledare.namn;

    const text = (meddelande || "Uppdaterade träningspassen").replace(/\s+/g, " ").slice(0, 120);
    const r = await gh.sparaPass(
      pass,
      `${text} (${req.ledare.namn})`,
      nuvarande.sha,
      anv.commitForfattare(req.ledare)
    );
    rensaCache();
    res.json({ ok: true, sha: r.sha, commit: r.commit, pass });
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
    const nuvarande = await gh.hamtaPass();
    const helaInnehallet = nuvarande.pass;
    const original = (helaInnehallet.pass || []).find((p) => p.id === passId);
    if (!original) return res.status(400).json({ fel: "Okänt träningspass." });
    const pass = JSON.parse(JSON.stringify(original));

    const index = await hamtaArkivIndex();
    let bas = arkivSlug(pass), fil = `${bas}.json`, n = 2;
    while (index.data.pass.some((p) => p.fil === fil)) { fil = `${bas}-${n++}.json`; }

    pass.uppdaterad = helaInnehallet.uppdaterad || null;
    pass.uppdateradAv = helaInnehallet.uppdateradAv || "";
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

/* --- Historik --- */
api.get("/historik", kravInloggad, async (req, res, next) => {
  try { res.json(await gh.historik(Number(req.query.antal) || 40)); }
  catch (e) { next(e); }
});

api.get("/historik/:sha", kravInloggad, async (req, res, next) => {
  try { res.json({ pass: await gh.passVidCommit(req.params.sha) }); }
  catch (e) { next(e); }
});

api.post("/aterstall", kravInloggad, kravRiktigtLosenord, async (req, res, next) => {
  try {
    const { sha } = req.body || {};
    if (!sha) return res.status(400).json({ fel: "Ingen version angiven." });
    const gammalt = await gh.passVidCommit(sha);
    const nuvarande = await gh.hamtaPass();
    gammalt.uppdaterad = new Date().toISOString();
    gammalt.uppdateradAv = req.ledare.namn;
    const r = await gh.sparaPass(
      gammalt,
      `Återställde passet till version ${String(sha).slice(0, 7)} (${req.ledare.namn})`,
      nuvarande.sha,
      anv.commitForfattare(req.ledare)
    );
    rensaCache();
    res.json({ ok: true, sha: r.sha, commit: r.commit, pass: gammalt });
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
        contentUrl: "content/pass.json",
        maxSidor: Number(process.env.MAX_SIDOR || 3),
        klubb: process.env.KLUBB || "Hagunda IF · Friidrott"
      }, null, 2) + ";\n");
  });
  app.use(express.static(WEB_DIR, { extensions: ["html"] }));
}
if (fs.existsSync(CONTENT_DIR)) {
  /* Läs alltid färskt pass från GitHub när det efterfrågas statiskt. */
  app.get("/content/pass.json", async (req, res) => {
    try {
      const d = await cachat("pass", () => gh.hamtaPass());
      res.json(d.pass);
    } catch {
      res.sendFile(path.join(CONTENT_DIR, "pass.json"));
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
