# Drift – ledartjänsten som Docker-container (hallenskog)

Den här guiden gäller `server/`, Docker-varianten av ledartjänsten. Kör ni
i stället Cloudflare Worker-varianten (rekommenderat, inget hemma öppnas mot
internet) – se [worker/README.md](../worker/README.md) i stället. Avsnitt 1
nedan om GitHub-token gäller båda varianterna.

## 1. GitHub-token

Ledartjänsten behöver skriva i repot. Skapa en **fine-grained personal access
token**:

1. GitHub → Settings → Developer settings → **Personal access tokens →
   Fine-grained tokens** → *Generate new token*.
2. **Repository access:** Only select repositories → `Tommymil46/pf1920friidrott`.
3. **Permissions:** Repository permissions → **Contents: Read and write**.
   Inget mer behövs.
4. Sätt en utgångstid (t.ex. 12 månader) och skriv upp när den går ut.

Ge den **inte** `Workflows`-behörighet. Med enbart `Contents` kan tokenen inte
ändra filer under `.github/workflows/`, och kan alltså inte användas för att
köra egen kod i era GitHub Actions om servern skulle bli kapad.

Klistra in tokenen i `server/.env` som `GITHUB_TOKEN`. Den filen ligger i
`.gitignore` och ska aldrig checkas in.

## 2. Konfiguration

```bash
cp server/.env.example server/.env
openssl rand -hex 32          # klistra in som JWT_SECRET
```

| Variabel | Vad den gör |
|---|---|
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | Var passet lagras |
| `GITHUB_TOKEN` | Token enligt ovan |
| `JWT_SECRET` | Signerar inloggningarna. Byts den loggas alla ut |
| `TOKEN_TIMMAR` | Hur länge en inloggning gäller (standard 12) |
| `ALLOWED_ORIGINS` | Webbadressen som får anropa API:t, t.ex. `https://tommymil46.github.io`. Lämnas den tom får alla webbplatser anropa API:t |
| `TRUST_PROXY` | `1` bara när tjänsten står bakom en omvänd proxy och porten är bunden till `127.0.0.1` |
| `LAS_CACHE_MS` | Hur länge publika läsningar cachas (standard 20 000 ms) |
| `LEDARE` | Kommaseparerad lista med ledarnamn |
| `KRAV_LOSENORDSBYTE` | `0` (standard) under uppbyggnaden – ledarna kan redigera med kontonamnet som lösenord. Sätt till `1` innan skarp drift, se [SAKERHET.md](SAKERHET.md) |
| `MAX_FIL_MB` | Största tillåtna uppladdning (standard 10) |

Nya namn i `LEDARE` läggs till automatiskt vid omstart, med kontonamnet som
startlösenord. Befintliga konton rörs inte.

## 3. Starta

```bash
docker compose -f server/docker-compose.yml up -d --build
docker compose -f server/docker-compose.yml logs -f
curl http://localhost:8080/api/status
```

Kontona sparas i dockervolymen `ledardata` (`/data/ledare.json`). Volymen
måste finnas kvar mellan omstarter, annars nollställs lösenorden till
startvärdena.

## 4. Gör tjänsten nåbar utifrån

Ledarna behöver nå tjänsten från sina telefoner. Två vägar:

* **Enklast och säkrast:** WireGuard/Tailscale hem till hallenskog. Då kan
  redigering bara ske hemifrån eller via VPN, medan alla kan läsa sidan
  på GitHub Pages.
* **Publikt:** en reverse proxy med HTTPS framför tjänsten, t.ex. Caddy:

  ```
  traningspass.dinadoman.se {
      reverse_proxy localhost:8080
  }
  ```

  Sätt då `ALLOWED_ORIGINS=https://tommymil46.github.io` och `apiBase` i
  `web/js/config.js` till `https://traningspass.dinadoman.se/api`.

Kör inte tjänsten publikt över ren HTTP – lösenorden skickas i klartext då.

## 4b. Så är containern begränsad

`docker-compose.yml` kör tjänsten med:

* porten bunden till `127.0.0.1` – inget släpps ut på nätverket direkt
* egen oprivilegierad användare, inte root
* `cap_drop: ALL` och `no-new-privileges:true` – ingen rättighetseskalering
* skrivskyddat filsystem utom `/data` och ett litet `/tmp`
* tak för minne, processer och loggstorlek

Ändra inte de raderna utan att läsa [SAKERHET.md](SAKERHET.md) först.

## 5. Säkerhetskopiering

Innehållet ligger redan i GitHub med full historik. Det enda som bara finns
på hallenskog är lösenordsfilen:

```bash
docker run --rm -v ledardata:/data -v "$PWD":/ut alpine \
  tar czf /ut/ledardata-$(date +%F).tar.gz -C /data .
```

## 6. Uppdatera

```bash
git pull
docker compose -f server/docker-compose.yml up -d --build
```
