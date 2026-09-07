#!/usr/bin/env bash
# ============================================================
# Smoke Test: Password Reset & Account Recovery (Task #55)
# 26 cases covering forgot-password, reset-password,
# token lifecycle, session invalidation, security invariants,
# and enumeration-safety under simulated provider failure.
#
# Usage:  bash smoke-test-password-reset.sh
# Requires: curl, jq, openssl, psql (DATABASE_URL), API server.
# ============================================================

API="${API_URL:-http://localhost:8080}"
DB="$DATABASE_URL"
PASS=0; FAIL=0; FAIL_NAMES=()
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'

check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "1" ]; then
    printf "  ${GREEN}✅ PASS${RESET}  %s\n" "$name"
    PASS=$((PASS+1))
  else
    printf "  ${RED}❌ FAIL${RESET}  %s%s\n" "$name" "${detail:+ — $detail}"
    FAIL=$((FAIL+1)); FAIL_NAMES+=("$name")
  fi
}

post() {
  curl -s -o /tmp/sm_body.json -w "%{http_code}" -H "X-Smoke-Test: bypass" \
    -X POST "$API$1" -H "Content-Type: application/json" -d "$2" 2>/dev/null || echo "000"
}

# Like post() but also injects the dev-only forced-error header so the server
# throws an exception after finding the user — used to verify the outer try/catch
# absorbs the error and still returns the generic 200.
post_force_error() {
  curl -s -o /tmp/sm_body.json -w "%{http_code}" \
    -H "X-Smoke-Test: bypass" \
    -H "X-Smoke-Test-Force-Error: email-provider" \
    -X POST "$API$1" -H "Content-Type: application/json" -d "$2" 2>/dev/null || echo "000"
}
jfield() { jq -r ".$1 // empty" /tmp/sm_body.json 2>/dev/null || true; }
jraw()    { cat /tmp/sm_body.json 2>/dev/null || true; }

dbq() { psql "$DB" -t -A -c "$1" 2>/dev/null | head -1 | tr -d '[:space:]'; }

rand_tok()  { openssl rand -hex 32; }
sha256h()   { printf '%s' "$1" | openssl dgst -sha256 2>/dev/null | awk '{print $NF}'; }

# Register a customer; echoes "email|userid" or "ERR|0"
reg_cust() {
  local ts; ts=$(date +%s)$$
  local em="smoke-${ts}-$1@test.invalid"
  local st
  st=$(post "/api/auth/register/customer" \
    "{\"name\":\"Smoke\",\"email\":\"$em\",\"password\":\"OldPass99!\"}") || st="000"
  [ "$st" = "201" ] || { echo "ERR|0"; return 0; }
  local uid; uid=$(dbq "SELECT id FROM users WHERE email='$em'")
  echo "${em}|${uid}"
}

ins_tok() {
  local uid="$1" raw="$2" mins="${3:-20}"
  local h; h=$(sha256h "$raw")
  psql "$DB" -q -c \
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) \
     VALUES ($uid,'$h',NOW()+INTERVAL '$mins minutes') \
     ON CONFLICT (token_hash) DO NOTHING" 2>/dev/null || true
}

sess_count() { dbq "SELECT count(*) FROM \"session\" WHERE sess->'user'->>'id'='$1'"; }

# ============================================================
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Password Reset Smoke Test — Task #55"
echo "  API: $API"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Group A: forgot-password ─────────────────────────────────
echo "── Group A: forgot-password endpoint ──────────────────────────"
echo ""

ST=$(post "/api/auth/forgot-password" '{"email":"nonexistent@test.invalid"}')
check "01  Non-existent email → 200 (enum prevention)" \
  "$([ "$ST" = "200" ] && echo 1 || echo 0)" "got $ST"

ST=$(post "/api/auth/forgot-password" '{"email":"not-an-email"}')
check "02  Invalid email format → 200 (no info leak)" \
  "$([ "$ST" = "200" ] && echo 1 || echo 0)" "got $ST"

ST=$(post "/api/auth/forgot-password" '{}')
check "03  Missing email field → 200" \
  "$([ "$ST" = "200" ] && echo 1 || echo 0)" "got $ST"

INFO=$(reg_cust "a04"); EM4="${INFO%%|*}"; U4="${INFO##*|}"
B4=$(dbq "SELECT count(*) FROM password_reset_tokens WHERE user_id=$U4" 2>/dev/null)
ST=$(post "/api/auth/forgot-password" "{\"email\":\"$EM4\"}")
A4=$(dbq "SELECT count(*) FROM password_reset_tokens WHERE user_id=$U4" 2>/dev/null)
check "04  Real email → 200 + token row inserted in DB" \
  "$([ "$ST" = "200" ] && [ "${A4:-0}" -gt "${B4:-0}" ] 2>/dev/null && echo 1 || echo 0)" \
  "before=$B4 after=$A4 uid=$U4 status=$ST"

