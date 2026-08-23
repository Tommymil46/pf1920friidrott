set -e
B=http://127.0.0.1:8096/api
ok(){ printf "  OK   %s\n" "$1"; }
fel(){ printf "  FEL  %s\n" "$1"; MISS=$((MISS+1)); }
MISS=0

TOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Ludvig","losenord":"Ludvig"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"

# 1. hämta pass
P=$(curl -sS $B/pass)
echo "$P" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['pass']['titel']=='Start';assert d['sha']" && ok "hämtar pass + sha" || fel "hämta pass"
SHA=$(echo "$P" | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")

# 2. spara utan inloggning
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H 'Content-Type: application/json' -d '{"pass":{"block":[]}}')
[ "$K" = "401" ] && ok "sparning kräver inloggning" || fel "sparning utan inloggning gav $K"

# 3. spara med inloggning
NY=$(python3 - <<PY
import json
p=json.loads('''$P''')['pass']
p['titel']='Pass 26 augusti'
p['block'][0]['text']='Löpskolning och spurter'
print(json.dumps({"pass":p,"meddelande":"Uppdaterade löpblocket","sha":"$SHA"}))
PY
)
R=$(curl -sS -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' -d "$NY")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['ok'];assert d['pass']['uppdateradAv']=='Ludvig'" && ok "spara som ledare, uppdateradAv sätts" || fel "spara"
NYSHA=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")

# 4. konflikt: spara med gammal sha
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' -d "$NY")
[ "$K" = "409" ] && ok "konflikt upptäcks när två ledare sparar" || fel "konflikt gav $K"

# 5. historik
H=$(curl -sS $B/historik -H "$AUTH")
echo "$H" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==2, h
assert h[0]['vem']=='Ludvig', h[0]
assert 'Uppdaterade löpblocket (Ludvig)'==h[0]['meddelande'], h[0]
" && ok "historiken visar vem och vad" || fel "historik"

GAMMAL=$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)[1]['sha'])")

# 6. läsa gammal version
curl -sS $B/historik/$GAMMAL -H "$AUTH" | python3 -c "import sys,json;assert json.load(sys.stdin)['pass']['titel']=='Start'" && ok "kan läsa tidigare version" || fel "läsa version"

# 7. återställa
curl -sS -X POST $B/aterstall -H "$AUTH" -H 'Content-Type: application/json' -d "{\"sha\":\"$GAMMAL\"}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['pass']['titel']=='Start';assert d['pass']['uppdateradAv']=='Ludvig'" \
  && ok "återställning till tidigare version" || fel "återställning"

# 8. inget har försvunnit: historiken har växt, inte krympt
curl -sS $B/historik -H "$AUTH" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==3, len(h)
assert 'Återställde' in h[0]['meddelande']
assert h[1]['meddelande'].startswith('Uppdaterade löpblocket')
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

echo "misslyckade: $MISS"
