/* ===========================================================
   Tunn klient mot GitHubs Contents-/Commits-API. Samma funktion som
   server/src/github.js, men portad till Workers: ingen Buffer, och
   konfigurationen kommer från `env` (Workers-bindningar) i stället
   för process.env, som inte finns i Workers.
   =========================================================== */

function konfig(env) {
  const base = (env.CONTENT_BASE || "content").replace(/\/+$/, "");
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || "main",
    token: env.GITHUB_TOKEN,
    indexPath: `${base}/index.json`,
    passDir: `${base}/pass`,
    lekarPath: `${base}/lekar.json`,
    uploadDir: env.UPLOAD_PATH || "content/uploads",
    api: (env.GITHUB_API || "https://api.github.com").replace(/\/+$/, ""),
    konfigurerad: !!(env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_TOKEN)
  };
}

function passPath(k, id) { return `${k.passDir}/${id}.json`; }

function kravKonfig(k) {
  const saknas = [];
  if (!k.owner) saknas.push("GITHUB_OWNER");
  if (!k.repo) saknas.push("GITHUB_REPO");
  if (!k.token) saknas.push("GITHUB_TOKEN");
  if (saknas.length) {
    const e = new Error("Servern saknar konfiguration: " + saknas.join(", "));
    e.status = 500;
    throw e;
  }
}

async function gh(k, vag, opts = {}) {
  kravKonfig(k);
  const r = await fetch(k.api + vag, {
    method: opts.method || "GET",
    headers: {
      Authorization: "Bearer " + k.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pf1920-ledartjanst-worker",
      ...(opts.body ? { "Content-Type": "application/json" } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const txt = await r.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
  if (!r.ok) {
    const e = new Error("GitHub: " + (data.message || r.status));
    e.status = r.status === 404 ? 404 : (r.status === 409 || r.status === 422 ? 409 : 502);
    e.github = data;
    throw e;
  }
  return data;
}

/* Standard base64 (inte base64url) – vad GitHubs Contents-API vill ha.
   btoa/atob jobbar bara med Latin1-strängar, så vi går via TextEncoder/
   Decoder för att hantera UTF-8 (å ä ö m.m.) korrekt. */
function b64encStrang(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decTillStrang(b64) {
  const bin = atob(String(b64).replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64encBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* --- Ladda upp fil (commit). bytes är en Uint8Array. --- */
async function sparaFil(env, relativVag, bytes, meddelande, forfattare) {
  const k = konfig(env);
  const vag = `${k.uploadDir}/${relativVag}`.replace(/\/+/g, "/");
  let befintligSha;
  try {
    const d = await gh(k, `/repos/${k.owner}/${k.repo}/contents/${vag}?ref=${encodeURIComponent(k.branch)}`);
    befintligSha = d.sha;
  } catch (e) { if (e.status !== 404) throw e; }

  const body = {
    message: meddelande,
    content: b64encBytes(bytes),
    branch: k.branch,
    ...(befintligSha ? { sha: befintligSha } : {}),
    ...(forfattare ? { author: forfattare, committer: forfattare } : {})
  };
  const d = await gh(k, `/repos/${k.owner}/${k.repo}/contents/${vag}`, { method: "PUT", body });
  return { vag, sha: d.content.sha, commit: d.commit.sha };
}

/* --- Historik och tidigare version för en godtycklig fil ---
   Gör att varje pass, index och lekbanken har sin egen, oberoende
   historik och kan återställas var för sig. */
async function historikForVag(env, vag, antal = 40) {
  const k = konfig(env);
  const d = await gh(k,
    `/repos/${k.owner}/${k.repo}/commits?path=${encodeURIComponent(vag)}` +
    `&sha=${encodeURIComponent(k.branch)}&per_page=${antal}`);
  return d.map((c) => ({
    sha: c.sha,
    vem: (c.commit.author && c.commit.author.name) || "okänd",
    tid: c.commit.author && c.commit.author.date,
    meddelande: (c.commit.message || "").split("\n")[0],
    lank: c.html_url
  }));
}

async function jsonVidCommit(env, vag, sha) {
  const k = konfig(env);
  const d = await gh(k, `/repos/${k.owner}/${k.repo}/contents/${vag}?ref=${encodeURIComponent(sha)}`);
  return JSON.parse(b64decTillStrang(d.content));
}

/* --- Godtycklig JSON-fil i repot --- */
async function hamtaJson(env, vag, ref) {
  const k = konfig(env);
  const q = "?ref=" + encodeURIComponent(ref || k.branch);
  const d = await gh(k, `/repos/${k.owner}/${k.repo}/contents/${vag}${q}`);
  return { data: JSON.parse(b64decTillStrang(d.content)), sha: d.sha };
}

async function sparaJson(env, vag, data, meddelande, sha, forfattare) {
  const k = konfig(env);
  const body = {
    message: meddelande,
    content: b64encStrang(JSON.stringify(data, null, 2) + "\n"),
    branch: k.branch,
    ...(sha ? { sha } : {}),
    ...(forfattare ? { author: forfattare, committer: forfattare } : {})
  };
  const d = await gh(k, `/repos/${k.owner}/${k.repo}/contents/${vag}`, { method: "PUT", body });
  return { sha: d.content.sha, commit: d.commit.sha };
}

export { sparaFil, historikForVag, jsonVidCommit, hamtaJson, sparaJson, konfig, passPath };