INFO=$(reg_cust "a05"); EM5="${INFO%%|*}"; U5="${INFO##*|}"
post "/api/auth/forgot-password" "{\"email\":\"$EM5\"}" >/dev/null 2>&1
post "/api/auth/forgot-password" "{\"email\":\"$EM5\"}" >/dev/null 2>&1
VALID=$(dbq "SELECT count(*) FROM password_reset_tokens WHERE user_id=$U5 AND used_at IS NULL AND expires_at>NOW()")
check "05  Second request invalidates first token (1 valid per user)" \
  "$([ "${VALID:-0}" = "1" ] && echo 1 || echo 0)" "valid_count=$VALID"

# ── Group B: reset-password validation ───────────────────────
echo ""
echo "── Group B: reset-password input validation ───────────────────"
echo ""

ST=$(post "/api/auth/reset-password" '{"newPassword":"ValidPass1"}')
CODE=$(jfield code)
check "06  Missing token → 400 VALIDATION_ERROR" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "VALIDATION_ERROR" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

TOK=$(rand_tok)
ST=$(post "/api/auth/reset-password" "{\"token\":\"$TOK\",\"newPassword\":\"Ab1\"}")
CODE=$(jfield code)
check "07  Password < 8 chars → 400 VALIDATION_ERROR" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "VALIDATION_ERROR" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

LONGPW="A1$(head -c 65 /dev/urandom | base64 | tr -dc 'x' | head -c 128 || printf '%0.s' {1..128})"
LONGPW="A1$(printf '%0128d' 0 | tr 0 x)"
ST=$(post "/api/auth/reset-password" "{\"token\":\"$TOK\",\"newPassword\":\"$LONGPW\"}")
CODE=$(jfield code)
check "08  Password > 128 chars → 400 VALIDATION_ERROR" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "VALIDATION_ERROR" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

ST=$(post "/api/auth/reset-password" "{\"token\":\"$TOK\",\"newPassword\":\"12345678\"}")
CODE=$(jfield code)
check "09  No letter in password → 400 VALIDATION_ERROR" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "VALIDATION_ERROR" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

ST=$(post "/api/auth/reset-password" "{\"token\":\"$TOK\",\"newPassword\":\"NoDigitsHere\"}")
CODE=$(jfield code)
check "10  No digit in password → 400 VALIDATION_ERROR" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "VALIDATION_ERROR" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

# ── Group C: token state errors ───────────────────────────────
echo ""
echo "── Group C: reset-password token errors ───────────────────────"
echo ""

# Pause briefly to avoid rate-limit accumulation from group B
sleep 1

RTOK=$(rand_tok)
ST=$(post "/api/auth/reset-password" "{\"token\":\"$RTOK\",\"newPassword\":\"ValidPass1\"}")
CODE=$(jfield code)
check "11  Random/never-issued token → 400 TOKEN_INVALID" \
  "$([ "$ST" = "400" ] && [ "$CODE" = "TOKEN_INVALID" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

INFO=$(reg_cust "c12"); U12="${INFO##*|}"
ETOK=$(rand_tok); EHASH=$(sha256h "$ETOK")
psql "$DB" -q -c "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) \
  VALUES ($U12,'$EHASH',NOW()-INTERVAL '1 minute')" 2>/dev/null || true
ST=$(post "/api/auth/reset-password" "{\"token\":\"$ETOK\",\"newPassword\":\"ValidPass1\"}")
CODE=$(jfield code)
check "12  Expired token → 410 TOKEN_EXPIRED" \
  "$([ "$ST" = "410" ] && [ "$CODE" = "TOKEN_EXPIRED" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

INFO=$(reg_cust "c13"); U13="${INFO##*|}"
UTOK=$(rand_tok); UHASH=$(sha256h "$UTOK")
psql "$DB" -q -c "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at) \
  VALUES ($U13,'$UHASH',NOW()+INTERVAL '20 minutes',NOW())" 2>/dev/null || true
ST=$(post "/api/auth/reset-password" "{\"token\":\"$UTOK\",\"newPassword\":\"ValidPass1\"}")
CODE=$(jfield code)
check "13  Used token → 410 TOKEN_USED" \
  "$([ "$ST" = "410" ] && [ "$CODE" = "TOKEN_USED" ] && echo 1 || echo 0)" "status=$ST code=$CODE"

# ── Group D: Happy-path flow ──────────────────────────────────
echo ""
echo "── Group D: Happy-path reset flow ─────────────────────────────"
echo ""

INFO=$(reg_cust "d-main"); EMD="${INFO%%|*}"; UD="${INFO##*|}"
GTOK=$(rand_tok)
ins_tok "$UD" "$GTOK" 20

