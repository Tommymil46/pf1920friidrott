# Aktuellt träningspass – Friidrott PF 19/20, Hagunda IF

Webbapp där ledarna håller det aktuella träningspasset uppdaterat, och där
passet kan skrivas ut som underlag för träningen på högst tre A4-sidor.

* **Fem träningspass** – Löpning, Rörelse, Kast, Höjd och Längd – visas som
  flikar. Varje pass har samling, uppvärmning, minst fyra friidrottsmoment och
  en avslutning. Förstasidan öppnar alltid det pass som är markerat som
  **aktuellt just nu**.
* **Ledare loggar in** med knappen högst upp och kan då redigera all text,
  lägga till bilder och PDF:er, ändra ordning på momenten, lägga till nya och
  markera vilket av de fem passen som är aktuellt.
* **Lekar** är en sjätte flik, på samma nivå som de fem passen – en
  fristående lekbank (namn, hur leken går till, bilder/PDF) som inte är
  knuten till ett visst pass, utan kan användas som inslag i vilket
  träningspass som helst.
* **Ingenting försvinner.** Varje sparning blir en commit i det här
  GitHub-repot. Ledarna ser historiken direkt i appen och kan återställa en
  tidigare version med ett klick – historiken och återställningen gäller
  bara det pass (eller lekbanken) man just då tittar på, inte alla passen
  på en gång.
* **Arkiv.** Genomförda pass arkiveras och finns kvar under *Arkiv*, där de
  kan läsas och skrivas ut precis som de såg ut den dagen.

## Så hänger delarna ihop

```
  Webbläsare (ledare/förälder)
        │
        ├── läser ──────────────►  GitHub Pages   (statisk sajt: web/ + content/)
        │                                ▲
        └── redigerar ──────────►  Ledartjänsten  │ commit via GitHubs API
                                   (Cloudflare     │
                                    Worker)       ─┘
```

* **web/** – själva webbappen. Ren HTML/CSS/JS, inget byggsteg.
* **content/** – "databasen", uppdelad i flera filer så att varje del har
  sin egen historik och kan återställas var för sig:
  * **content/index.json** – vilket pass som är aktuellt just nu (`aktivt`)
    och i vilken ordning flikarna ligger.
  * **content/pass/lopning.json** (m.fl., ett per pass) – det enskilda
    passets innehåll.
  * **content/lekar.json** – den fristående lekbanken.
* **content/arkiv/** – genomförda pass, ett per fil, plus `index.json`.
* **content/uploads/** – bilder och PDF:er som ledarna laddat upp.
* **worker/** – ledartjänsten som Cloudflare Worker: inloggning, uppladdning
  och commits till GitHub. Inget eget att drifta – se
  [worker/README.md](worker/README.md).
* **server/** – samma ledartjänst, men som en Docker-container för egen
  server (t.ex. hemma). Ett alternativ till `worker/`, inte ett komplement
  – välj en av de två. Se [docs/DRIFT.md](docs/DRIFT.md).
* **.github/workflows/pages.yml** – publicerar sajten till GitHub Pages vid
  varje ändring.

Sajten fungerar även om ledartjänsten är nere – då går den bara inte att
redigera.

## Kom igång

### 1. Publicera sajten (GitHub Pages)

Slå på Pages i repots inställningar: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Arbetsflödet publicerar sedan sajten
automatiskt vid varje push till `main`, och sidan hamnar direkt på
`https://<användare>.github.io/pf1920friidrott/`.

Står Pages i stället på **Deploy from a branch** fungerar sidan också, men
då ligger appen under `/web/` och rot-adressen skickar dit via en
omdirigering. Actions-läget ger den snyggare adressen.

### 2. Publicera ledartjänsten (Cloudflare Worker)

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create APP_KV     # klistra in id:t i wrangler.toml
npx wrangler secret put JWT_SECRET          # värde: openssl rand -hex 32
npx wrangler secret put GITHUB_TOKEN        # fine-grained, Contents: Read and write
npm run deploy
```

Fullständig guide, inklusive lokal utveckling och vad som skiljer sig mot
Docker-varianten: [worker/README.md](worker/README.md).

### 3. Peka webbappen mot tjänsten

Sätt `apiBase` i [`web/js/config.js`](web/js/config.js) till adressen från
`npm run deploy` (utan något efterföljande `/api`) och pusha. Lämnas den tom
är sajten bara läsbar.

## Ledarkonton

Anna, Eric, Johan, Ludvig och Tommy. Startlösenordet är samma som kontonamnet,
skrivet med samma stora/små bokstäver (lösenordet är skiftlägeskänsligt,
användarnamnet är det inte).
Under uppbyggnaden (`KRAV_LOSENORDSBYTE=0`, standard) går det bra att fortsätta
med det. Sätt `KRAV_LOSENORDSBYTE=1` (i `wrangler.toml` för Workern, eller
`server/.env` för Docker-varianten) innan sidan går i skarp drift – då krävs
ett riktigt lösenord innan något går att ändra. Lösenorden lagras hashade
(PBKDF2 i Workern, bcrypt i Docker-varianten), aldrig i klartext, aldrig i
GitHub.

Sidan är öppen för alla att läsa. Lägg därför inget i passet som inte tål att
läsas av vem som helst – se [docs/SAKERHET.md](docs/SAKERHET.md).

Kort guide för ledarna: [docs/LEDARGUIDE.md](docs/LEDARGUIDE.md).
Säkerhetsgenomgång: [docs/SAKERHET.md](docs/SAKERHET.md).

## Utskrift

Knappen **Skriv ut** längst upp skriver ut förstasidan som träningsunderlag.
Under passet visas hur många A4-sidor utskriften blir – siffran mäts genom
att sidan renderas om med utskriftsstilen, så den stämmer med verkligheten.
Blir det fler än tre sidor erbjuder appen ett kompakt läge utan bilder.

## Test

```bash
npm install                 # Playwright
cd server && npm install && cd ..
node test/fejk-github.mjs & # låtsas-GitHub, se test/README.md
bash test/api-test.sh       # 37 kontroller av API och behörigheter
npm run test:webb           # 16 kontroller av inloggning i webbläsare
npm run test:e2e            # 20 kontroller av hela redigeringsflödet
node test/arkiv-test.mjs    # 11 kontroller av arkivet
node test/pages-test.mjs    # 12 kontroller av båda publiceringslägena
```

Varje svit vill ha en nystartad server – de byter lösenord, så andra körningen
mot samma `DATA_DIR` misslyckas annars. Se [test/README.md](test/README.md).

**Cloudflare Worker** (i `worker/`, ingen egen server behövs för att testa):

```bash
cd worker && npm install
node test/worker-api-test.mjs   # 39 kontroller, workern anropas direkt
```

Se [worker/README.md](worker/README.md#test) för hur man även testar mot en
riktig `workerd`-runtime via `wrangler dev` (4 ytterligare kontroller).

## Utveckling lokalt

**Cloudflare Worker:**

```bash
cd worker && npm install
cp .dev.vars.example .dev.vars    # fyll i ett test-JWT_SECRET och en riktig GITHUB_TOKEN
npm run dev
# öppna http://localhost:8787
```

**Docker-varianten:**

```bash
cd server && npm install
DATA_DIR=./data JWT_SECRET=test PORT=8080 \
  WEB_DIR=../web CONTENT_DIR=../content npm start
# öppna http://localhost:8080
```

Utan `GITHUB_TOKEN` går det inte att spara, men sidan visas och kan skrivas ut.
