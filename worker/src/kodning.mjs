/* ===========================================================
   Bas64url och lösenordshashning med Web Crypto – de enda
   kryptoprimitiver Cloudflare Workers har inbyggda. Ingen extern
   beroende (ingen bcryptjs) behövs.

   Iterationsantalet för PBKDF2 är satt lågt (20 000) med flit:
   Workers gratisplan har ett tak på 10 ms CPU-tid per anrop, och
   lösenordsbyte gör två hashningar i samma anrop (kontrollera det
   gamla + hasha det nya). Uppmätt tid för 20 000 iterationer är
   ~3 ms, dvs ~6 ms för lösenordsbyte – gott om marginal. Det är
   färre iterationer än OWASP rekommenderar för PBKDF2-SHA256 idag,
   men kombinerat med spärren mot upprepade inloggningsförsök är det
   en rimlig avvägning för en liten lagsida. Kör ni Workers Paid
   (50 ms+ CPU) kan ITERATIONER höjas gott och väl.
   =========================================================== */

const ITERATIONER = 20000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFranBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFranB64url(str) {
  str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlFranSträng(s) { return b64urlFranBytes(enc.encode(s)); }
function strängFranB64url(s) { return dec.decode(bytesFranB64url(s)); }

function timingSaker(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveraBits(losenord, salt, iterationer) {
  const nyckel = await crypto.subtle.importKey(
    "raw", enc.encode(losenord), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iterationer, hash: "SHA-256" }, nyckel, 256);
}

async function hashaLosenord(losenord) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveraBits(losenord, salt, ITERATIONER);
  return `pbkdf2$${ITERATIONER}$${b64urlFranBytes(salt)}$${b64urlFranBytes(new Uint8Array(bits))}`;
}

/* En fast, ogiltig hash att jämföra mot när kontot inte finns – så att
   svarstiden inte avslöjar vilka användarnamn som är giltiga. */
const DUMMY_HASH = `pbkdf2$${ITERATIONER}$` +
  b64urlFranBytes(new Uint8Array(16)) + "$" + b64urlFranBytes(new Uint8Array(32));

async function jamforLosenord(losenord, hashStr) {
  const h = String(hashStr || DUMMY_HASH);
  const delar = h.split("$");
  if (delar.length !== 4 || delar[0] !== "pbkdf2") {
    await deriveraBits(losenord, new Uint8Array(16), ITERATIONER);
    return false;
  }
  const iter = parseInt(delar[1], 10) || ITERATIONER;
  const salt = bytesFranB64url(delar[2]);
  const forvantad = bytesFranB64url(delar[3]);
  const faktisk = new Uint8Array(await deriveraBits(losenord, salt, iter));
  return timingSaker(faktisk, forvantad);
}

/* ---------- Minimal HS256-JWT, utan bibliotek ---------- */

async function hmacNyckel(hemlighet) {
  return crypto.subtle.importKey(
    "raw", enc.encode(hemlighet), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signJwt(nyttolast, hemlighet, giltighetSekunder) {
  const header = { alg: "HS256", typ: "JWT" };
  const nu = Math.floor(Date.now() / 1000);
  const full = { ...nyttolast, iat: nu, exp: nu + giltighetSekunder };
  const indata = b64urlFranSträng(JSON.stringify(header)) + "." +
                 b64urlFranSträng(JSON.stringify(full));
  const nyckel = await hmacNyckel(hemlighet);
  const sig = await crypto.subtle.sign("HMAC", nyckel, enc.encode(indata));
  return indata + "." + b64urlFranBytes(new Uint8Array(sig));
}

async function verifieraJwt(token, hemlighet) {
  const delar = String(token || "").split(".");
  if (delar.length !== 3) throw new Error("Ogiltig token");
  const [h, p, s] = delar;
  const nyckel = await hmacNyckel(hemlighet);
  const ok = await crypto.subtle.verify("HMAC", nyckel, bytesFranB64url(s), enc.encode(h + "." + p));
  if (!ok) throw new Error("Ogiltig signatur");
  const nyttolast = JSON.parse(strängFranB64url(p));
  const nu = Math.floor(Date.now() / 1000);
  if (nyttolast.exp && nyttolast.exp < nu) throw new Error("Token har gått ut");
  return nyttolast;
}

export {
  hashaLosenord, jamforLosenord, signJwt, verifieraJwt,
  b64urlFranBytes, bytesFranB64url, b64urlFranSträng, strängFranB64url
};
