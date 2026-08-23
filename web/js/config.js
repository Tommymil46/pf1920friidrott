/* ===========================================================
   Konfiguration – ändra här, inget bygge behövs.
   =========================================================== */
window.PASS_CONFIG = {
  /* Adress till ledar-API:t (Docker-tjänsten på hallenskog).
     Lämna tomt ("") så fungerar sidan som ren läs-sida utan inloggning.
     Exempel: "https://hallenskog.dinadress.se/api"  */
  apiBase: "",

  /* Var det statiska innehållet ligger (publicerat via GitHub Pages). */
  contentUrl: "content/pass.json",

  /* Arkivet med genomförda pass. */
  arkivUrl: "content/arkiv/index.json",
  arkivBas: "content/arkiv/",

  /* Hur många A4-sidor utskriften får bli. */
  maxSidor: 3,

  /* Klubb/grupp – visas i sidhuvudet. */
  klubb: "Hagunda IF · Friidrott"
};
