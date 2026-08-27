set -e
B=http://127.0.0.1:8096/api
ok(){ printf "  OK   %s\n" "$1"; }
fel(){ printf "  FEL  %s\n" "$1"; MISS=$((MISS+1)); }
MISS=0

TOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Ludvig","losenord":"Ludvig"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"

# 0. Startlösenordet får inte räcka för att ändra något
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' -d '{"data":{"id":"lopning","moment":[]},"meddelande":"x"}')
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

# 1. hämta index
K=$(curl -sS -o /dev/null -w "%{http_code}" $B/index)
[ "$K" = "200" ] && ok "hämtar index" || fel "hämta index gav $K"

# 2. hämta löpningspasset
PFIL=$(mktemp); curl -sS $B/pass/lopning > "$PFIL"
python3 -c "
import json
d=json.load(open('$PFIL'))
assert len(d['data']['moment'])==4 and d['sha']
" && ok "hämtar löpningspasset + sha" || fel "hämta pass"
SHA=$(python3 -c "import json;print(json.load(open('$PFIL'))['sha'])")

# 3. spara utan inloggning
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/lopning -H 'Content-Type: application/json' -d '{"data":{"id":"lopning","moment":[]}}')
[ "$K" = "401" ] && ok "sparning kräver inloggning" || fel "sparning utan inloggning gav $K"

# 4. spara med inloggning
NYFIL=$(mktemp)
python3 - "$PFIL" "$SHA" "$NYFIL" <<'ANDRA'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['data']
p['moment'][0]['text'] = 'Loepskolning och spurter (test)'
json.dump({"data": p, "meddelande": "Uppdaterade loepmomentet", "sha": sha},
          open(ut, 'w'), ensure_ascii=False)
ANDRA
R=$(curl -sS -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['ok'];assert d['data']['uppdateradAv']=='Ludvig'" && ok "spara som ledare, uppdateradAv sätts" || fel "spara"
NYSHA=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")

# 5. konflikt: spara med gammal sha
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
[ "$K" = "409" ] && ok "konflikt upptäcks när två ledare sparar" || fel "konflikt gav $K"

# 6. passets id måste matcha adressen
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/okant-id -H "$AUTH" -H 'Content-Type: application/json' -d "{\"data\":{\"id\":\"lopning\",\"moment\":[{\"namn\":\"a\"},{\"namn\":\"b\"},{\"namn\":\"c\"},{\"namn\":\"d\"}]},\"meddelande\":\"fel id\",\"sha\":\"$NYSHA\"}")
[ "$K" = "400" ] && ok "passets id måste matcha adressen" || fel "fel-id gav $K"

# 7. historik, per pass
H=$(curl -sS $B/historik/pass/lopning -H "$AUTH")
echo "$H" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==2, h
assert h[0]['vem']=='Ludvig', h[0]
assert h[0]['meddelande'].startswith('Uppdaterade loepmomentet'), h[0]
" && ok "historiken visar vem och vad" || fel "historik"

GAMMAL=$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)[1]['sha'])")

# 8. återställa
curl -sS -X POST $B/aterstall -H "$AUTH" -H 'Content-Type: application/json' -d "{\"target\":\"pass/lopning\",\"sha\":\"$GAMMAL\"}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['data']['moment'][0]['text']!='Loepskolning och spurter (test)';assert d['data']['uppdateradAv']=='Ludvig'" \
  && ok "återställning till tidigare version" || fel "återställning"

# 9. inget har försvunnit: historiken har växt, inte krympt
curl -sS $B/historik/pass/lopning -H "$AUTH" | python3 -c "
import sys,json
h=json.load(sys.stdin)
assert len(h)==3, len(h)
assert 'Återställde' in h[0]['meddelande']
assert h[1]['meddelande'].startswith('Uppdaterade loepmomentet')
" && ok "inget försvinner – historiken växer" || fel "historikbevarande"

# 10. ett annat pass rörs inte av löpningens historik/återställning
curl -sS $B/pass/rorelse | python3 -c "
import sys,json;assert json.load(sys.stdin)['data']['namn']=='Rörelse'
" && ok "rörelsepasset är opåverkat" || fel "rörelsepasset ändrades"

