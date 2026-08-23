/* ===========================================================
   Tunn klient mot GitHubs Contents-/Commits-API.
   Varje sparning blir en riktig commit => full ändringshistorik.
   =========================================================== */
"use strict";

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;
const PASS_PATH = process.env.CONTENT_PATH || "content/pass.json";
const UPLOAD_DIR = process.env.UPLOAD_PATH || "content/uploads";

/* GITHUB_API kan pekas om för test eller GitHub Enterprise. */
const API = (process.env.GITHUB_API || "https://api.github.com").replace(/\/+$/, "");

function kravKonfig() {
  const saknas = [];
  if (!OWNER) saknas.push("GITHUB_OWNER");
  if (!REPO) saknas.push("GITHUB_REPO");
  if (!TOKEN) saknas.push("GITHUB_TOKEN");
  if (saknas.length) {
    const e = new Error("Servern saknar konfiguration: " + saknas.join(", "));
    e.status = 500;
    throw e;
  }
}

async function gh(vag, opts = {}) {
  kravKonfig();
  const r = await fetch(API + vag, {
    method: opts.method || "GET",
    headers: {
      Authorization: "Bearer " + TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pf1920-ledartjanst",
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

const b64enc = (str) => Buffer.from(str, "utf8").toString("base64");
const b64dec = (str) => Buffer.from(String(str).replace(/\n/g, ""), "base64").toString("utf8");

/* --- Hämta aktuellt pass --- */
async function hamtaPass(ref) {
  const q = "?ref=" + encodeURIComponent(ref || BRANCH);
  const d = await gh(`/repos/${OWNER}/${REPO}/contents/${PASS_PATH}${q}`);
  return { pass: JSON.parse(b64dec(d.content)), sha: d.sha };
}

/* --- Spara pass (commit) --- */
async function sparaPass(pass, meddelande, sha, forfattare) {
  const innehall = JSON.stringify(pass, null, 2) + "\n";
  const body = {
    message: meddelande,
    content: b64enc(innehall),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
    ...(forfattare ? { author: forfattare, committer: forfattare } : {})
  };
  const d = await gh(`/repos/${OWNER}/${REPO}/contents/${PASS_PATH}`, { method: "PUT", body });
  return { sha: d.content.sha, commit: d.commit.sha };
}

/* --- Ladda upp fil (commit) --- */
async function sparaFil(relativVag, buffer, meddelande, forfattare) {
  const vag = `${UPLOAD_DIR}/${relativVag}`.replace(/\/+/g, "/");
  let befintligSha;
  try {
    const d = await gh(`/repos/${OWNER}/${REPO}/contents/${vag}?ref=${encodeURIComponent(BRANCH)}`);
    befintligSha = d.sha;
  } catch (e) { if (e.status !== 404) throw e; }

  const body = {
    message: meddelande,
    content: buffer.toString("base64"),
    branch: BRANCH,
    ...(befintligSha ? { sha: befintligSha } : {}),
    ...(forfattare ? { author: forfattare, committer: forfattare } : {})
  };
  const d = await gh(`/repos/${OWNER}/${REPO}/contents/${vag}`, { method: "PUT", body });
  return { vag, sha: d.content.sha, commit: d.commit.sha };
}

/* --- Historik för passfilen --- */
async function historik(antal = 40) {
  const d = await gh(
    `/repos/${OWNER}/${REPO}/commits?path=${encodeURIComponent(PASS_PATH)}` +
    `&sha=${encodeURIComponent(BRANCH)}&per_page=${antal}`);
  return d.map((c) => ({
    sha: c.sha,
    vem: (c.commit.author && c.commit.author.name) || "okänd",
    tid: c.commit.author && c.commit.author.date,
    meddelande: (c.commit.message || "").split("\n")[0],
    lank: c.html_url
  }));
}

async function passVidCommit(sha) {
  const d = await gh(
    `/repos/${OWNER}/${REPO}/contents/${PASS_PATH}?ref=${encodeURIComponent(sha)}`);
  return JSON.parse(b64dec(d.content));
}

function konfig() {
  return {
    owner: OWNER, repo: REPO, branch: BRANCH,
    passPath: PASS_PATH, uploadPath: UPLOAD_DIR,
    konfigurerad: !!(OWNER && REPO && TOKEN)
  };
}

module.exports = { hamtaPass, sparaPass, sparaFil, historik, passVidCommit, konfig };
