/* Speglar test/api-test.sh, men anropar workern direkt i processen
   (utan wrangler) mot låtsas-GitHub på :9099 (node test/fejk-github.mjs). */
import { miljo, anropa, nyCaches } from "./harness.mjs";

const kollar = [];
const k = (namn, v) => kollar.push([namn, !!v]);

nyCaches();
const env = miljo({ KRAV_LOSENORDSBYTE: "1" });

/* --- 0. Startlösenord får inte räcka --- */
let r = await anropa(env, "/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ anvandarnamn: "Ludvig", losenord: "Ludvig" })
});
k("inloggning med startlösenord lyckas", r.status === 200 && r.data.token);
let TOK = r.data.token;
let AUTH = { Authorization: "Bearer " + TOK };

r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: { id: "lopning", moment: [] }, meddelande: "x" })
});
k("startlösenord får inte spara", r.status === 403 && r.data.kod === "startlosenord");

r = await anropa(env, "/arkivera", { method: "POST", headers: AUTH });
k("startlösenord får inte arkivera", r.status === 403);

/* --- Byt lösenord --- */
r = await anropa(env, "/losenord", {
  method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ gammalt: "Ludvig", nytt: "ettLangtLosenord1" })
});
k("lösenordsbyte ger ny token direkt", r.status === 200 && r.data.token);
TOK = r.data.token;
AUTH = { Authorization: "Bearer " + TOK };

/* gammal token dör */
r = await anropa(env, "/status/detaljer", { headers: AUTH });
k("den nya sessionen fungerar", r.status === 200);

/* --- status --- */
r = await anropa(env, "/status");
k("publik status läcker inte ledarnamn", r.status === 200 && !("ledare" in r.data));

r = await anropa(env, "/status/detaljer", { headers: AUTH });
k("inloggad ser detaljerna", r.status === 200 && r.data.ledare.length === 5);

/* --- index: hämta, spara, konflikt --- */
r = await anropa(env, "/index");
k("hämtar index + sha", r.status === 200 && r.data.data.pass.length === 5 && r.data.sha);

r = await anropa(env, "/index", { method: "PUT" });
k("sparning kräver inloggning", r.status === 401 && r.data.kod === "session");

/* --- pass: hämta, spara, konflikt --- */
r = await anropa(env, "/pass/lopning");
k("hämtar löpningspasset + sha", r.status === 200 && r.data.data.moment.length === 4 && r.data.sha);
const SHA = r.data.sha;

const nyttPass = JSON.parse(JSON.stringify(r.data.data));
nyttPass.namn = "Löpning (testad)";
nyttPass.moment[0].text = "Nytt innehåll från workern";

r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: nyttPass, meddelande: "Testuppdatering", sha: SHA })
});
k("spara som ledare, uppdateradAv sätts", r.status === 200 && r.data.data.uppdateradAv === "Ludvig");
const NY_SHA = r.data.sha;

r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: nyttPass, meddelande: "Igen", sha: SHA })
});
k("konflikt upptäcks när två ledare sparar", r.status === 409);

r = await anropa(env, "/pass/okant-id", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: nyttPass, meddelande: "fel id", sha: NY_SHA })
});
k("passets id måste matcha adressen", r.status === 400);

/* --- innehållsgranskning --- */
const ondPass = JSON.parse(JSON.stringify(nyttPass));
ondPass.moment[0].bilder = [
  { url: "javascript:alert(1)", bildtext: "ond" },
  { url: "https://exempel.se/ok.png", bildtext: "ok" },
  { url: "content/uploads/bra.png", bildtext: "ok" }
];
r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: ondPass, meddelande: "test", sha: NY_SHA })
});
k("javascript:-adress filtreras bort på servern",
  r.status === 200 && r.data.data.moment[0].bilder.length === 2 &&
  !r.data.data.moment[0].bilder.some((b) => b.url.startsWith("javascript:")));

const langtPass = JSON.parse(JSON.stringify(nyttPass));
langtPass.moment[0].text = "x".repeat(40000);
r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: langtPass, meddelande: "test", sha: r.data.sha })
});
k("för långt momentinnehåll avvisas", r.status === 400);

const forFaPass = JSON.parse(JSON.stringify(nyttPass));
forFaPass.moment = forFaPass.moment.slice(0, 2);
r = await anropa(env, "/pass/lopning", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: forFaPass, meddelande: "test", sha: r.status === 400 ? NY_SHA : r.data.sha })
});
k("färre än fyra moment avvisas", r.status === 400);

/* --- historik, per pass --- */
r = await anropa(env, "/historik/pass/lopning", { headers: AUTH });
k("historiken visar vem och vad", r.status === 200 && r.data[0].vem === "Ludvig" && r.data.length >= 2);
const historikSvar = r.data;

r = await anropa(env, "/aterstall", {
  method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ target: "pass/lopning", sha: historikSvar[historikSvar.length - 1].sha })
});
k("återställning till tidigare version",
  r.status === 200 && r.data.data.namn !== "Löpning (testad)" && r.data.data.uppdateradAv === "Ludvig");

r = await anropa(env, "/historik/pass/lopning", { headers: AUTH });
k("inget försvinner – historiken växer", r.data.length > historikSvar.length);

/* --- ett annat pass rörs inte av löpningens historik/återställning --- */
r = await anropa(env, "/pass/rorelse");
k("rörelsepasset är opåverkat", r.status === 200 && r.data.data.namn === "Rörelse");

/* --- index: sätt aktivt pass --- */
r = await anropa(env, "/index");
const idxData = r.data.data, idxSha = r.data.sha;
idxData.aktivt = "rorelse";
r = await anropa(env, "/index", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: idxData, meddelande: "Satte Rörelse som aktuellt", sha: idxSha })
});
k("index sparas separat från passen", r.status === 200 && r.data.data.aktivt === "rorelse");

