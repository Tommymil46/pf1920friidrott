# Plan – vem gör vad

**C** = Claude (jag), **T** = Tommy (du). Status per 2026-08-23.

## Steg 1–7: klart ✅ (C)

| # | Steg | Vem | Status |
|---|---|---|---|
| 1 | Tema efter hagundaif.se – klubbfärgerna blå `#293589` och gul `#EFD73A`, Roboto Condensed i rubriker, Open Sans i brödtext | C | ✅ |
| 2 | Förstasidan "Aktuellt träningspass" med de fem blocken löpning, rörelse, kast, höjd och längd | C | ✅ |
| 3 | Inloggningsknapp högst upp + konton för Anna, Eric, Johan, Ludvig, tommy (lösenord = kontonamnet, tvingas byta) | C | ✅ |
| 4 | Redigering: text, bilder, PDF, nya block, ändra ordning, ta bort | C | ✅ |
| 5 | Ändringshantering i GitHub – varje sparning blir en commit, historik och återställning direkt i appen | C | ✅ |
| 6 | Utskrift på max 3 A4-sidor, med mätning av verkligt antal sidor och ett kompakt läge | C | ✅ |
| 7 | Ledartjänst i Docker för hallenskog + arbetsflöde som publicerar sajten på GitHub Pages | C | ✅ |

## Steg 8: slå på GitHub Pages (T)

Repots **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Sidan hamnar då på `https://tommymil46.github.io/pf1920friidrott/`.
Säg till när adressen är uppe, så pekar jag om det som behöver ändras.

## Steg 9: skapa en GitHub-token (T)

Fine-grained token med **Contents: Read and write** enbart på det här repot.
Steg för steg i [DRIFT.md](DRIFT.md). Tokenen ska **bara** in i
`server/.env` på hallenskog – klistra aldrig in den i en chatt eller i repot.

## Steg 10: starta tjänsten på hallenskog (T)

```bash
git clone https://github.com/Tommymil46/pf1920friidrott.git
cd pf1920friidrott
cp server/.env.example server/.env      # fyll i token + JWT_SECRET
docker compose -f server/docker-compose.yml up -d --build
curl http://localhost:8080/api/status
```

## Steg 11: gör tjänsten nåbar för ledarna (T, jag hjälper till)

Välj VPN (WireGuard/Tailscale) eller en publik HTTPS-proxy – jämförelse i
[DRIFT.md](DRIFT.md). Berätta vilket du väljer så skriver jag konfigurationen.

## Steg 12: peka appen mot tjänsten (C)

När adressen är klar sätter jag `apiBase` i `web/js/config.js` och
`ALLOWED_ORIGINS` i `.env.example`.

## Steg 13: fyll passet med riktigt innehåll (T + ledarna)

Logga in, byt lösenord, skriv in nästa pass. Innehållet som ligger där nu är
exempel som är tänkta att skrivas över.

## Steg 14: provtryck (T)

Skriv ut ett riktigt pass och se att tre sidor räcker i praktiken. Hör av dig
om något ska vara tätare eller glesare.

---

## Sådant jag gärna bygger på – säg till vad du vill ha

* **Arkiv över tidigare pass** – i dag finns bara "aktuellt pass" plus
  historiken. Ett arkiv med alla genomförda pass är rakt fram att lägga till.
* **Övningsbank** som blocken kan hämta färdiga övningar ur.
* **Närvarolista** att pricka av på plats.
* **Kalender/nästa pass** så att föräldrar ser när det är träning.
* **Inloggning med engångslänk via mejl** i stället för lösenord.

## Frågor jag behöver svar på

1. **Ska sidan vara helt öppen?** Nu kan vem som helst läsa den (bara
   redigering kräver inloggning). Ska den vara lösenordsskyddad även för
   läsning behöver vi ta ett annat grepp än GitHub Pages.
2. **Bilder på barn?** Om ni tänker lägga upp foton på gruppen bör sidan inte
   vara öppen – se fråga 1.
3. **Är hallenskog nåbar utifrån**, eller ska redigering ske hemifrån/via VPN?
4. **Vill du ha arkiv över gamla pass** redan nu, eller räcker aktuellt pass?
5. **Ska GitHub Pages ligga under repots adress**, eller vill du ha ett eget
   domännamn?

---

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
