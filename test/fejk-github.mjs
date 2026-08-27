/* Minimal låtsas-GitHub: Contents-API + Commits-API, i minnet. */
import http from 'node:http';
import crypto from 'node:crypto';

const filer = new Map();      // path -> {content(base64), sha}
const commits = [];           // {sha, path, message, author, date}

function sha() { return crypto.randomBytes(20).toString('hex'); }
function put(path, contentB64, message, author) {
  const s = sha();
  filer.set(path, { content: contentB64, sha: s });
  const c = { sha: sha(), path, message, author, date: new Date().toISOString(), fileSha: s, content: contentB64 };
  commits.unshift(c);
  return { content: { sha: s }, commit: { sha: c.sha } };
}
/* Utgå från repots riktiga startinnehåll, så testerna speglar verkligheten.
   Innehållet ligger som flera filer: index.json, ett pass per fil under
   pass/, och lekar.json – varje fil får sin egen sha och historik. */
import fs from 'node:fs';
const contentDir = new URL('../content/', import.meta.url);
function b64Fil(relativVag) {
  return Buffer.from(fs.readFileSync(new URL(relativVag, contentDir), 'utf8')).toString('base64');
}
put('content/index.json', b64Fil('index.json'), 'Startinnehåll', { name: 'system' });
put('content/lekar.json', b64Fil('lekar.json'), 'Startinnehåll', { name: 'system' });
put('content/schema.json', b64Fil('schema.json'), 'Startinnehåll', { name: 'system' });
for (const namn of fs.readdirSync(new URL('pass/', contentDir))) {
  put('content/pass/' + namn, b64Fil('pass/' + namn), 'Startinnehåll', { name: 'system' });
}

const srv = http.createServer((req, res) => {
  let kropp = '';
  req.on('data', d => kropp += d);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const svar = (kod, data) => { res.writeHead(kod, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return svar(401, { message: 'Bad credentials' });

    const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[3]);
      if (req.method === 'GET') {
        const ref = u.searchParams.get('ref');
        const c = commits.find(c => c.sha === ref && c.path === path);
        if (c) return svar(200, { content: c.content, sha: c.fileSha, path });
        const f = filer.get(path);
        return f ? svar(200, { content: f.content, sha: f.sha, path }) : svar(404, { message: 'Not Found' });
      }
      if (req.method === 'PUT') {
        const b = JSON.parse(kropp);
        const f = filer.get(path);
        if (f && b.sha !== f.sha) return svar(409, { message: 'sha does not match' });
        if (!f && b.sha) return svar(422, { message: 'sha given for new file' });
        return svar(200, put(path, b.content, b.message, b.author));
      }
    }
    if (/^\/repos\/[^/]+\/[^/]+\/commits$/.test(u.pathname)) {
      const path = u.searchParams.get('path');
      return svar(200, commits.filter(c => c.path === path).map(c => ({
        sha: c.sha, html_url: 'http://fejk/'+c.sha,
        commit: { message: c.message, author: { name: c.author?.name || 'okänd', date: c.date } }
      })));
    }
    svar(404, { message: 'Not Found: ' + u.pathname });
  });
});
srv.listen(9099, '127.0.0.1', () => console.log('fejk-github på 9099'));
