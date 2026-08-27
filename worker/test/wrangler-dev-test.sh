set -e
# Körs mot `wrangler dev` (riktig workerd-runtime) på port 8787.
# Kräver: node test/fejk-github.mjs på :9099, wrangler dev startad med
# GITHUB_API=http://127.0.0.1:9099 i .dev.vars. Testar med standardläget
# (KRAV_LOSENORDSBYTE=0) från wrangler.toml – login med startlösenord ska
# alltså gå rakt igenom till att spara.
B=http://localhost:8787
ok(){ printf "  OK   %s\n" "$1"; }
fel(){ printf "  FEL  %s\n" "$1"; MISS=$((MISS+1)); }
MISS=0

curl -sS $B/status -o /dev/null -w "" || { echo "Workern svarar inte på $B"; exit 1; }

TOK=$(curl -sS -X POST $B/login -H 'Content-Type: application/json' -d '{"anvandarnamn":"tommy","losenord":"tommy"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOK"

PFIL=$(mktemp); curl -sS $B/pass/lopning > "$PFIL"
python3 -c "import json;d=json.load(open('$PFIL'));assert d['data']['moment'] and d['sha']" \
  && ok "hämtar pass från riktig workerd-runtime" || fel "hämta pass"
SHA=$(python3 -c "import json;print(json.load(open('$PFIL'))['sha'])")

NYFIL=$(mktemp)
python3 - "$PFIL" "$SHA" "$NYFIL" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))['data']
p['namn'] = 'Sparat via wrangler dev'
json.dump({"data": p, "meddelande": "wrangler-dev-test", "sha": sys.argv[2]}, open(sys.argv[3], 'w'), ensure_ascii=False)
PY
R=$(curl -sS -X PUT $B/pass/lopning -H "$AUTH" -H 'Content-Type: application/json' --data-binary "@$NYFIL")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['ok'] and d['data']['uppdateradAv']=='tommy'" \
  && ok "PBKDF2/JWT/KV fungerar tillsammans i riktig runtime" || fel "spara: $R"

# uppladdning med riktig FormData/File (workerd, inte Node-polyfill)
PNGFIL=$(mktemp --suffix=.png)
printf '\x89PNG\r\n\x1a\n' > "$PNGFIL"
U=$(curl -sS -X POST $B/upload -H "$AUTH" -F "fil=@$PNGFIL;type=image/png;filename=Ödla.png")
echo "$U" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['typ']=='bild', d
assert d['namn']=='Ödla.png', d
" && ok "uppladdning med åäö i filnamnet (riktig workerd-formData)" || fel "uppladdning: $U"

curl -sS "$B/status" | python3 -c "import sys,json;d=json.load(sys.stdin);assert 'ledare' not in d" \
  && ok "publik status läcker inte namn" || fel "status läcker"

echo "misslyckade: $MISS"
