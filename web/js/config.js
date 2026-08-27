/* ===========================================================
   Konfiguration – ändra här, inget bygge behövs.
   =========================================================== */
window.PASS_CONFIG = {
  /* Adress till ledar-API:t (Docker-tjänsten på hallenskog).
     Lämna tomt ("") så fungerar sidan som ren läs-sida utan inloggning.
     Exempel: "https://hallenskog.dinadress.se/api"  */
  apiBase: "https://pf1920-ledartjanst.pf1920-ledartjanst.workers.dev",

  /* Träningspassen (content/index.json + content/pass/<id>.json) och
     lekbanken (content/lekar.json) ligger på fasta sökvägar under
     content/, ingen egen konfiguration behövs för dem. */

  /* Arkivet med genomförda pass. */
  arkivUrl: "content/arkiv/index.json",
  arkivBas: "content/arkiv/",

  /* Hur många A4-sidor utskriften får bli. */
  maxSidor: 3,

  /* Klubb/grupp – visas i sidhuvudet. */
  klubb: "Hagunda IF · Friidrott"
};