r = await anropa(env, "/historik/index", { headers: AUTH });
k("indexet har sin egen historik", r.status === 200 && r.data.length >= 2);

/* --- lekbanken --- */
r = await anropa(env, "/lekar");
k("hämtar lekbanken + sha", r.status === 200 && Array.isArray(r.data.data.lekar) && r.data.sha);
const lekarData = r.data.data, lekarSha = r.data.sha;
lekarData.lekar.push({ id: "test-lek", namn: "Testlek", ikon: "", text: "", bilder: [], filer: [] });
r = await anropa(env, "/lekar", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ data: lekarData, meddelande: "Lade till en lek", sha: lekarSha })
});
k("lekbanken sparas separat", r.status === 200 && r.data.data.lekar.some((l) => l.id === "test-lek"));

r = await anropa(env, "/historik/lekar", { headers: AUTH });
k("lekbanken har sin egen historik", r.status === 200 && r.data.length >= 1);

/* --- uppladdning --- */
const fd1 = new FormData();
fd1.append("fil", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "Ödla Räv.png", { type: "image/png" }));
r = await anropa(env, "/upload", { method: "POST", headers: AUTH, body: fd1 });
k("bilduppladdning committas",
  r.status === 200 && r.data.typ === "bild" && r.data.url.startsWith("content/uploads/") &&
  r.data.namn === "Ödla Räv.png");
const filUrl = r.data.url;

r = await anropa(env, "/filer/" + filUrl.split("/").pop());
k("uppladdad fil nås direkt via API:t", r.status === 200);

const fd2 = new FormData();
fd2.append("fil", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "test.pdf", { type: "application/pdf" }));
r = await anropa(env, "/upload", { method: "POST", headers: AUTH, body: fd2 });
k("PDF-uppladdning", r.status === 200 && r.data.typ === "pdf");

const fd3 = new FormData();
fd3.append("fil", new File([new Uint8Array([0x4d, 0x5a])], "ond.exe", { type: "application/x-msdownload" }));
r = await anropa(env, "/upload", { method: "POST", headers: AUTH, body: fd3 });
k("otillåten filtyp stoppas", r.status === 415);

r = await anropa(env, "/upload", { method: "POST", body: fd1 });
k("uppladdning kräver inloggning", r.status === 401);

/* --- arkiv --- */
r = await anropa(env, "/arkivera", {
  method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ passId: "lopning" })
});
k("arkivering skapar en post", r.status === 200 && r.data.post.fil.endsWith(".json"));
const arkivFil = r.data.post.fil;

r = await anropa(env, "/arkiv");
k("arkivlistan är publik och innehåller passet",
  r.status === 200 && r.data.pass.length === 1 && r.data.pass[0].arkiveradAv === "Ludvig");

r = await anropa(env, "/arkiv/" + arkivFil);
k("arkiverat pass går att läsa", r.status === 200 && r.data.pass.moment);

for (const bad of ["../pass.json", "index.json"]) {
  r = await anropa(env, "/arkiv/" + encodeURIComponent(bad));
  k("sökvägsflykt avvisas (" + bad + ")", r.status === 400 || r.status === 404);
}

/* --- spärr mot lösenordsgissning --- */
for (let i = 0; i < 11; i++) {
  await anropa(env, "/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anvandarnamn: "Anna", losenord: "fel" })
  });
}
r = await anropa(env, "/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ anvandarnamn: "Anna", losenord: "Anna" })
});
k("spärr mot lösenordsgissning", r.status === 429);

/* --- lösenordsbyte dödar andra sessioner --- */
r = await anropa(env, "/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ anvandarnamn: "Eric", losenord: "Eric" })
});
const ericTok1 = r.data.token;
r = await anropa(env, "/losenord", {
  method: "POST", headers: { Authorization: "Bearer " + ericTok1, "Content-Type": "application/json" },
  body: JSON.stringify({ gammalt: "Eric", nytt: "nyttEricLosen1" })
});
const ericTok2 = r.data.token;
r = await anropa(env, "/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ anvandarnamn: "Eric", losenord: "Eric" })
});
const ericTokFel = r; // ska misslyckas, ingen ny session att jämföra
r = await anropa(env, "/status/detaljer", { headers: { Authorization: "Bearer " + ericTok1 } });
k("andra sessioner slutar gälla vid lösenordsbyte", r.status === 401);
r = await anropa(env, "/status/detaljer", { headers: { Authorization: "Bearer " + ericTok2 } });
k("den nya sessionen efter byte fungerar", r.status === 200);

/* --- CORS-huvuden --- */
r = await anropa(miljo({ ALLOWED_ORIGINS: "https://tommymil46.github.io" }), "/status", {
  headers: { Origin: "https://ont.example.com" }
});
k("okänt ursprung får inget Allow-Origin", !r.headers.get("Access-Control-Allow-Origin"));
r = await anropa(miljo({ ALLOWED_ORIGINS: "https://tommymil46.github.io" }), "/status", {
  headers: { Origin: "https://tommymil46.github.io" }
});
k("tillåtet ursprung får Allow-Origin",
  r.headers.get("Access-Control-Allow-Origin") === "https://tommymil46.github.io");

/* --- säkerhetsrubriker --- */
r = await anropa(env, "/status");
k("säkerhetsrubriker satta", r.headers.get("X-Frame-Options") === "DENY" &&
  r.headers.get("X-Content-Type-Options") === "nosniff");

console.log(kollar.map(([n, v]) => (v ? "  OK   " : "  FEL  ") + n).join("\n"));
console.log("misslyckade:", kollar.filter(([, v]) => !v).length);
process.exit(kollar.some(([, v]) => !v) ? 1 : 0);
