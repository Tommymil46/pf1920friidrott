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
  GITHUB_REPO=pf1920friidrott GITHUB_TOKEN=fejk KRAV_LOSENORDSBYTE=1 \
  WEB_DIR=web CONTENT_DIR=content node server/src/index.js &
bash test/api-test.sh
```

`KRAV_LOSENORDSBYTE=1` slår på spärren så att testerna kan verifiera den.
Standardläget (avstängt) testas separat, se nedan.

## Webbtest

`test/webb-test.mjs` kör inloggning och lösenordsbyte mot en server utan
GitHub-koppling på port 8099 – starta den med `KRAV_LOSENORDSBYTE=1` också.
`test/e2e.mjs` kör hela redigeringsflödet – redigera, ladda upp bild, nytt
block, flytta, ta bort, historik, återställ – mot servern på port 8096 ovan.

```bash
DATA_DIR=/tmp/pf-webb JWT_SECRET=test PORT=8099 KRAV_LOSENORDSBYTE=1 \
  WEB_DIR=web CONTENT_DIR=content node server/src/index.js &
npm run test:webb
SP=/tmp npm run test:e2e
node test/arkiv-test.mjs
```

## Standardläget (lösenordsbyte avstängt)

`test/standardlage-test.sh` verifierar motsatsen: att ledarna kan redigera
direkt med kontonamnet som lösenord när `KRAV_LOSENORDSBYTE` **inte** är satt
– det normala läget under uppbyggnaden.

```bash
DATA_DIR=/tmp/pf-standard JWT_SECRET=hemlig PORT=8093 \
  GITHUB_API=http://127.0.0.1:9099 GITHUB_OWNER=Tommymil46 \
  GITHUB_REPO=pf1920friidrott GITHUB_TOKEN=fejk \
  WEB_DIR=web CONTENT_DIR=content node server/src/index.js &
bash test/standardlage-test.sh
```

## Publiceringslägen

`test/pages-test.mjs` kontrollerar att sidan fungerar både när den publiceras
via GitHub Actions (`web/` i roten) och direkt från grenen (appen under
`/web/`). Starta två statiska servrar först:

```bash
python3 -m http.server 8095 --directory .            # grenläge
mkdir -p /tmp/site && cp -r web/. /tmp/site/ \
  && mkdir -p /tmp/site/content && cp -r content/. /tmp/site/content/
python3 -m http.server 8094 --directory /tmp/site    # Actions-läge
node test/pages-test.mjs
```

## Obs

Sviterna byter lösenord på ledarkontona. Starta om servern med en tom
`DATA_DIR` mellan körningarna, annars misslyckas inloggningen andra gången.
