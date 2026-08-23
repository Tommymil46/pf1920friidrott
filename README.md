# Aktuellt träningspass – Friidrott PF 19/20, Hagunda IF

Webbapp där ledarna håller det aktuella träningspasset uppdaterat, och där
passet kan skrivas ut som underlag för träningen på högst tre A4-sidor.

* **Förstasidan** visar det aktuella passet: tid, plats, gemensam uppvärmning
  och de fem träningsblocken – löpning, rörelse, kast, höjd och längd.
* **Ledare loggar in** med knappen högst upp och kan då redigera all text,
  lägga till bilder och PDF:er, ändra ordning på blocken och lägga till nya.
* **Ingenting försvinner.** Varje sparning blir en commit i det här
  GitHub-repot. Ledarna ser historiken direkt i appen och kan återställa en
  tidigare version med ett klick.
* **Arkiv.** Genomförda pass arkiveras och finns kvar under *Arkiv*, där de
  kan läsas och skrivas ut precis som de såg ut den dagen.

## Så hänger delarna ihop

```
  Webbläsare (ledare/förälder)
        │
        ├── läser ──────────────►  GitHub Pages   (statisk sajt: web/ + content/)
        │                                ▲
        └── redigerar ──────────►  Ledartjänsten  │ commit via GitHubs API
                                   (Docker på     │
                                    hallenskog)  ─┘
```

* **web/** – själva webbappen. Ren HTML/CSS/JS, inget byggsteg.
* **content/pass.json** – passets innehåll. Detta är "databasen".
* **content/arkiv/** – genomförda pass, ett per fil, plus `index.json`.
* **content/uploads/** – bilder och PDF:er som ledarna laddat upp.
* **server/** – ledartjänsten: inloggning, uppladdning och commits till GitHub.
* **.github/workflows/pages.yml** – publicerar sajten till GitHub Pages vid
  varje ändring.

Sajten fungerar även om ledartjänsten är nere – då går den bara inte att
redigera. Ledartjänsten kan i sin tur visa hela sajten själv om GitHub Pages
skulle ligga nere.

## Kom igång

### 1. Publicera sajten (GitHub Pages)

Slå på Pages i repots inställningar: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Arbetsflödet publicerar sedan sajten
automatiskt vid varje push till `main`, och sidan hamnar direkt på
`https://<användare>.github.io/pf1920friidrott/`.

Står Pages i stället på **Deploy from a branch** fungerar sidan också, men
då ligger appen under `/web/` och rot-adressen skickar dit via en
omdirigering. Actions-läget ger den snyggare adressen.

### 2. Starta ledartjänsten på hallenskog

```bash
git clone https://github.com/Tommymil46/pf1920friidrott.git
cd pf1920friidrott
cp server/.env.example server/.env      # fyll i GITHUB_TOKEN och JWT_SECRET
docker compose -f server/docker-compose.yml up -d --build
```

Kontrollera att den svarar:

```bash
curl http://localhost:8080/api/status
```

### 3. Peka webbappen mot tjänsten

Sätt `apiBase` i [`web/js/config.js`](web/js/config.js) till tjänstens
publika adress, t.ex. `https://hallenskog.example.se/api`, och pusha.
Lämnas den tom är sajten bara läsbar.

Detaljerad driftbeskrivning finns i [docs/DRIFT.md](docs/DRIFT.md).

## Ledarkonton

Anna, Eric, Johan, Ludvig och tommy. Startlösenordet är samma som kontonamnet.
Under uppbyggnaden (`KRAV_LOSENORDSBYTE=0`, standard) går det bra att fortsätta
med det. Sätt `KRAV_LOSENORDSBYTE=1` i `server/.env` innan sidan går i skarp
drift – då krävs ett riktigt lösenord innan något går att ändra. Lösenorden
lagras bcrypt-hashade i dockervolymen, aldrig i GitHub.

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
bash test/api-test.sh       # 27 kontroller av API och behörigheter
npm run test:webb           # 15 kontroller av inloggning i webbläsare
npm run test:e2e            # 20 kontroller av hela redigeringsflödet
node test/arkiv-test.mjs    # 11 kontroller av arkivet
node test/pages-test.mjs    # 12 kontroller av båda publiceringslägena
```

Varje svit vill ha en nystartad server – de byter lösenord, så andra körningen
mot samma `DATA_DIR` misslyckas annars. Se [test/README.md](test/README.md).

## Utveckling lokalt

```bash
cd server && npm install
DATA_DIR=./data JWT_SECRET=test PORT=8080 \
  WEB_DIR=../web CONTENT_DIR=../content npm start
# öppna http://localhost:8080
```

Utan `GITHUB_TOKEN` går det inte att spara, men sidan visas och kan skrivas ut.
