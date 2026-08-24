# Ledartjänst som Cloudflare Worker

Samma ledartjänst som [`server/`](../server) (inloggning, redigering,
uppladdning, commits till GitHub) – men utan egen server att drifta. Ni
väljer **antingen** den här varianten **eller** Docker på hallenskog, inte
båda. Fördelen med Workern: inget hemma öppnas mot internet, Cloudflare
sköter HTTPS och drift, och det ryms i gratisplanen.

Ingen extern kodpaket krävs i själva Workern – ingen `bcryptjs`, ingen
`jsonwebtoken`, ingen `express`. Lösenordshashning (PBKDF2), sessioner (en
handrullad HS256-JWT) och uppladdning (native `FormData`) bygger uteslutande
på webbstandarder som Workers redan har inbyggda. Enda beroendet är
`wrangler` som utvecklingsverktyg.

## 1. Skapa det ni behöver hos Cloudflare

Kräver ett gratis Cloudflare-konto.

```bash
cd worker
npm install
npx wrangler login                       # öppnar webbläsaren för inloggning

npx wrangler kv namespace create APP_KV
```

Det sista kommandot skriver ut ett `id`. Klistra in det i `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "APP_KV"
id = "det-id-du-fick"
```

## 2. Sätt hemligheterna

Aldrig i `wrangler.toml` – hemligheter sätts separat och syns inte i repot:

```bash
npx wrangler secret put JWT_SECRET
# klistra in resultatet av:  openssl rand -hex 32

npx wrangler secret put GITHUB_TOKEN
# fine-grained token, Contents: Read and write, bara detta repo.
# Se ../docs/DRIFT.md avsnitt 1 för hur den skapas.
```

## 3. Kontrollera de övriga inställningarna

`wrangler.toml` har redan rimliga standardvärden under `[vars]`:

| Variabel | Betydelse |
|---|---|
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | Var passet lagras |
| `LEDARE` | Kommaseparerad lista med ledarnamn |
| `ALLOWED_ORIGINS` | Webbadressen som får anropa API:t |
| `KRAV_LOSENORDSBYTE` | `"0"` under uppbyggnaden, `"1"` i skarp drift – se [../docs/SAKERHET.md](../docs/SAKERHET.md) |
| `TOKEN_TIMMAR` | Hur länge en inloggning gäller |
| `MAX_FIL_MB` | Största tillåtna uppladdning |
| `LAS_CACHE_MS` | Hur länge publika läsningar cachas |

## 4. Testa lokalt

```bash
cp .dev.vars.example .dev.vars     # fyll i ett test-JWT_SECRET och en riktig GITHUB_TOKEN
npm run dev
```

Workern körs då på `http://localhost:8787` med en riktig `workerd`-runtime
(samma motor som i produktion) och en lokalt simulerad KV-namnrymd.

## 5. Publicera

```bash
npm run deploy
```

Wrangler skriver ut den publika adressen, `https://pf1920-ledartjanst.<ditt
konto>.workers.dev`. Vill ni ha ett eget domännamn går det att lägga till
efteråt i Cloudflare-panelen – inget i koden behöver ändras då.

## 6. Peka appen mot Workern

Sätt `apiBase` i [`../web/js/config.js`](../web/js/config.js) till adressen
från steg 5, **utan** något efterföljande `/api` (Workerns rutter ligger i
roten, t.ex. `/login`, `/pass`, inte `/api/login`):

```js
apiBase: "https://pf1920-ledartjanst.ditt-konto.workers.dev",
```

## Skillnader mot Docker-varianten

* **Ingen egen statisk webbsida.** `server/` kan visa hela sajten om GitHub
  Pages ligger nere; det gör inte Workern – den är bara API:t. Det är GitHub
  Pages som ska stå för sajten i den här varianten. Det är i praktiken aldrig
  ett problem: GitHub Pages har mycket hög upptid.
* **Lösenordshashning:** PBKDF2 (Web Crypto) med 20 000 iterationer i stället
  för bcrypt. Iterationsantalet är satt lågt med flit – Workers gratisplan
  har ett tak på 10 ms CPU-tid per anrop, och uppmätt tid i en riktig
  `workerd`-runtime är ~5 ms per lösenordskontroll, ~5–12 ms för ett
  lösenordsbyte (två hashningar). Se `worker/src/kodning.mjs` för
  resonemanget. Kör ni Workers Paid (50 ms+ CPU, 5 USD/månad) går det att
  höja iterationsantalet.
* **Spärren mot lösenordsgissning och den korta läscachen** ligger i
  Workers KV respektive Cache API i stället för minnet i en långlivad
  process. KV:s gratisplan tillåter 1 000 skrivningar per dygn – gott och
  väl för fem ledare, men värt att känna till om ni märker att spärren
  slutar fungera mitt i ett skarpt brute-force-försök (KV börjar då neka
  skrivningar, vilket i värsta fall gör spärren mer tillåtande, inte
  mindre – flagga det här om det någonsin blir aktuellt).
* **Kontodatabasen** ligger som en enda JSON-post i KV i stället för en fil.
  KV saknar atomär läs-ändra-skriv, så byter två ledare lösenord i exakt
  samma sekund kan den ena ändringen förloras. Med fem ledare som byter
  lösenord högst någon enstaka gång är risken försumbar.

## Test

```bash
cd worker
node test/worker-api-test.mjs          # 32 kontroller, workern anropas direkt (ingen wrangler behövs)
```

Mot en riktig `workerd`-runtime (fångar det Node inte kan simulera):

```bash
node ../test/fejk-github.mjs &         # låtsas-GitHub på :9099
npm run dev &                          # wrangler dev på :8787
bash test/wrangler-dev-test.sh         # 4 kontroller
```
