#!/usr/bin/env bash
#
# gen-test-batch.sh — build a real test batch CSV for the Visual Audit tool from
# the live Listex catalog API (api.listex.info).
#
# It picks N random products (each with at least one photo) by searching a spread
# of FMCG terms, then emits every photo of every chosen product as one CSV row in
# the 9-column batch contract (ADR-0003):
#
#   GoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId
#
# Notes on the mapping (the API has no per-photo id, GTIN lives in identified_by):
#   GoodId    <- result.good_id
#   Good_Name <- result.good_name
#   GTIN      <- result.identified_by[] gtin (trade-unit preferred), else image barcode
#   PhotoURI  <- good_images[].photo_url   (med-size URL; the app derives grid/med)
#   PhotoId   <- synthetic sequential integer (contract requires it numeric)
#   PhotoType <- good_images[].photo_type  (raw, e.g. default/facing-front/ecommerce)
#   PhotoDate <- good_images[].photo_date  (ISO timestamp truncated to yyyy-mm-dd)
#   Flagged   <- NO    (fresh batch)
#   UserId    <- blank (never reviewed)
#
# Usage:
#   LISTEX_API_KEY=xxxxxxxx ./gen-test-batch.sh [PRODUCT_COUNT] [OUTPUT_CSV]
#   ./gen-test-batch.sh                 # 60 products -> test-batch.csv, key read from .mcp.json
#   ./gen-test-batch.sh 100 big.csv     # 100 products -> big.csv
#
set -euo pipefail

# Keep node from ANSI-colorizing data it prints (the id/CSV streams must be plain).
export NO_COLOR=1 FORCE_COLOR=0

API="https://api.listex.info/v3"
TARGET="${1:-60}"
OUT="${2:-test-batch.csv}"
PID_BASE=900000   # starting synthetic PhotoId; increments per emitted photo

# --- API key: env var, else pull it out of the project's .mcp.json -------------
KEY="${LISTEX_API_KEY:-}"
if [ -z "$KEY" ] && [ -f "$(dirname "$0")/.mcp.json" ]; then
  KEY=$(node -e "try{process.stdout.write(require('$(dirname "$0")/.mcp.json').mcpServers['listex-catalog'].env.LISTEX_API_KEY||'')}catch(e){}" 2>/dev/null || true)
fi
if [ -z "$KEY" ]; then
  echo "error: no API key. Set LISTEX_API_KEY=... or add it to .mcp.json" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "error: node is required (used as a JSON parser)" >&2; exit 1; }

# Broad spread of FMCG search terms (RU/UA catalog) -> plenty of candidates.
TERMS=(
  молоко вода сок хлеб чай кофе пиво вино сыр масло шоколад печенье чипсы
  йогурт кефир сметана колбаса сосиски конфеты сахар мука рис макароны
  кетчуп майонез горчица соль крупа гречка овсянка мюсли орехи изюм
  лимонад квас минеральная энергетик сухарики крекер вафли зефир мармелад
  пельмени вареники мороженое творог сливки яйцо консервы тушенка паштет
  чипсы кола спрайт фанта нектар компот варенье джем мед пряники
)

TMP="${TMPDIR:-/tmp}/listex-batch.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
CAND="$TMP/candidates.txt"
HELPER="$TMP/parse.js"

# --- node helper: product JSON (stdin) + PhotoId base (argv) -> CSV rows --------
cat > "$HELPER" <<'JS'
const base = parseInt(process.argv[2], 10) || 0;
let s = '';
process.stdin.on('data', d => (s += d)).on('end', () => {
  let j; try { j = JSON.parse(s); } catch { process.exit(0); }
  const p = (j.result || [])[0];
  if (!p) process.exit(0);
  // GTIN must be present and all-digits (the contract strict-refuses otherwise).
  // Prefer the trade-unit barcode, then any identified_by gtin, then an image
  // barcode; if none qualifies, skip the whole product.
  const digit = v => (/^\d+$/.test(String(v == null ? '' : v)) ? String(v) : '');
  const ib = p.identified_by || [];
  const imgs = p.good_images || [];
  const tu = ib.find(x => x.type === 'gtin' && x.level === 'trade-unit');
  const any = ib.find(x => x.type === 'gtin');
  const bc = (imgs.find(im => digit(im.barcode)) || {}).barcode;
  const gtin = digit(tu && tu.value) || digit(any && any.value) || digit(bc);
  if (!gtin) process.exit(0);
  const q = v => {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const out = [];
  let i = 0;
  for (const im of imgs) {
    let url = im.photo_url;
    if (Array.isArray(url)) url = url.find(u => typeof u === 'string');
    if (typeof url !== 'string' || !url) continue;        // skip image-less / 3ds entries
    const date = String(im.photo_date || '').slice(0, 10);
    out.push([
      q(p.good_id), q(p.good_name || ''), q(gtin), q(url),
      q(base + i), q(im.photo_type || ''), q(date), 'NO', '',
    ].join(','));
    i++;
  }
  if (out.length) process.stdout.write(out.join('\n') + '\n');
});
JS

fetch_json() { # $1 = path, rest = repeated key=value query params (url-encoded)
  local path="$1"; shift
  local args=(-s -m 30 -G "$API/$path" --data-urlencode "apikey=$KEY")
  local kv
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  curl "${args[@]}"
}

# --- 1) gather candidate good_ids from suggestions -----------------------------
echo "Collecting candidates from ${#TERMS[@]} search terms..." >&2
: > "$CAND"
for term in "${TERMS[@]}"; do
  fetch_json suggestions "q=$term" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const r of (JSON.parse(s).result||[]))if(r.good_id!=null)process.stdout.write(r.good_id+"\n")}catch{}})' \
    >> "$CAND" || true
  sleep 0.15
done

# dedupe + shuffle (portable: no shuf/mapfile, works on macOS bash 3.2)
SHUF="$TMP/shuffled.txt"
sort -un "$CAND" | awk 'BEGIN{srand()}{print rand()"\t"$0}' | sort -k1,1n | cut -f2- > "$SHUF"
echo "Got $(grep -c '' < "$SHUF") unique candidate products." >&2

# --- 2) fetch each product, emit photo rows, stop at TARGET ---------------------
# Lead with a UTF-8 BOM so Excel decodes the Cyrillic correctly (the app's
# importer strips the BOM via stripBom, so it still round-trips).
printf '\xEF\xBB\xBFGoodId,Good_Name,GTIN,PhotoURI,PhotoId,PhotoType,PhotoDate,Flagged,UserId\n' > "$OUT"
products=0
rows_total=0
while IFS= read -r id; do
  [ "$products" -ge "$TARGET" ] && break
  [ -z "$id" ] && continue
  rows=$(fetch_json product "good_id=$id" | node "$HELPER" "$PID_BASE" || true)
  if [ -n "$rows" ]; then
    printf '%s\n' "$rows" >> "$OUT"
    n=$(printf '%s\n' "$rows" | grep -c '')
    PID_BASE=$((PID_BASE + n))
    rows_total=$((rows_total + n))
    products=$((products + 1))
    printf '\r  %d/%d products, %d photos' "$products" "$TARGET" "$rows_total" >&2
  fi
  sleep 0.12
done < "$SHUF"
echo >&2

if [ "$products" -lt "$TARGET" ]; then
  echo "warning: only found $products products with photos (wanted $TARGET); add more TERMS." >&2
fi
echo "Wrote $OUT — $products products, $rows_total photos." >&2
