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
put('content/pass.json', Buffer.from(JSON.stringify({ schemaVersion:1, titel:'Start', block:[{id:'lopning',namn:'Löpning',text:'a',bilder:[],filer:[]}] }, null, 2)).toString('base64'), 'Initial', { name:'system' });

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
srv.listen(9099, () => console.log('fejk-github på 9099'));
