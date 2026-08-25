set -e
# Verifierar standardläget: KRAV_LOSENORDSBYTE=0 (eller osatt). Ledare ska
# kunna redigera direkt med kontonamnet som lösenord, utan att tvingas byta.
B=http://127.0.0.1:8093/api
ok(){ printf "  OK   %s\n" "$1"; }
fel(){ printf "  FEL  %s\n" "$1"; MISS=$((MISS+1)); }
MISS=0

R=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"Anna","losenord":"Anna"}')
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['maste_byta_losenord'] is True, d
assert d['krav_losenordsbyte'] is False, d
" && ok "inloggning med startlösenord lyckas, kravet är avstängt" || fel "inloggning"
TOK=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"

PFIL=$(mktemp); curl -sS $B/pass > "$PFIL"
SHA=$(python3 -c "import json;print(json.load(open('$PFIL'))['sha'])")
NYFIL=$(mktemp)
python3 - "$PFIL" "$SHA" "$NYFIL" <<'PY'
import json, sys
kalla, sha, ut = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(kalla))['pass']
p['pass'][0]['samling'] = 'Ändrat utan lösenordsbyte'
json.dump({"pass": p, "meddelande": "test", "sha": sha}, open(ut, 'w'), ensure_ascii=False)
PY
K=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT $B/pass -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
[ "$K" = "200" ] && ok "redigering fungerar direkt med startlösenordet" || fel "redigering gav $K"

echo "misslyckade: $MISS"
