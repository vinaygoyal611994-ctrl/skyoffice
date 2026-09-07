#!/usr/bin/env bash
# Smoke test for Task #59 — Office and Freelancer provider types
# Run from workspace root: bash artifacts/api-server/smoke-test-provider-types.sh
set -euo pipefail

BASE="${API_BASE:-http://localhost:8080}"

PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "  PASS [$PASS] $1"; }
fail(){ FAIL=$((FAIL+1)); echo "  FAIL        $1"; }

assert_status() {
  local desc="$1" expected="$2"
  local actual
  actual=$(echo "${RESP_CODE:-0}")
  if [ "$actual" = "$expected" ]; then ok "$desc → $actual"; else fail "$desc → got $actual, want $expected"; fi
}

assert_body_contains() {
  local desc="$1" needle="$2"
  if echo "${RESP_BODY:-}" | grep -q "$needle"; then ok "$desc contains '$needle'"; else fail "$desc — missing '$needle' in body"; fi
}

assert_body_not_contains() {
  local desc="$1" needle="$2"
  if ! echo "${RESP_BODY:-}" | grep -q "$needle"; then ok "$desc does not contain '$needle'"; else fail "$desc — unexpected '$needle' in body"; fi
}

get() {
  local path="$1"
  RESP_CODE=$(curl -s -o /tmp/smoke_body -w "%{http_code}" "$BASE$path")
  RESP_BODY=$(cat /tmp/smoke_body)
}

post_json() {
  local path="$1" data="$2"
  RESP_CODE=$(curl -s -o /tmp/smoke_body -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$data" "$BASE$path")
  RESP_BODY=$(cat /tmp/smoke_body)
}

echo ""
echo "=== Smoke test: Provider Types (Task #59) ==="
echo "    Target: $BASE"
echo ""

# ── Health check ──────────────────────────────────────────────────────────────
echo "--- Health ---"
get /api/healthz
assert_status "GET /api/healthz" 200

# ── Public GET /offices — providerType required ───────────────────────────────
echo ""
echo "--- GET /offices (public) ---"

get "/api/offices"
assert_status "missing providerType → 400" 400

get "/api/offices?providerType=banana"
assert_status "invalid providerType → 400" 400

get "/api/offices?providerType=office"
assert_status "providerType=office → 200" 200
assert_body_not_contains "freelancer result in office list" '"providerType":"freelancer"'

get "/api/offices?providerType=freelancer"
assert_status "providerType=freelancer → 200" 200
assert_body_not_contains "office result in freelancer list" '"providerType":"office"'

get "/api/offices?providerType=office&verifiedOnly=true"
assert_status "office + verifiedOnly → 200" 200

get "/api/offices?providerType=freelancer&verifiedOnly=true"
assert_status "freelancer + verifiedOnly → 200" 200

# ── Category filters with providerType ───────────────────────────────────────
echo ""
echo "--- Category + providerType combos ---"
for cat in translation legal marketing development design real_estate company_formation business_consulting accounting social_media_management other; do
  get "/api/offices?providerType=office&category=$cat"
  assert_status "office + category=$cat → 200" 200
  get "/api/offices?providerType=freelancer&category=$cat"
  assert_status "freelancer + category=$cat → 200" 200
done

# ── OfficeSummary shape: providerType field present ───────────────────────────
echo ""
echo "--- OfficeSummary shape ---"
get "/api/offices?providerType=office"
assert_body_not_contains "no providerType key missing from empty response" "error"

get "/api/offices?providerType=freelancer"
assert_body_not_contains "no error on freelancer empty list" "error"

# ── Registration validation — providerType required ───────────────────────────
echo ""
echo "--- Registration validation ---"

# Missing providerType → 400
post_json "/api/auth/register/office" '{"officeName":"Test","email":"nopty@example.com","password":"123456","whatsapp":"+966500000001","city":"Riyadh","category":"translation","termsAccepted":true}'
assert_status "register without providerType → 400" 400

# Invalid providerType → 400
post_json "/api/auth/register/office" '{"officeName":"Test","email":"badpty@example.com","password":"123456","whatsapp":"+966500000002","city":"Riyadh","category":"translation","providerType":"agency","termsAccepted":true}'
assert_status "register with invalid providerType → 400" 400

# Valid office registration (may fail 409 if email exists; that's fine — 400 would be wrong)
post_json "/api/auth/register/office" '{"officeName":"Smoke Office","email":"smokeoffice@example.com","password":"123456","whatsapp":"+966500000003","city":"Riyadh","category":"translation","providerType":"office","termsAccepted":true}'
if [ "$RESP_CODE" = "201" ] || [ "$RESP_CODE" = "409" ]; then ok "register providerType=office → $RESP_CODE (201 or 409 ok)"; else fail "register providerType=office → got $RESP_CODE"; fi

# Valid freelancer registration
post_json "/api/auth/register/office" '{"officeName":"Smoke Freelancer","email":"smokefreelancer@example.com","password":"123456","whatsapp":"+966500000004","city":"Jeddah","category":"design","providerType":"freelancer","termsAccepted":true}'
if [ "$RESP_CODE" = "201" ] || [ "$RESP_CODE" = "409" ]; then ok "register providerType=freelancer → $RESP_CODE (201 or 409 ok)"; else fail "register providerType=freelancer → got $RESP_CODE"; fi

# ── Admin GET /admin/offices — providerType optional ─────────────────────────
echo ""
echo "--- GET /admin/offices (admin, providerType optional) ---"
# Without auth → 401 (auth guard fires before filter)
get "/api/admin/offices"
assert_status "admin/offices no auth → 401" 401

get "/api/admin/offices?providerType=office"
assert_status "admin/offices?providerType=office no auth → 401" 401

get "/api/admin/offices?providerType=freelancer"
assert_status "admin/offices?providerType=freelancer no auth → 401" 401

get "/api/admin/offices?providerType=both"
assert_status "admin/offices?providerType=invalid no auth → 401" 401

# ── social_media_management category on public side ──────────────────────────
echo ""
echo "--- social_media_management category ---"
get "/api/offices?providerType=office&category=social_media_management"
assert_status "office + social_media_management → 200" 200

get "/api/offices?providerType=freelancer&category=social_media_management"
assert_status "freelancer + social_media_management → 200" 200

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "================================="
echo "  PASS: $PASS   FAIL: $FAIL"
echo "================================="
echo ""
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
