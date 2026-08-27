/* ===========================================================
   Ledarkonton, lagrade i Workers KV under en enda nyckel – samma
   modell som JSON-filen server/src/anvandare.js använder, bara
   flyttad från disk till KV. Lösenord bcrypt-… nej, PBKDF2-hashade
   via kodning.mjs, aldrig i klartext.

   Obs: KV har ingen atomär läs-ändra-skriv. Byter två ledare
   lösenord i exakt samma sekund kan den ena skrivningen förloras.
   Med fem ledare som byter lösenord högst någon gång är risken
   försumbar – en Durable Object vore rätt lösning om det någonsin
   blir ett problem.
   =========================================================== */

import { hashaLosenord, jamforLosenord } from "./kodning.mjs";

const KV_NYCKEL = "ledare";

function parseLedare(env) {
  return (env.LEDARE || "Anna,Eric,Johan,Ludvig,Tommy")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

async function lasDb(env) {
  const rad = await env.APP_KV.get(KV_NYCKEL);
  return rad ? JSON.parse(rad) : null;
}

function skrivDb(env, db) {
  return env.APP_KV.put(KV_NYCKEL, JSON.stringify(db));
}

async function seedaKonto(namn) {
  const id = namn.toLowerCase();
  return {
    id, namn,
    hash: await hashaLosenord(namn),
    startlosenord: true,
    skapad: new Date().toISOString()
  };
}

/* Skapar databasen om den saknas, och lägger till nya namn från
   LEDARE-listan som inte redan finns. Körs vid varje anrop som
   behöver kontona – KV-läsningen är billig (ingår i gratisplanen). */
async function sakerstallDb(env) {
  let db = await lasDb(env);
  const namn = parseLedare(env);
  let andrad = false;

  if (!db) { db = { ledare: {} }; andrad = true; }
  for (const n of namn) {
    const id = n.toLowerCase();
    if (!db.ledare[id]) {
      db.ledare[id] = await seedaKonto(n);
      andrad = true;
    }
  }
  if (andrad) await skrivDb(env, db);
  return db;
}

async function hitta(env, anvandarnamn) {
  if (!anvandarnamn) return null;
  const db = await sakerstallDb(env);
  return db.ledare[String(anvandarnamn).trim().toLowerCase()] || null;
}

async function kontrollera(env, anvandarnamn, losenord) {
  const l = await hitta(env, anvandarnamn);
  const ok = await jamforLosenord(losenord, l ? l.hash : null);
  return ok ? l : null;
}

async function bytLosenord(env, id, gammalt, nytt) {
  const db = await sakerstallDb(env);
  const l = db.ledare[id];
  if (!l) { const e = new Error("Kontot finns inte."); e.status = 404; throw e; }
  if (!(await jamforLosenord(gammalt, l.hash))) {
    const e = new Error("Fel nuvarande lösenord."); e.status = 401; throw e;
  }
  if (String(nytt || "").length < 8) {
    const e = new Error("Det nya lösenordet måste vara minst 8 tecken."); e.status = 400; throw e;
  }
  l.hash = await hashaLosenord(nytt);
  l.startlosenord = false;
  l.andrad = new Date().toISOString();
  await skrivDb(env, db);
  return l;
}

/* Namn/e-post som används som commit-författare i GitHub. */
function commitForfattare(l, epostDoman) {
  return { name: l.namn, email: `${l.id}@${epostDoman || "users.noreply.github.com"}` };
}

async function alla(env) {
  const db = await sakerstallDb(env);
  return Object.values(db.ledare).map((l) => ({
    id: l.id, namn: l.namn, startlosenord: !!l.startlosenord
  }));
}

/* Bunden till lösenordets hash – ändras hashen (lösenordsbyte) ändras
   den här strängen, och därmed slutar äldre sessioner att gälla. */
async function losenordsversion(l) {
  const bytes = new TextEncoder().encode(l.hash);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { hitta, kontrollera, bytLosenord, commitForfattare, alla, losenordsversion };