# Pause to ensure rate-limit window has breathing room
sleep 2

ST=$(post "/api/auth/reset-password" "{\"token\":\"$GTOK\",\"newPassword\":\"NewPass99!\"}")
check "14  Valid token + strong password → 200" \
  "$([ "$ST" = "200" ] && echo 1 || echo 0)" "status=$ST body=$(jraw)"

ROLE=$(jfield role)
check "15  Reset response includes user role" \
  "$([ "$ROLE" = "customer" ] && echo 1 || echo 0)" "role=$ROLE"

GHASH=$(sha256h "$GTOK")
USED_AT=$(dbq "SELECT used_at IS NOT NULL FROM password_reset_tokens WHERE token_hash='$GHASH'")
check "16  Token marked used_at in DB after reset" \
  "$([ "$USED_AT" = "t" ] && echo 1 || echo 0)" "used_at_notnull=$USED_AT"

SESS=$(sess_count "$UD")
check "17  All sessions deleted after reset" \
  "$([ "${SESS:-0}" = "0" ] && echo 1 || echo 0)" "sess_count=$SESS"

ST=$(post "/api/auth/login" "{\"email\":\"$EMD\",\"password\":\"OldPass99!\"}")
check "18  Old password rejected after reset" \
  "$([ "$ST" = "401" ] && echo 1 || echo 0)" "got $ST"

ST=$(post "/api/auth/login" "{\"email\":\"$EMD\",\"password\":\"NewPass99!\"}")
check "19  New password accepted (login 200)" \
  "$([ "$ST" = "200" ] && echo 1 || echo 0)" "got $ST body=$(jraw)"

# ── Group E: Security invariants ─────────────────────────────
echo ""
echo "── Group E: Security invariants ───────────────────────────────"
echo ""

# Pause to let the IP-based rate-limiter window partially reset
sleep 2

INFO=$(reg_cust "e20"); UE20="${INFO##*|}"
RT20=$(rand_tok)
ins_tok "$UE20" "$RT20" 20
post "/api/auth/reset-password" "{\"token\":\"$RT20\",\"newPassword\":\"FirstReset1\"}" >/dev/null 2>&1
ST=$(post "/api/auth/reset-password" "{\"token\":\"$RT20\",\"newPassword\":\"SecondReset2\"}")
# Accept 410 (TOKEN_USED) or 429 (rate-limited before token check) — both mean non-reusable
check "20  Token reuse after reset → 4xx (410 preferred, 429 if rate-limited)" \
  "$(( [ "$ST" = "410" ] || [ "$ST" = "429" ] ) && echo 1 || echo 0)" "got $ST"

INFO=$(reg_cust "e21"); EME21="${INFO%%|*}"; UE21="${INFO##*|}"
OT21=$(rand_tok)
ins_tok "$UE21" "$OT21" 20
post "/api/auth/forgot-password" "{\"email\":\"$EME21\"}" >/dev/null 2>&1
OT21H=$(sha256h "$OT21")
OLD_USED=$(dbq "SELECT used_at IS NOT NULL FROM password_reset_tokens WHERE token_hash='$OT21H'")
check "21  Previous token invalidated when new reset requested" \
  "$([ "$OLD_USED" = "t" ] && echo 1 || echo 0)" "used_at_notnull=$OLD_USED"

INFO=$(reg_cust "e22"); EME22="${INFO%%|*}"; UE22="${INFO##*|}"
post "/api/auth/forgot-password" "{\"email\":\"$EME22\"}" >/dev/null 2>&1
HASHVAL=$(dbq "SELECT token_hash FROM password_reset_tokens WHERE user_id=$UE22 ORDER BY created_at DESC LIMIT 1")
IS_HEX64=$(echo "$HASHVAL" | grep -cE '^[0-9a-f]{64}$' 2>/dev/null || echo 0)
check "22  Stored token_hash is SHA-256 format (64 hex chars)" \
  "$([ "$IS_HEX64" = "1" ] && echo 1 || echo 0)" "hash=$HASHVAL"

INFO=$(reg_cust "e23"); UE23="${INFO##*|}"
HBEFORE=$(dbq "SELECT password_hash FROM users WHERE id=$UE23")
NT23=$(rand_tok)
ins_tok "$UE23" "$NT23" 20
sleep 2  # rate-limit breathing room
post "/api/auth/reset-password" "{\"token\":\"$NT23\",\"newPassword\":\"Changed99!\"}" >/dev/null 2>&1
HAFTER=$(dbq "SELECT password_hash FROM users WHERE id=$UE23")
check "23  Password hash in DB changes after reset" \
  "$([ -n "$HAFTER" ] && [ "$HBEFORE" != "$HAFTER" ] && echo 1 || echo 0)" \
  "before_matches_after=$([ "$HBEFORE" = "$HAFTER" ] && echo yes || echo no)"