# 11. index sparas separat: sätt aktivt pass
IFIL=$(mktemp); curl -sS $B/index > "$IFIL"
ISHA=$(python3 -c "import json;print(json.load(open('$IFIL'))['sha'])")
INYFIL=$(mktemp)
python3 - "$IFIL" "$ISHA" "$INYFIL" <<'IDX'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(kalla))['data']
d['aktivt'] = 'rorelse'
json.dump({"data": d, "meddelande": "Satte Rörelse som aktuellt", "sha": sha}, open(ut, 'w'), ensure_ascii=False)
IDX
curl -sS -X PUT $B/index -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$INYFIL" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['data']['aktivt']=='rorelse'" \
  && ok "index sparas separat från passen" || fel "index-sparning"

curl -sS $B/historik/index -H "$AUTH" | python3 -c "
import sys,json;assert len(json.load(sys.stdin))>=2
" && ok "indexet har sin egen historik" || fel "index-historik"

# 12. lekbanken sparas separat
LFIL=$(mktemp); curl -sS $B/lekar > "$LFIL"
python3 -c "
import json
d=json.load(open('$LFIL'))
assert isinstance(d['data']['lekar'], list) and d['sha']
" && ok "hämtar lekbanken + sha" || fel "hämta lekbanken"
LSHA=$(python3 -c "import json;print(json.load(open('$LFIL'))['sha'])")
LNYFIL=$(mktemp)
python3 - "$LFIL" "$LSHA" "$LNYFIL" <<'LEK'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(kalla))['data']
d['lekar'].append({"id": "test-lek", "namn": "Testlek", "ikon": "", "text": "", "bilder": [], "filer": []})
json.dump({"data": d, "meddelande": "Lade till en lek", "sha": sha}, open(ut, 'w'), ensure_ascii=False)
LEK
curl -sS -X PUT $B/lekar -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$LNYFIL" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert any(l['id']=='test-lek' for l in d['data']['lekar'])
" && ok "lekbanken sparas separat" || fel "lekbanken sparning"

curl -sS $B/historik/lekar -H "$AUTH" | python3 -c "
import sys,json;assert len(json.load(sys.stdin))>=1
" && ok "lekbanken har sin egen historik" || fel "lekbankshistorik"

# 13. uppladdning: bild
printf '\x89PNG\r\n\x1a\n0123456789' > /tmp/testbild.png
U=$(curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/testbild.png;type=image/png")
echo "$U" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['typ']=='bild';assert d['url'].startswith('content/uploads/');assert d['url'].endswith('.png')" && ok "bilduppladdning committas" || fel "bilduppladdning: $U"
FILURL=$(echo "$U" | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")
K=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:8096/api/filer/$(basename $FILURL)")
[ "$K" = "200" ] && ok "uppladdad fil nås direkt via API:t" || fel "filhämtning gav $K"

# 14. uppladdning: pdf
printf '%%PDF-1.4 test' > /tmp/testfil.pdf
curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/testfil.pdf;type=application/pdf" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['typ']=='pdf'" && ok "PDF-uppladdning" || fel "PDF-uppladdning"

# 15. otillåten filtyp
printf 'MZ' > /tmp/ond.exe
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/ond.exe;type=application/x-msdownload")
[ "$K" = "415" ] && ok "otillåten filtyp stoppas" || fel "filtyp gav $K"

# 16. uppladdning utan inloggning
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/upload -F "fil=@/tmp/testbild.png;type=image/png")
[ "$K" = "401" ] && ok "uppladdning kräver inloggning" || fel "uppladdning utan inloggning gav $K"

# 17. filnamn saneras
printf '\x89PNG\r\n\x1a\n' > "/tmp/Ödla & Räv (1).png"
curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@/tmp/Ödla & Räv (1).png;type=image/png" \
  | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
namn=d['url'].split('/')[-1]
assert re.fullmatch(r'[A-Za-z0-9._-]+', namn), namn
assert d['namn']=='Ödla & Räv (1).png', d['namn']
" && ok "filnamn saneras, originalnamnet behålls" || fel "filnamnssanering"

# 18. spärr efter många felinloggningar
for i in $(seq 1 11); do curl -sS -o /dev/null -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Anna","losenord":"fel"}'; done
K=$(curl -sS -o /dev/null -w "%{http_code}" -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Anna","losenord":"Anna"}')
[ "$K" = "429" ] && ok "spärr mot lösenordsgissning" || fel "spärr gav $K"

# 19. arkivering
curl -sS -X POST $B/arkivera -H "$AUTH" -H 'Content-Type: application/json' -d '{"passId":"lopning"}' | python3 -c "
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
import sys,json;d=json.load(sys.stdin);assert d['pass']['moment']
" && ok "arkiverat pass går att läsa" || fel "läsa arkiverat pass"

# 20. sökvägsflykt i arkivet
for BAD in "../pass.json" "..%2f..%2fpass.json" "index.json"; do
  K=$(curl -sS -o /dev/null -w "%{http_code}" "$B/arkiv/$BAD")
  case "$K" in 400|404) ;; *) fel "arkiv/$BAD gav $K";; esac
