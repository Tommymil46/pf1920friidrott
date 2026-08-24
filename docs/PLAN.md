# Plan – vem gör vad

**C** = Claude (jag), **T** = Tommy (du). Status per 2026-08-23.

## Steg 1–9: klart ✅ (C)

| # | Steg | Vem | Status |
|---|---|---|---|
| 1 | Tema efter hagundaif.se – klubbfärgerna blå `#293589` och gul `#EFD73A`, Roboto Condensed i rubriker, Open Sans i brödtext | C | ✅ |
| 2 | Förstasidan "Aktuellt träningspass" med de fem blocken löpning, rörelse, kast, höjd och längd | C | ✅ |
| 3 | Inloggningsknapp högst upp + konton för Anna, Eric, Johan, Ludvig, tommy (lösenord = kontonamnet, tvingas byta) | C | ✅ |
| 4 | Redigering: text, bilder, PDF, nya block, ändra ordning, ta bort | C | ✅ |
| 5 | Ändringshantering i GitHub – varje sparning blir en commit, historik och återställning direkt i appen | C | ✅ |
| 6 | Utskrift på max 3 A4-sidor, med mätning av verkligt antal sidor och ett kompakt läge | C | ✅ |
| 7 | Ledartjänst i Docker för hallenskog + arbetsflöde som publicerar sajten på GitHub Pages | C | ✅ |
| 8 | Arkiv över genomförda pass, läsbart och utskrivbart | C | ✅ |
| 9 | Säkerhetsgenomgång och härdning – se [SAKERHET.md](SAKERHET.md) | C | ✅ |

## Steg 10: ställ om Pages till GitHub Actions (T) – halvklart

Pages är påslaget, men står på **Deploy from a branch**. Då serveras repot
rakt av: appen hamnar under `/web/` och rot-adressen visade README:n.

Jag har gjort sidan tålig mot båda lägena, så den fungerar redan nu –
rot-adressen skickar vidare till appen. Men för den snyggare adressen:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Då publicerar arbetsflödet `web/` i roten och sidan ligger direkt på
`https://tommymil46.github.io/pf1920friidrott/`.

## Steg 11–14: Cloudflare Worker – klart ✅ (C), publicering kvar (T)

Du valde väg A. Ledartjänsten finns nu byggd som en Cloudflare Worker under
[`worker/`](../worker) – funktionellt identisk med Docker-varianten
(inloggning, redigering, uppladdning, historik, arkiv, samma spärrar), men
utan bcrypt/express/multer/jsonwebtoken: bara webbstandarder (PBKDF2 via Web
Crypto, en handrullad HS256-JWT, native FormData). 36 kontroller passerar,
varav 4 mot en riktig `workerd`-runtime (inte bara simulerat i Node).

**Kvar för dig:**

1. Skapa ett gratis Cloudflare-konto och logga in: `npx wrangler login`
2. Skapa en KV-namnrymd: `npx wrangler kv namespace create APP_KV` och
   klistra in id:t i `worker/wrangler.toml`
3. Sätt hemligheterna: `npx wrangler secret put JWT_SECRET` (kör
   `openssl rand -hex 32` för värdet) och `npx wrangler secret put
   GITHUB_TOKEN` (samma fine-grained token, **Contents: Read and write**,
   som beskrivs i [DRIFT.md](DRIFT.md) avsnitt 1 – klistra aldrig in den
   i en chatt eller i repot)
4. `cd worker && npm install && npm run deploy`

Fullständig steg-för-steg-guide: [worker/README.md](../worker/README.md).

Docker-varianten på hallenskog (`server/`) finns kvar i repot om ni någon
gång skulle vilja byta – välj bara en av de två i produktion.

## Steg 15: peka appen mot Workern (C, när adressen finns)

Så fort du har adressen från `npm run deploy` sätter jag `apiBase` i
`web/js/config.js` till den, och `ALLOWED_ORIGINS` i `wrangler.toml`.

## Steg 16: fyll passet med riktigt innehåll (T + ledarna)

Logga in, byt lösenord, skriv in nästa pass. Innehållet som ligger där nu är
exempel som är tänkta att skrivas över.

## Steg 17: provtryck (T)

Skriv ut ett riktigt pass och se att tre sidor räcker i praktiken. Hör av dig
om något ska vara tätare eller glesare.

---

## Svar på frågorna (2026-08-23)

| Fråga | Svar | Följd |
|---|---|---|
| Ska sidan vara öppen? | **Ja** | Ingen ändring behövs. Men allt – text, bilder, historik och arkiv – är därmed publikt |
| Bilder på barn? | **Nej** | Bra. Det står nu i ledarguiden |
| Är hallenskog rätt plats? | **Kanske inte** – se nedan | Alternativ utrett, du väljer |
| Arkiv över gamla pass? | **Ja** | Byggt och testat |

### Om hallenskog: löst genom att slippa den

Du valde **väg A**: ledartjänsten flyttar till Cloudflare Workers i stället
för hallenskog. Hallenskog behöver alltså inte öppnas mot internet alls –
`worker/` är byggd, testad (36 kontroller, varav 4 mot en riktig
`workerd`-runtime) och redo att publiceras, se stegen ovan.

