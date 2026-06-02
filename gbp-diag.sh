#!/usr/bin/env bash
# GBP API diagnostic — bypasses broken Cloud Console pages entirely.
# Usage: TOKEN="ya29.xxx" bash gbp-diag.sh
# Output: writes to /tmp/gbp-diag.out which Claude can read.

set +e
OUT=/tmp/gbp-diag.out
PROJECT_ID=subtle-anthem-335321
ACCOUNT_PERSONAL=102569468649461978741
LOCATION_PELLICANO=12865670711812462040

if [ -z "$TOKEN" ]; then
  echo "ERROR: TOKEN env var not set. Run: TOKEN='ya29.xxx' bash gbp-diag.sh"
  exit 1
fi

: > "$OUT"

run() {
  local label="$1"; shift
  echo "===== $label =====" | tee -a "$OUT"
  "$@" 2>&1 | tee -a "$OUT"
  echo | tee -a "$OUT"
}

# Test 1: Which GBP-family APIs are enabled in the project (source of truth, not Console)
run "STEP 2 — Enabled business APIs (via Service Usage)" \
  bash -c "curl -s -H 'Authorization: Bearer $TOKEN' \
    'https://serviceusage.googleapis.com/v1/projects/$PROJECT_ID/services?filter=state:ENABLED&pageSize=500' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin);
errors=d.get(\"error\")
if errors: print(\"API_ERROR:\", json.dumps(errors, indent=2)); sys.exit()
matches=[s[\"name\"].split(\"/\")[-1]+\" — \"+s.get(\"state\",\"?\") for s in d.get(\"services\",[]) if \"business\" in s[\"name\"].lower()]
print(\"\\n\".join(matches) if matches else \"(no business-related APIs returned)\")'"

# Test 2: Attempt to enable mybusiness.googleapis.com directly via API (bypasses Console)
run "STEP 3 — Attempt to enable mybusiness.googleapis.com via Service Usage API" \
  curl -s -i -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Length: 0" \
    "https://serviceusage.googleapis.com/v1/projects/$PROJECT_ID/services/mybusiness.googleapis.com:enable"

# Wait briefly for enablement to propagate
sleep 5

# Test 3: Retest v4 reviews after potential enablement
run "STEP 4 — Retest v4 reviews on Pellicano location" \
  curl -s -i -H "Authorization: Bearer $TOKEN" \
    "https://mybusiness.googleapis.com/v4/accounts/$ACCOUNT_PERSONAL/locations/$LOCATION_PELLICANO/reviews?pageSize=5"

# Test 4: Modern Business Calls API
run "STEP 5 — businesscalls.googleapis.com test" \
  curl -s -i -H "Authorization: Bearer $TOKEN" \
    "https://mybusinessbusinesscalls.googleapis.com/v1/locations/$LOCATION_PELLICANO/businesscallsinsights"

echo "===== DONE — output written to $OUT ====="