done
ok "sökvägsflykt i arkivet avvisas"

# 21. innehållsgranskning: farliga adresser sparas inte
BADFIL=$(mktemp)
python3 - "$PFIL" "$NYSHA" "$BADFIL" <<'GRANSKA'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['data']
p['moment'][0]['bilder'] = [
    {"url": "javascript:alert(1)", "bildtext": "ond"},
    {"url": "https://exempel.se/ok.png", "bildtext": "ok"},
    {"url": "content/uploads/bra.png", "bildtext": "ok"},
]
json.dump({"data": p, "meddelande": "test"}, open(ut, 'w'), ensure_ascii=False)
GRANSKA
GSHA=$(curl -sS $B/pass/lopning | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")
python3 -c "
import json
d = json.load(open('$BADFIL'))
d['sha'] = '$GSHA'
json.dump(d, open('$BADFIL', 'w'), ensure_ascii=False)
"
curl -sS -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$BADFIL" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
urler=[b['url'] for b in d['data']['moment'][0]['bilder']]
assert 'javascript:alert(1)' not in urler, urler
assert len(urler)==2, urler
" && ok "javascript:-adress filtreras bort på servern" || fel "adressgranskning"

# 22. för långt innehåll avvisas
LONGFIL=$(mktemp)
GSHA2=$(curl -sS $B/pass/lopning | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")
python3 - "$PFIL" "$GSHA2" "$LONGFIL" <<'LANGT'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['data']
p['moment'][0]['text'] = 'x' * 40000
json.dump({"data": p, "meddelande": "test", "sha": sha}, open(ut, 'w'), ensure_ascii=False)
LANGT
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$LONGFIL")
[ "$K" = "400" ] && ok "för långt momentinnehåll avvisas" || fel "längdgräns gav $K"

# 23. färre än fyra moment avvisas
FAFIL=$(mktemp)
GSHA3=$(curl -sS $B/pass/lopning | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")
python3 - "$PFIL" "$GSHA3" "$FAFIL" <<'FAMOMENT'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['data']
p['moment'] = p['moment'][:2]
json.dump({"data": p, "meddelande": "test", "sha": sha}, open(ut, 'w'), ensure_ascii=False)
FAMOMENT
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$FAFIL")
[ "$K" = "400" ] && ok "färre än fyra moment avvisas" || fel "för få moment gav $K"

# 24. lösenordsbyte ger ny session och dödar alla andra
ANNANTOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' \
  -d '{"anvandarnamn":"Ludvig","losenord":"ettLangtLosenord1"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
NYTOK=$(curl -sS -X POST $B/losenord -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"gammalt":"ettLangtLosenord1","nytt":"annatLangtLosen2"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -n "$NYTOK" ] && ok "lösenordsbyte ger en ny session direkt" || fel "ingen ny token"
K=$(curl -sS -o /dev/null -w "%{http_code}" $B/historik/pass/lopning -H "Authorization: Bearer $ANNANTOK")
[ "$K" = "401" ] && ok "andra sessioner slutar gälla vid lösenordsbyte" || fel "annan session gav $K"
K=$(curl -sS -o /dev/null -w "%{http_code}" $B/historik/pass/lopning -H "Authorization: Bearer $NYTOK")
[ "$K" = "200" ] && ok "den nya sessionen fungerar" || fel "ny session gav $K"

echo "misslyckade: $MISS"