Docker-varianten på hallenskog finns kvar i repot om ni skulle vilja byta
tillbaka eller köra båda parallellt under en övergång (välj ändå bara en i
skarp drift – peka `web/js/config.js` mot den ni faktiskt använder).

**Avvägningar värda att känna till**, utförligare i
[worker/README.md](../worker/README.md#skillnader-mot-docker-varianten):

* Lösenordshashning byter från bcrypt till PBKDF2 (20 000 iterationer) –
  Workers gratisplan har ett tak på 10 ms CPU-tid per anrop, uppmätt tid är
  ~5 ms per lösenordskontroll i en riktig `workerd`-runtime
* Spärren mot lösenordsgissning och läscachen ligger i Workers KV/Cache API
  i stället för processminne – KV:s gratisplan tillåter 1 000 skrivningar
  per dygn, gott och väl för fem ledare
* Workern serverar ingen egen kopia av sajten om GitHub Pages skulle ligga
  nere (det gjorde hallenskog-varianten) – i praktiken sällan ett problem,
  GitHub Pages har mycket hög upptid

## Sådant jag gärna bygger på – säg till vad du vill ha

* **Övningsbank** som blocken kan hämta färdiga övningar ur, gärna länkad till
  Friidrottens övningsbank.
* **Närvarolista** att pricka av på plats.
* **Kalender/nästa pass** så att föräldrar ser när det är träning.
* **Inloggning med engångslänk via mejl** i stället för lösenord.

## Öppna appar som redigerar filerna direkt

Du frågade efter färdiga öppna appar som öppnar de filer ledarna vill ändra i.
Sådana finns – de kallas Git-baserade CMS:er och redigerar filerna rakt i
GitHub-repot. De tre som lever och underhålls:

| App | Vad den gör | Haken |
|---|---|---|
| [Sveltia CMS](https://github.com/sveltia/sveltia-cms) | Modern, snabb ersättare för Decap. En rad kod, egen `/admin`-sida, bildbibliotek | **Varje ledare måste ha ett GitHub-konto** |
| [Decap CMS](https://decapcms.org/) (f.d. Netlify CMS) | Mest etablerad, samma princip | Samma sak. Dess gamla lösning för konton utan GitHub, *git-gateway*, är [övergiven sedan Netlify CMS lades ner och avråds från](https://github.com/sveltia/sveltia-cms) – Sveltia stödjer den inte alls |
| [Pages CMS](https://pagescms.org/) | Enklast att komma igång med, ingen egen server behövs | Samma sak: GitHub-konto per ledare |

**Alla tre kräver alltså att Anna, Eric, Johan, Ludvig och tommy skaffar var
sitt GitHub-konto och blir medlemmar i repot.** Det var precis det du bad om
att slippa när du ville ha konton med förnamn och enkla lösenord.

Två vägar framåt om du ändå vill ha ett färdigt verktyg:

1. **Låt ledarna skaffa GitHub-konton.** Då kan vi lägga till Sveltia CMS på
   `/admin` *vid sidan av* det jag byggt, utan att ta bort något. Ledarna
   väljer själva vilket de vill använda, och båda skriver till samma filer med
   samma historik. Det är ungefär en halv arbetsomgång för mig.
2. **Behåll inloggningen som den är.** Redigeringen i appen gör redan det ett
   CMS gör – text, bilder, PDF, historik och återställning – men med den fördel
   att ledaren ser passet precis som det kommer att se ut och skrivas ut.

Att bygga en egen koppling mellan enkla konton och Decap går tekniskt, men
kräver att man återupplivar git-gateway-protokollet som ingen underhåller.
Det avråder jag från.

## Finns det färdiga webbappar i stället?

Det gör det, men ingen som täcker det ni bad om – utskrivbart underlag på max
tre sidor och full ändringshistorik i egen regi. Så här ser alternativen ut:

| Alternativ | Passar för | Varför inte här |
|---|---|---|
| [SportAdmin Träningsplanering](https://www.sportadmin.se/traningsplanering/) | Klubbar som redan kör SportAdmin – och hagundaif.se är byggd i SportAdmin | Tilläggsmodul som kostar ca 499 kr/mån, och styrs av klubben centralt snarare än av er grupp |
| [Friidrottens övningsbank](https://kunskapsarenan.se/friidrott/friidrottens-ovningsbank) (Svensk Friidrott) | Att hämta *innehåll* – övningar och videor per gren och åldersgrupp | Är en övningsbank, inte ett verktyg för att sätta ihop och skriva ut ett pass. Utmärkt att länka till från blocken |
| [Sportlink](https://sportlink.se/) | Övningsbibliotek och övningsbyggare, gratis | Täcker fotboll, innebandy och handboll – inte friidrott |
| Decap CMS / Sveltia CMS ovanpå GitHub Pages | Redigering av statiska sajter med versionshistorik | Kräver att varje ledare har ett eget GitHub-konto. Ni ville ha enkla konton med förnamn |
| Google Docs eller en delad PDF | Snabbaste tänkbara start | Ingen struktur per block, ingen kontroll på sidantalet, och versionshistoriken ligger utanför er kontroll |

**Rekommendation:** kör den här appen för själva passet och länka till
Friidrottens övningsbank inifrån blocken när ni vill ha övningsförslag. Om
klubben ändå betalar för SportAdmin Träningsplanering är det värt att titta
på det – men det ger inte tresidorsunderlaget.
