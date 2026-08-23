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

## Steg 10: slå på GitHub Pages (T)

Repots **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Sidan hamnar då på `https://tommymil46.github.io/pf1920friidrott/`.
Säg till när adressen är uppe, så pekar jag om det som behöver ändras.

## Steg 11: skapa en GitHub-token (T)

Fine-grained token med **Contents: Read and write** enbart på det här repot.
Steg för steg i [DRIFT.md](DRIFT.md). Tokenen ska **bara** in i
`server/.env` på hallenskog – klistra aldrig in den i en chatt eller i repot.

## Steg 12: starta tjänsten (T)

```bash
git clone https://github.com/Tommymil46/pf1920friidrott.git
cd pf1920friidrott
cp server/.env.example server/.env      # fyll i token + JWT_SECRET
docker compose -f server/docker-compose.yml up -d --build
curl http://localhost:8080/api/status
```

## Steg 13: gör tjänsten nåbar för ledarna (T, jag hjälper till)

Välj VPN (WireGuard/Tailscale) eller en publik HTTPS-proxy – jämförelse i
[DRIFT.md](DRIFT.md). Berätta vilket du väljer så skriver jag konfigurationen.

## Steg 14: peka appen mot tjänsten (C)

När adressen är klar sätter jag `apiBase` i `web/js/config.js` och
`ALLOWED_ORIGINS` i `.env.example`.

## Steg 15: fyll passet med riktigt innehåll (T + ledarna)

Logga in, byt lösenord, skriv in nästa pass. Innehållet som ligger där nu är
exempel som är tänkta att skrivas över.

## Steg 16: provtryck (T)

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

### Om hallenskog: du har rätt i att fundera

Att öppna hallenskog mot internet är den enda delen av lösningen som utsätter
något av ditt eget för risk. Jag har härdat containern så långt det går – se
[SAKERHET.md](SAKERHET.md) – men den bästa lösningen är att inte behöva öppna
hallenskog alls. Tre vägar:

| Väg | Vad som krävs | För- och nackdelar |
|---|---|---|
| **A. Ingen egen server** – ledartjänsten flyttar till Cloudflare Workers eller Deno Deploy | Jag skriver om `server/` till en Worker (samma API, samma frontend). Du klistrar in GitHub-tokenen som en hemlighet hos dem | Gratis, inget hemma som exponeras, HTTPS ingår, inget att uppdatera. **Min rekommendation** |
| **B. Supabase för inloggningen** + en liten funktion som committar | Konto hos Supabase; ledarna får riktiga konton med lösenordsåterställning via mejl | Snyggare kontohantering, men två tjänster att hålla reda på i stället för en. Överdrivet för fem ledare |
| **C. Hallenskog, men bara via VPN** | WireGuard eller Tailscale hem | Inget öppnas mot internet alls. Ledarna kan bara redigera hemifrån eller via VPN. Sidan är fortfarande öppen att läsa för alla |

Väg A och C är båda bra. Säg vilken du vill ha, så bygger jag den – väg A tar
mig ungefär en arbetsomgång, väg C är bara konfiguration.

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
