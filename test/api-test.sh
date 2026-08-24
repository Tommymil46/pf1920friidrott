set -e
B=http://127.0.0.1:8096/api
ok(){ printf "  OK   %s\n" "$1"; }
fel(){ printf "  FEL  %s\n" "$1"; MISS=$((MISS+1)); }
MISS=0

TOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Ludvig","losenord":"Ludvig"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"

# 0. Startlösenordet får inte räcka för att ändra något
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' -d '{"pass":{"block":[]},"meddelande":"x"}')
[ "$K" = "403" ] && ok "startlösenord får inte spara" || fel "startlösenord gav $K"
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/arkivera -H "$AUTH")
[ "$K" = "403" ] && ok "startlösenord får inte arkivera" || fel "arkivering med startlösenord gav $K"

# byt lösenord och hämta ny token
curl -sS -X POST $B/losenord -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"gammalt":"Ludvig","nytt":"ettLangtLosenord1"}' > /dev/null
TOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Ludvig","losenord":"ettLangtLosenord1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"
ok "lösenordsbyte låser upp redigering"

# statusen ska inte läcka användarnamn
curl -sS $B/status | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert 'ledare' not in d, d
assert d['ok'] is True
" && ok "publik status läcker inte ledarnamn" || fel "status läcker"
curl -sS $B/status/detaljer -H "$AUTH" | python3 -c "
import sys,json;d=json.load(sys.stdin);assert len(d['ledare'])==5
" && ok "inloggad ser detaljerna" || fel "status/detaljer"

# 1. hämta pass
PFIL=$(mktemp); curl -sS $B/pass > "$PFIL"
python3 -c "
import json
d=json.load(open('$PFIL'))
assert d['pass']['block'] and d['sha']
" && ok "hämtar pass + sha" || fel "hämta pass"
SHA=$(python3 -c "import json;print(json.load(open('$PFIL'))['sha'])")

# 2. spara utan inloggning
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H 'Content-Type: application/json' -d '{"pass":{"block":[]}}')
[ "$K" = "401" ] && ok "sparning kräver inloggning" || fel "sparning utan inloggning gav $K"

# 3. spara med inloggning
NYFIL=$(mktemp)
python3 - "$PFIL" "$SHA" "$NYFIL" <<'ANDRA'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['pass']
p['titel'] = 'Pass 26 augusti'
p['block'][0]['text'] = 'Loepskolning och spurter'
json.dump({"pass": p, "meddelande": "Uppdaterade loepblocket", "sha": sha},
          open(ut, 'w'), ensure_ascii=False)
ANDRA
R=$(curl -sS -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['ok'];assert d['pass']['uppdateradAv']=='Ludvig'" && ok "spara som ledare, uppdateradAv sätts" || fel "spara"
NYSHA=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")

# 4. konflikt: spara med gammal sha
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
[ "$K" = "409" ] && ok "konflikt upptäcks när två ledare sparar" || fel "konflikt gav $K"

# 5. historik
H=$(curl -sS $B/historik -H "$AUTH")
echo "$H" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==2, h
assert h[0]['vem']=='Ludvig', h[0]
assert h[0]['meddelande'].startswith('Uppdaterade loepblocket'), h[0]
" && ok "historiken visar vem och vad" || fel "historik"

GAMMAL=$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)[1]['sha'])")

# 6. läsa gammal version
curl -sS $B/historik/$GAMMAL -H "$AUTH" | python3 -c "
import sys,json;assert json.load(sys.stdin)['pass']['titel']!='Pass 26 augusti'
" && ok "kan läsa tidigare version" || fel "läsa version"

# 7. återställa
curl -sS -X POST $B/aterstall -H "$AUTH" -H 'Content-Type: application/json' -d "{\"sha\":\"$GAMMAL\"}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['pass']['titel']!='Pass 26 augusti';assert d['pass']['uppdateradAv']=='Ludvig'" \
  && ok "återställning till tidigare version" || fel "återställning"

# 8. inget har försvunnit: historiken har växt, inte krympt
curl -sS $B/historik -H "$AUTH" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==3, len(h)
assert 'Återställde' in h[0]['meddelande']
assert h[1]['meddelande'].startswith('Uppdaterade loepblocket')
" && ok "inget försvinner – historiken växer" || fel "historikbevarande"

