# Säkerhetsgenomgång

Genomgång av vad som kan gå fel, vad som är åtgärdat och vad som återstår.
Utgångspunkt: **sidan är öppen för alla att läsa**, bara redigering kräver
inloggning.

Genomgången nedan skrevs för Docker-varianten på hallenskog (`server/`).
Rekommenderade valet är sedan **Cloudflare Worker-varianten** (`worker/`) –
den bygger på samma logik (samma spärrar, samma innehållsgranskning, samma
begränsade GitHub-token) men har inget hemma som kan tas över i första
läget. Det som skiljer sig är beskrivet i
[worker/README.md](../worker/README.md#skillnader-mot-docker-varianten):
PBKDF2 i stället för bcrypt, och att spärren mot lösenordsgissning ligger i
Workers KV i stället för i processminnet.

## Finns något känsligt i koden?

Nej. Repot är genomsökt efter tokenmönster (`ghp_`, `github_pat_`, AWS-nycklar,
privata nycklar) – inga träffar. De enda hemligheterna är `GITHUB_TOKEN` och
`JWT_SECRET`, och de finns bara i `server/.env` på hallenskog. Den filen ligger
i både `.gitignore` och `.dockerignore`, så den kan varken checkas in eller
bakas in i dockerimagen. `server/.env.example` innehåller bara platshållartext.

Ledarnas lösenord lagras bcrypt-hashade i dockervolymen, aldrig i repot.
Commit-författaren blir `namn@users.noreply.github.com` – ingen riktig
e-postadress hamnar i historiken.

## Vad kan en angripare komma åt om hallenskog tas över?

Skadans omfattning är avsiktligt liten:

| Det som finns i containern | Vad det räcker till |
|---|---|
| `GITHUB_TOKEN` | Läsa och skriva filer i **enbart** `Tommymil46/pf1920friidrott`. Inte andra repon, inte organisationen, inte GitHub Actions hemligheter |
| `JWT_SECRET` | Skapa giltiga sessioner för webbappen – alltså ändra passets innehåll |
| `ledare.json` | Bcrypt-hashar. Går inte att läsa ut lösenorden ur |

Tokenen är en **fine-grained token med enbart `Contents: Read and write`**.
Den kan därför inte ändra filer under `.github/workflows/` – GitHub kräver
en separat `Workflows`-behörighet för det. En angripare kan alltså inte
smuggla in kod som körs i era GitHub Actions. Allt hen gör i repot syns
dessutom i historiken och kan återställas.

Containern kan inte skada hallenskog i övrigt: den kör som en egen
oprivilegierad användare, har alla Linux-privilegier bortdragna, filsystemet
monterat skrivskyddat utom `/data` och `/tmp`, och `no-new-privileges` satt så
att rättighetseskalering via setuid-program blockeras.

### Samma fråga för Cloudflare Worker-varianten

Det finns inget "hallenskog att ta över" i Worker-varianten – koden körs i
Cloudflares isolerade miljö, inte på er egen utrustning. Kapas ändå ert
Cloudflare-konto (t.ex. genom ett läckt lösenord) är skadans omfattning
densamma som ovan: `GITHUB_TOKEN` och `JWT_SECRET` är de enda hemligheterna,
och tokenen har fortfarande bara `Contents: Read and write` på det här
repot. Lösenorden ligger PBKDF2-hashade i Workers KV, inte i klartext.

## Åtgärdat i den här genomgången

| Risk | Åtgärd |
|---|---|
| **Startlösenordet = namnet, och namnen står på den öppna sidan.** Det räckte att gissa `anna/anna` | Byggt som en avstängningsbar spärr: `KRAV_LOSENORDSBYTE=1` gör att konton med startlösenord **bara kan byta lösenord** – all redigering, uppladdning, arkivering och återställning svarar 403 tills bytet är gjort, och appen öppnar lösenordsrutan direkt vid inloggning. **Avstängd som standard** under uppbyggnaden, på er begäran – se punkt 2 nedan |
| `/api/status` listade alla ledarnas användarnamn publikt | Publik status säger bara att tjänsten lever. Namnen ligger bakom inloggning på `/api/status/detaljer` |
| En inkräktares session levde kvar i upp till 12 timmar efter att lösenordet bytts | Sessionen binds till lösenordets hash. Vid byte slutar **alla** tidigare sessioner att gälla direkt, och den som byter får en ny session i samma svar |
| Vem som helst kunde tömma GitHub-tokenens anropsbudget genom att ladda om sidan i loop | Publika läsningar cachas 20 sekunder i minnet (`LAS_CACHE_MS`) |
| Registret över misslyckade inloggningar kunde växa obegränsat med påhittade användarnamn | Rensas automatiskt vid 5 000 poster |
| Ett kapat ledarkonto kunde spara `javascript:`-adresser som sedan kördes hos besökarna | Adresser granskas både på servern (bara `https://…` och `content/uploads/…` sparas) och i webbläsaren innan de sätts som `href`/`src` |
| Ett kapat konto kunde spara godtyckligt stort innehåll | Servern granskar längder och antal: max 12 träningspass, max 40 moment per pass, 30 000 tecken per moment, 30 bilagor per moment |
| Serverfel skickade ut interna detaljer om GitHub-anropen | 5xx svarar generiskt utåt, detaljerna hamnar i loggen |
| `X-Forwarded-For` kunde förfalskas för att gå runt spärren mot lösenordsgissning | `trust proxy` är avstängt som standard och slås på med `TRUST_PROXY=1` först när tjänsten står bakom en proxy |
| Porten publicerades på alla nätverkskort | Compose binder till `127.0.0.1:8080` – tjänsten når man via den omvända proxyn, inte direkt |
| Ingen begränsning av minne eller processer | `mem_limit`, `pids_limit` och roterande loggar satta |
| Saknade säkerhetsrubriker | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |

## Skydd som fanns redan från början

* Lösenord bcrypt-hashade, med jämförelse mot en dummy-hash för okända konton
  så att svarstiden inte avslöjar vilka konton som finns.
* Spärr efter 10 misslyckade inloggningar per konto och IP i 15 minuter.
* Uppladdning tillåter bara JPG, PNG, GIF, WEBP, PDF, TXT och MD – **inte SVG**,
  som kan innehålla skript. Max 10 MB per fil.
* Filnamn saneras och får ett serversatt prefix, så de kan inte peka utanför
  uppladdningskatalogen.
* All text från ledarna escapas innan den visas – ingen HTML slinker igenom.
* Redigering kräver alltid inloggning; sparning kontrollerar att ingen annan
  hunnit ändra samtidigt.

## Kvar att göra – och det är du som gör det

1. **Kör aldrig tjänsten över oskyddad HTTP.** Lösenorden skickas då i
   klartext. Workern får HTTPS automatiskt av Cloudflare – inget att göra
   där. Kör ni Docker-varianten i stället: antingen VPN, eller en omvänd
   proxy med HTTPS.
2. **Sätt `KRAV_LOSENORDSBYTE=1` innan sidan går i skarp drift** – alltså innan
   ni bjuder in fler än er själva att läsa den, eller lägger upp riktiga
   uppgifter ni bryr er om. Fram tills dess konton kan redigera med
   kontonamnet som lösenord (t.ex. `anna/anna`).
3. **Sätt `ALLOWED_ORIGINS`** till adressen där sidan publiceras. Lämnas den tom
   får vilken webbplats som helst anropa API:t.
4. **Sätt en utgångstid på GitHub-tokenen** och skriv upp när den går ut.
5. **Säkerhetskopiera lösenordsdatan** – det enda som inte finns i GitHub.
   Workern: `npx wrangler kv key get ledare --namespace-id <id>`. Docker:
   `/data` i dockervolymen, se DRIFT.md.

## Medvetna avvägningar

* **Sidan är öppen.** Det var ditt val, och det betyder att passets innehåll,
  alla uppladdade filer och hela ändringshistoriken är publika. Lägg inget där
  som inte tål att läsas av vem som helst – särskilt inga bilder på barn.
* **Ingen tvåfaktor.** För fem ledare som ändrar ett träningspass är det rimligt.
  Vill ni ha det är inloggning med engångslänk via mejl nästa steg.
* **PDF:er visas i webbläsaren.** En PDF kan innehålla skript som körs i
  webbläsarens PDF-visare. Ladda bara upp filer ni själva gjort eller litar på.
