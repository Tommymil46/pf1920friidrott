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

if (!HEMLIGHET) {
  console.error("FEL: JWT_SECRET måste sättas. Skapa en med:  openssl rand -hex 32");
  process.exit(1);
}
fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = express();
app.set("trust proxy", 1);
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
    req.ledare = l;
    next();
  } catch {
    res.status(401).json({ fel: "Sessionen har gått ut. Logga in igen.", kod: "session" });
  }
}

/* ===========================================================
   API
   =========================================================== */
const api = express.Router();

api.get("/status", (req, res) => {
  const k = gh.konfig();
  res.json({
    ok: true,
    github: { owner: k.owner, repo: k.repo, branch: k.branch, konfigurerad: k.konfigurerad },
    ledare: anv.alla().map((l) => l.namn),
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
  const token = jwt.sign({ sub: l.id, namn: l.namn }, HEMLIGHET,
                         { expiresIn: Number(GILTIGHET) + "h" });
  res.json({ token, namn: l.namn, maste_byta_losenord: !!l.startlosenord });
});

api.post("/losenord", kravInloggad, (req, res) => {
  const { gammalt, nytt } = req.body || {};
  try {
    anv.bytLosenord(req.ledare.id, gammalt, nytt);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ fel: e.message });
  }
});

api.get("/pass", async (req, res, next) => {
  try {
    const d = await gh.hamtaPass();
    res.json(d);
  } catch (e) { next(e); }
});

api.put("/pass", kravInloggad, async (req, res, next) => {
  try {
    const { pass, meddelande, sha } = req.body || {};
    if (!pass || !Array.isArray(pass.block)) {
      return res.status(400).json({ fel: "Ogiltigt innehåll." });
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

    const text = (meddelande || "Uppdaterade träningspasset").replace(/\s+/g, " ").slice(0, 120);
    const r = await gh.sparaPass(
      pass,
      `${text} (${req.ledare.namn})`,
      nuvarande.sha,
      anv.commitForfattare(req.ledare)
    );
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

api.post("/upload", kravInloggad, upload.single("fil"), async (req, res, next) => {
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

/* --- Historik --- */
api.get("/historik", kravInloggad, async (req, res, next) => {
  try { res.json(await gh.historik(Number(req.query.antal) || 40)); }
  catch (e) { next(e); }
});

api.get("/historik/:sha", kravInloggad, async (req, res, next) => {
  try { res.json({ pass: await gh.passVidCommit(req.params.sha) }); }
  catch (e) { next(e); }
});

api.post("/aterstall", kravInloggad, async (req, res, next) => {
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
      const d = await gh.hamtaPass();
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
  console.error("Fel:", err && err.message);
  res.status(err.status || 500).json({ fel: err.message || "Okänt serverfel" });
});

app.listen(PORT, () => {
  const k = gh.konfig();
  console.log(`Ledartjänsten lyssnar på port ${PORT}`);
  console.log(`GitHub: ${k.owner}/${k.repo}@${k.branch} ` +
              `(${k.konfigurerad ? "konfigurerad" : "SAKNAR TOKEN/OWNER/REPO"})`);
  console.log(`Ledare: ${anv.alla().map((l) => l.namn).join(", ")}`);
  console.log(`Kontofil: ${anv.FIL}`);
});