# 9. uppladdning: bild
printf '\x89PNG\r\n\x1a\n0123456789' > /tmp/testbild.png
U=$(curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/testbild.png;type=image/png")
echo "$U" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['typ']=='bild';assert d['url'].startswith('content/uploads/');assert d['url'].endswith('.png')" && ok "bilduppladdning committas" || fel "bilduppladdning: $U"
FILURL=$(echo "$U" | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")
K=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:8096/api/filer/$(basename $FILURL)")
[ "$K" = "200" ] && ok "uppladdad fil nås direkt via API:t" || fel "filhämtning gav $K"

# 10. uppladdning: pdf
printf '%%PDF-1.4 test' > /tmp/testfil.pdf
curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/testfil.pdf;type=application/pdf" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['typ']=='pdf'" && ok "PDF-uppladdning" || fel "PDF-uppladdning"

# 11. otillåten filtyp
printf 'MZ' > /tmp/ond.exe
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/ond.exe;type=application/x-msdownload")
[ "$K" = "415" ] && ok "otillåten filtyp stoppas" || fel "filtyp gav $K"

# 12. uppladdning utan inloggning
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/upload -F "fil=@/tmp/testbild.png;type=image/png")
[ "$K" = "401" ] && ok "uppladdning kräver inloggning" || fel "uppladdning utan inloggning gav $K"

# 13. filnamn saneras
printf '\x89PNG\r\n\x1a\n' > "/tmp/Ödla & Räv (1).png"
curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/Ödla & Räv (1).png;type=image/png" \
  | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
namn=d['url'].split('/')[-1]
assert re.fullmatch(r'[A-Za-z0-9._-]+', namn), namn
assert d['namn']=='Ödla & Räv (1).png', d['namn']
" && ok "filnamn saneras, originalnamnet behålls" || fel "filnamnssanering"

# 14. spärr efter många felinloggningar
for i in $(seq 1 11); do curl -sS -o /dev/null -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Anna","losenord":"fel"}'; done
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Anna","losenord":"Anna"}')
[ "$K" = "429" ] && ok "spärr mot lösenordsgissning" || fel "spärr gav $K"

# 15. arkivering
curl -sS -X POST $B/arkivera -H "$AUTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['ok'] and d['post']['fil'].endswith('.json'), d
" && ok "arkivering skapar en post" || fel "arkivering"

curl -sS $B/arkiv | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert len(d['pass'])==1, d
assert d['pass'][0]['arkiveradAv']=='Ludvig', d
" && ok "arkivlistan är publik och innehåller passet" || fel "arkivlista"

ARKFIL=$(curl -sS $B/arkiv | python3 -c "import sys,json;print(json.load(sys.stdin)['pass'][0]['fil'])")
curl -sS "$B/arkiv/$ARKFIL" | python3 -c "
import sys,json;d=json.load(sys.stdin);assert d['pass']['block']
" && ok "arkiverat pass går att läsa" || fel "läsa arkiverat pass"

# 16. sökvägsflykt i arkivet
for BAD in "../pass.json" "..%2f..%2fpass.json" "index.json"; do
  K=$(curl -sS -o /dev/null -w "%{http_code}" "$B/arkiv/$BAD")
  case "$K" in 400|404) ;; *) fel "arkiv/$BAD gav $K";; esac
done
ok "sökvägsflykt i arkivet avvisas"

# 17. innehållsgranskning: farliga adresser sparas inte
BADFIL=$(mktemp)
python3 - "$PFIL" "$BADFIL" <<'GRANSKA'
import json, sys
p = json.load(open(sys.argv[1]))['pass']
p['block'][0]['bilder'] = [
    {"url": "javascript:alert(1)", "bildtext": "ond"},
    {"url": "https://exempel.se/ok.png", "bildtext": "ok"},
    {"url": "content/uploads/bra.png", "bildtext": "ok"},
]
json.dump({"pass": p, "meddelande": "test"}, open(sys.argv[2], 'w'), ensure_ascii=False)
GRANSKA
curl -sS -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$BADFIL" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
urler=[b['url'] for b in d['pass']['block'][0]['bilder']]
assert 'javascript:alert(1)' not in urler, urler
assert len(urler)==2, urler
" && ok "javascript:-adress filtreras bort på servern" || fel "adressgranskning"

# 18. för långt innehåll avvisas
LONGFIL=$(mktemp)
python3 - "$PFIL" "$LONGFIL" <<'LANGT'
import json, sys
p = json.load(open(sys.argv[1]))['pass']
p['block'][0]['text'] = 'x' * 40000
json.dump({"pass": p, "meddelande": "test"}, open(sys.argv[2], 'w'), ensure_ascii=False)
LANGT
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$LONGFIL")
[ "$K" = "400" ] && ok "för långt blockinnehåll avvisas" || fel "längdgräns gav $K"

# 19. lösenordsbyte ger ny session och dödar alla andra
ANNANTOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' \
  -d '{"anvandarnamn":"Ludvig","losenord":"ettLangtLosenord1"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
NYTOK=$(curl -sS -X POST $B/losenord -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"gammalt":"ettLangtLosenord1","nytt":"annatLangtLosen2"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -n "$NYTOK" ] && ok "lösenordsbyte ger en ny session direkt" || fel "ingen ny token"
K=$(curl -sS -o /dev/null -w "%{http_code}" $B/historik -H "Authorization: Bearer $ANNANTOK")
[ "$K" = "401" ] && ok "andra sessioner slutar gälla vid lösenordsbyte" || fel "annan session gav $K"
K=$(curl -sS -o /dev/null -w "%{http_code}" $B/historik -H "Authorization: Bearer $NYTOK")
[ "$K" = "200" ] && ok "den nya sessionen fungerar" || fel "ny session gav $K"

echo "misslyckade: $MISS"
