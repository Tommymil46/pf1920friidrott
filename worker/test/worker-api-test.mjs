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

r = await anropa(env, "/pass", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ pass: { block: [] }, meddelande: "x" })
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

/* --- pass: hämta, spara, konflikt --- */
r = await anropa(env, "/pass");
k("hämtar pass + sha", r.status === 200 && r.data.pass.block.length === 5 && r.data.sha);
const SHA = r.data.sha;

r = await anropa(env, "/pass", { method: "PUT" });
k("sparning kräver inloggning", r.status === 401 && r.data.kod === "session");

const nyttPass = JSON.parse(JSON.stringify(r.data.pass || (await anropa(env, "/pass")).data.pass));
nyttPass.titel = "Pass från workertest";
nyttPass.block[0].text = "Nytt innehåll från workern";

r = await anropa(env, "/pass", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ pass: nyttPass, meddelande: "Testuppdatering", sha: SHA })
});
k("spara som ledare, uppdateradAv sätts", r.status === 200 && r.data.pass.uppdateradAv === "Ludvig");
const NY_SHA = r.data.sha;

r = await anropa(env, "/pass", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ pass: nyttPass, meddelande: "Igen", sha: SHA })
});
k("konflikt upptäcks när två ledare sparar", r.status === 409);

/* --- innehållsgranskning --- */
const ondPass = JSON.parse(JSON.stringify(nyttPass));
ondPass.block[0].bilder = [
  { url: "javascript:alert(1)", bildtext: "ond" },
  { url: "https://exempel.se/ok.png", bildtext: "ok" },
  { url: "content/uploads/bra.png", bildtext: "ok" }
];
r = await anropa(env, "/pass", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ pass: ondPass, meddelande: "test", sha: NY_SHA })
});
k("javascript:-adress filtreras bort på servern",
  r.status === 200 && r.data.pass.block[0].bilder.length === 2 &&
  !r.data.pass.block[0].bilder.some((b) => b.url.startsWith("javascript:")));

const langtPass = JSON.parse(JSON.stringify(nyttPass));
langtPass.block[0].text = "x".repeat(40000);
r = await anropa(env, "/pass", {
  method: "PUT", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ pass: langtPass, meddelande: "test", sha: r.data.sha })
});
k("för långt blockinnehåll avvisas", r.status === 400);

/* --- historik --- */
r = await anropa(env, "/historik", { headers: AUTH });
k("historiken visar vem och vad", r.status === 200 && r.data[0].vem === "Ludvig" && r.data.length >= 3);
const historikSvar = r.data;

r = await anropa(env, "/historik/" + historikSvar[historikSvar.length - 1].sha, { headers: AUTH });
k("kan läsa tidigare version", r.status === 200 && r.data.pass.titel !== "Pass från workertest");

r = await anropa(env, "/aterstall", {
  method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ sha: historikSvar[historikSvar.length - 1].sha })
});
k("återställning till tidigare version",
  r.status === 200 && r.data.pass.titel !== "Pass från workertest" && r.data.pass.uppdateradAv === "Ludvig");

r = await anropa(env, "/historik", { headers: AUTH });
k("inget försvinner – historiken växer", r.data.length > historikSvar.length);

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
r = await anropa(env, "/arkivera", { method: "POST", headers: AUTH });
k("arkivering skapar en post", r.status === 200 && r.data.post.fil.endsWith(".json"));
const arkivFil = r.data.post.fil;

r = await anropa(env, "/arkiv");
k("arkivlistan är publik och innehåller passet",
  r.status === 200 && r.data.pass.length === 1 && r.data.pass[0].arkiveradAv === "Ludvig");

r = await anropa(env, "/arkiv/" + arkivFil);
k("arkiverat pass går att läsa", r.status === 200 && r.data.pass.block);

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
