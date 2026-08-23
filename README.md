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
automatiskt vid varje push till `main`.

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

Anna, Eric, Johan, Ludvig och tommy. Startlösenordet är samma som
kontonamnet – **byt det vid första inloggningen** under *Byt lösenord*.
Lösenorden lagras bcrypt-hashade i Dockervolymen, aldrig i GitHub.

Kort guide för ledarna: [docs/LEDARGUIDE.md](docs/LEDARGUIDE.md).

## Utskrift

Knappen **Skriv ut** längst upp skriver ut förstasidan som träningsunderlag.
Under passet visas hur många A4-sidor utskriften blir – siffran mäts genom
att sidan renderas om med utskriftsstilen, så den stämmer med verkligheten.
Blir det fler än tre sidor erbjuder appen ett kompakt läge utan bilder.

## Utveckling lokalt

```bash
cd server && npm install
DATA_DIR=./data JWT_SECRET=test PORT=8080 \
  WEB_DIR=../web CONTENT_DIR=../content npm start
# öppna http://localhost:8080
```

Utan `GITHUB_TOKEN` går det inte att spara, men sidan visas och kan skrivas ut.
