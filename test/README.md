# Tester

Kräver `npm install` både i repots rot (Playwright) och i `server/`, samt
`npx playwright install chromium` – eller `CHROMIUM=/sökväg/till/chrome`
om Chromium redan finns på maskinen.

## API-test mot en låtsas-GitHub

Testar inloggning, sparning, konflikthantering, historik, återställning,
uppladdning och spärren mot lösenordsgissning – utan att röra riktiga GitHub.

```bash
node test/fejk-github.mjs &                       # låtsas-GitHub på :9099
DATA_DIR=/tmp/pf-test JWT_SECRET=hemlig PORT=8096 \
  GITHUB_API=http://127.0.0.1:9099 GITHUB_OWNER=Tommymil46 \
  GITHUB_REPO=pf1920friidrott GITHUB_TOKEN=fejk \
  WEB_DIR=web CONTENT_DIR=content node server/src/index.js &
bash test/api-test.sh
```

## Webbtest

`test/webb-test.mjs` kör inloggning och lösenordsbyte mot en server utan
GitHub-koppling (port 8099). `test/e2e.mjs` kör hela redigeringsflödet –
redigera, ladda upp bild, nytt block, flytta, ta bort, historik, återställ –
mot servern på port 8096 ovan.

```bash
npm run test:webb
SP=/tmp npm run test:e2e
```