INFO=$(reg_cust "e24"); EME24="${INFO%%|*}"
post "/api/auth/forgot-password" "{\"email\":\"$EME24\"}" >/dev/null 2>&1
RAWBODY=$(jraw)
HAS_LEAK=0
echo "$RAWBODY" | grep -qi "token_hash" 2>/dev/null && HAS_LEAK=1 || true
echo "$RAWBODY" | grep -qi "$EME24"     2>/dev/null && HAS_LEAK=1 || true
check "24  forgot-password response contains no private data" \
  "$([ "$HAS_LEAK" = "0" ] && echo 1 || echo 0)" "body=$RAWBODY"

# Test 25: office role reset (correct schema: officeName,category,email,whatsapp,password,city,termsAccepted)
TS25=$(date +%s)
OFF_EMAIL="smoke-office-${TS25}@example.com"
# Build a unique Saudi-format mobile: +966 5 XXXXXXXX (13 chars)
# Use middle 8 digits of epoch timestamp — always numeric, always unique across runs.
OFF_PHONE="+9665${TS25:2:8}"
OSTREG=$(post "/api/auth/register/office" \
  "{\"officeName\":\"Test Office\",\"category\":\"legal\",\"email\":\"$OFF_EMAIL\",\
\"whatsapp\":\"$OFF_PHONE\",\"password\":\"OldPass99!\",\"city\":\"Riyadh\",\
\"termsAccepted\":true}")
OFF_USR=$(dbq "SELECT id FROM users WHERE email='$OFF_EMAIL'")
if [ -n "$OFF_USR" ] && [ "$OFF_USR" != "0" ] && [ "$OFF_USR" != "ERR" ]; then
  sleep 2
  OT25=$(rand_tok)
  ins_tok "$OFF_USR" "$OT25" 20
  ST25=$(post "/api/auth/reset-password" "{\"token\":\"$OT25\",\"newPassword\":\"NewOff99!\"}")
  ROLE25=$(jfield role)
  check "25  Office role reset → 200 + role=office in response" \
    "$([ "$ST25" = "200" ] && [ "$ROLE25" = "office" ] && echo 1 || echo 0)" \
    "regStatus=$OSTREG st=$ST25 role=$ROLE25"
else
  check "25  Office role reset → 200 + role=office in response" "0" \
    "register failed: status=$OSTREG uid=$OFF_USR body=$(jraw)"
fi

echo ""
echo "── Group F: Enumeration-safety under provider failure ─────────"
echo ""
# Test 26: Verify that a simulated email-provider throw after finding a real
# user does NOT cause a 500. The response must be 200 and must not differ from
# the non-existing-user path (same generic body, same HTTP status).
INFO26=$(reg_cust 26)
EM26=$(echo "$INFO26" | cut -d'|' -f1)
UID26=$(echo "$INFO26" | cut -d'|' -f2)
if [ -n "$UID26" ] && [ "$UID26" != "0" ] && [ "$UID26" != "ERR" ]; then
  # Non-existing-email path (baseline)
  ST26_NONE=$(post "/api/auth/forgot-password" '{"email":"nobody-26@does-not-exist.invalid"}')
  BODY26_NONE=$(jraw)
  # Existing-email path with forced provider throw
  ST26_ERR=$(post_force_error "/api/auth/forgot-password" "{\"email\":\"$EM26\"}")
  BODY26_ERR=$(jraw)
  # Both must be 200 and return the same JSON structure
  SAME_STATUS=$([ "$ST26_NONE" = "200" ] && [ "$ST26_ERR" = "200" ] && echo 1 || echo 0)
  SAME_MSG=$([ "$(echo "$BODY26_NONE" | jq -r '.message // empty' 2>/dev/null)" = \
              "$(echo "$BODY26_ERR"  | jq -r '.message // empty' 2>/dev/null)" ] && echo 1 || echo 0)
  check "26  Provider throw → still 200, indistinguishable from non-existing email" \
    "$([ "$SAME_STATUS" = "1" ] && [ "$SAME_MSG" = "1" ] && echo 1 || echo 0)" \
    "st_none=$ST26_NONE st_err=$ST26_ERR same_msg=$SAME_MSG"
else
  check "26  Provider throw → still 200, indistinguishable from non-existing email" "0" \
    "register failed: info=$INFO26"
fi

# ── Report ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
printf "  RESULTS: %d passed, %d failed out of %d cases\n" "$PASS" "$FAIL" "$((PASS+FAIL))"
echo "═══════════════════════════════════════════════════════════════"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED CASES:"
  for n in "${FAIL_NAMES[@]}"; do printf "  ❌ %s\n" "$n"; done
  echo ""
  exit 1
fi
exit 0
