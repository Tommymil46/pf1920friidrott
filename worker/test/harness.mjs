/* Testhjälpare: kör workern direkt (utan wrangler) mot mockad KV,
   Cache API och en riktig fetch mot låtsas-GitHub på :9099. */
import worker from "../src/index.mjs";

export function mockKV() {
  const store = new Map();
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expireAt && Date.now() > e.expireAt) { store.delete(key); return null; }
      return e.value;
    },
    async getWithMetadata(key) {
      const e = store.get(key);
      if (!e || (e.expireAt && Date.now() > e.expireAt)) return { value: null, metadata: null };
      return { value: e.value, metadata: e.metadata || null };
    },
    async put(key, value, opts = {}) {
      store.set(key, {
        value,
        metadata: opts.metadata || null,
        expireAt: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null
      });
    },
    async delete(key) { store.delete(key); },
    _store: store
  };
}

function mockCaches() {
  const store = new Map();
  return {
    default: {
      async match(req) { const c = store.get(req.url); return c ? c.clone() : undefined; },
      async put(req, res) { store.set(req.url, res.clone()); },
      async delete(req) { return store.delete(req.url); }
    }
  };
}

export function miljo(overrides = {}) {
  return {
    APP_KV: mockKV(),
    JWT_SECRET: "test-hemlighet",
    GITHUB_API: "http://127.0.0.1:9099",
    GITHUB_OWNER: "a", GITHUB_REPO: "b", GITHUB_TOKEN: "fejktoken", GITHUB_BRANCH: "main",
    LEDARE: "Anna,Eric,Johan,Ludvig,Tommy",
    ...overrides
  };
}

export async function anropa(env, path, opts = {}) {
  globalThis.caches = globalThis.caches || mockCaches();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const request = new Request("https://worker.test" + path, {
    method: opts.method || "GET",
    headers: opts.headers || {},
    body: opts.body
  });
  const svar = await worker.fetch(request, env, ctx);
  await Promise.all(pending);
  const text = await svar.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { rawtext: text }; }
  return { status: svar.status, data, headers: svar.headers };
}

export function nyCaches() { globalThis.caches = mockCaches(); }
