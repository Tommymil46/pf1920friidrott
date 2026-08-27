/* ===========================================================
   Ledarkonton. Lagras i en JSON-fil på en Docker-volym, så
   lösenordsbyten överlever omstart. Aldrig i klartext – bcrypt.
   =========================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FIL = path.join(DATA_DIR, "ledare.json");

const START_LEDARE = (process.env.LEDARE || "Anna,Eric,Johan,Ludvig,Tommy")
  .split(",").map((s) => s.trim()).filter(Boolean);

const EPOST_DOMAN = process.env.COMMIT_EPOST_DOMAN || "users.noreply.github.com";

function las() {
  try { return JSON.parse(fs.readFileSync(FIL, "utf8")); }
  catch { return null; }
}

function skriv(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FIL, JSON.stringify(db, null, 2) + "\n", { mode: 0o600 });
}

/* Startlösenord = samma som kontonamnet (enligt önskemål).
   Kontot flaggas som "måste byta lösenord" tills det bytts. */
function seed() {
  const db = { ledare: {} };
  for (const namn of START_LEDARE) {
    const id = namn.toLowerCase();
    db.ledare[id] = {
      id,
      namn,
      hash: bcrypt.hashSync(namn, 10),
      startlosenord: true,
      skapad: new Date().toISOString()
    };
  }
  skriv(db);
  return db;
}

let db = las();
if (!db) db = seed();
else {
  /* Nya namn i LEDARE-listan läggs till automatiskt vid omstart. */
  let andrad = false;
  for (const namn of START_LEDARE) {
    const id = namn.toLowerCase();
    if (!db.ledare[id]) {
      db.ledare[id] = {
        id, namn, hash: bcrypt.hashSync(namn, 10),
        startlosenord: true, skapad: new Date().toISOString()
      };
      andrad = true;
    }
  }
  if (andrad) skriv(db);
}

const DUMMY_HASH = bcrypt.hashSync("ingen-anvandare-med-detta-namn", 10);

function hitta(anvandarnamn) {
  if (!anvandarnamn) return null;
  return db.ledare[String(anvandarnamn).trim().toLowerCase()] || null;
}

function kontrollera(anvandarnamn, losenord) {
  const l = hitta(anvandarnamn);
  if (!l) {
    /* Jämför ändå mot en dummy-hash så att svarstiden blir densamma
       oavsett om kontot finns eller inte. */
    try { bcrypt.compareSync(String(losenord || ""), DUMMY_HASH); } catch { /* strunt i det */ }
    return null;
  }
  return bcrypt.compareSync(String(losenord || ""), l.hash) ? l : null;
}

function bytLosenord(id, gammalt, nytt) {
  const l = db.ledare[id];
  if (!l) { const e = new Error("Kontot finns inte."); e.status = 404; throw e; }
  if (!bcrypt.compareSync(String(gammalt || ""), l.hash)) {
    const e = new Error("Fel nuvarande lösenord."); e.status = 401; throw e;
  }
  if (String(nytt || "").length < 8) {
    const e = new Error("Det nya lösenordet måste vara minst 8 tecken."); e.status = 400; throw e;
  }
  l.hash = bcrypt.hashSync(String(nytt), 10);
  l.startlosenord = false;
  l.andrad = new Date().toISOString();
  skriv(db);
}

/* Namn/e-post som används som commit-författare i GitHub. */
function commitForfattare(l) {
  return { name: l.namn, email: `${l.id}@${EPOST_DOMAN}` };
}

function alla() {
  return Object.values(db.ledare).map((l) => ({
    id: l.id, namn: l.namn, startlosenord: !!l.startlosenord
  }));
}

/* Ändras lösenordet ändras hashen, och därmed den här strängen. Den läggs
   i sessionens token så att gamla sessioner slutar gälla vid ett byte. */
function losenordsversion(l) {
  return crypto.createHash("sha256").update(l.hash).digest("hex").slice(0, 16);
}

module.exports = { hitta, kontrollera, bytLosenord, commitForfattare, alla,
                   losenordsversion, FIL };
