#!/usr/bin/env bash
# API test for router/auth.ts + router/admin/user.ts
# Reads OTP straight from Redis (no MailHog needed).
set -u
BASE="http://localhost:5000/api/v1"
PASS="Pass1234!"
NEWPASS="NewPass5678!"
TAG="t$(date +%s)$RANDOM"
A="a_$TAG@jobmatch.test"   # main candidate
B="b_$TAG@jobmatch.test"   # admin target

REDIS="docker exec jobmatch_test_redis redis-cli --raw"

PASS_CNT=0; FAIL_CNT=0
declare -a RESULTS

# jval <file> <dotted.path>  -> prints value
jval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let v=j;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(v==null?"":String(v));' "$1" "$2" 2>/dev/null; }

# expect <label> <file> <expected_status>
expect() {
  local label="$1" file="$2" want="$3"
  local body; body="$(cat "$file" 2>/dev/null)"
  local status; status="$(grep -o 'HTTP_STATUS:[0-9]*' "$file.tmp" 2>/dev/null | head -1 | grep -o '[0-9]*')"
  rm -f "$file.tmp"
  local ok="❌"
  if [ "$status" = "$want" ]; then ok="✅"; PASS_CNT=$((PASS_CNT+1)); else FAIL_CNT=$((FAIL_CNT+1)); fi
  local snippet; snippet="$(echo "$body" | head -c 200 | tr '\n' ' ')"
  printf "%s [%-3s want %s] %s\n     -> %s\n" "$ok" "$status" "$want" "$label" "$snippet"
  RESULTS+=("$ok [$status/$want] $label :: $snippet")
}

# call <file> <method> <path> [json] [auth_token]
call() {
  local file="$1" method="$2" path="$3" json="${4:-}" tok="${5:-}"
  local hdr=(); hdr+=("-H 'Content-Type: application/json'")
  [ -n "$tok" ] && hdr+=("-H 'Authorization: Bearer $tok'")
  local url="$BASE$path"
  if [ "$method" = "GET" ] || [ "$method" = "DELETE" ]; then
    eval curl -s -o "$file" -w "'HTTP_STATUS:%{http_code}'" "${hdr[@]}" "'$url'" > "$file.tmp"
  else
    eval curl -s -o "$file" -w "'HTTP_STATUS:%{http_code}'" -X "$method" "${hdr[@]}" -d "'$json'" "'$url'" > "$file.tmp"
  fi
}

get_otp() { $REDIS GET "otp:$1:$2" 2>/dev/null | tr -d '\r\n '; }

echo "════════════════════════════════════════════════════════════"
echo " HEALTH"
echo "════════════════════════════════════════════════════════════"
curl -s -o /tmp/h.txt -w 'HTTP_STATUS:%{http_code}' http://localhost:5000/health > /tmp/h.txt.tmp
expect "GET /health" /tmp/h.txt 200
curl -s -o /tmp/r.txt -w 'HTTP_STATUS:%{http_code}' "$BASE/" > /tmp/r.txt.tmp 2>/dev/null

echo ""
echo "════════════════════════════════════════════════════════════"
echo " AUTH: register / otp / login"
echo "════════════════════════════════════════════════════════════"

call /tmp/01_req.json POST "/auth/register/request-otp" "{\"email\":\"$A\",\"password\":\"$PASS\",\"role\":\"candidate\"}"
expect "POST /auth/register/request-otp" /tmp/01_req.json 201

OTP_A=$(get_otp register "$A")
echo "     OTP(read from redis) = ${OTP_A:-<none>}"

call /tmp/02_ver.json POST "/auth/register/verify-otp" "{\"email\":\"$A\",\"otp\":\"$OTP_A\"}"
expect "POST /auth/register/verify-otp (correct OTP)" /tmp/02_ver.json 200

call /tmp/03_resend.json POST "/auth/register/resend-otp" "{\"email\":\"$A\"}"
# resend within 60s cooldown -> expect 429 RESEND_COOLDOWN
expect "POST /auth/register/resend-otp (cooldown -> 429)" /tmp/03_resend.json 429

call /tmp/04_login.json POST "/auth/login" "{\"email\":\"$A\",\"password\":\"$PASS\"}"
expect "POST /auth/login" /tmp/04_login.json 200
TA=$(jval /tmp/04_login.json data.accessToken)
RA=$(jval /tmp/04_login.json data.refreshToken)
echo "     accessToken=${TA:0:24}...  refreshToken=${RA:0:24}..."

echo ""
echo "════════════════════════════════════════════════════════════"
echo " AUTH: forgot / reset password"
echo "════════════════════════════════════════════════════════════"

call /tmp/05_forgot.json POST "/auth/forgot-password" "{\"email\":\"$A\"}"
expect "POST /auth/forgot-password" /tmp/05_forgot.json 200

OTP_RST=$(get_otp reset_password "$A")
echo "     reset OTP(read from redis) = ${OTP_RST:-<none>}"

call /tmp/06_reset.json POST "/auth/reset-password" "{\"email\":\"$A\",\"otp\":\"$OTP_RST\",\"newPassword\":\"$NEWPASS\"}"
expect "POST /auth/reset-password (correct OTP)" /tmp/06_reset.json 200

call /tmp/07_relogin.json POST "/auth/login" "{\"email\":\"$A\",\"password\":\"$NEWPASS\"}"
expect "POST /auth/login (after password reset)" /tmp/07_relogin.json 200
TA=$(jval /tmp/07_relogin.json data.accessToken)
RA=$(jval /tmp/07_relogin.json data.refreshToken)
UID_A=$(jval /tmp/07_relogin.json data.user.id)
echo "     user.id=$UID_A"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " AUTH: token-gated endpoints"
echo "════════════════════════════════════════════════════════════"

call /tmp/08_refresh.json POST "/auth/refresh" "{\"refreshToken\":\"$RA\"}"
expect "POST /auth/refresh" /tmp/08_refresh.json 200

call /tmp/09_avatar.json POST "/auth/change-avatar" "{\"avatarUrl\":\"https://example.com/a.png\"}" "$TA"
expect "POST /auth/change-avatar (auth)" /tmp/09_avatar.json 200

call /tmp/10_profile.json PUT "/auth/upsert-profile" "{\"fullName\":\"Nguyen Van A\",\"phone\":\"0900000001\",\"location\":\"HN\"}" "$TA"
expect "PUT /auth/upsert-profile (auth)" /tmp/10_profile.json 200

call /tmp/11_getprof.json GET "/auth/profile" "" "$TA"
expect "GET /auth/profile (auth)" /tmp/11_getprof.json 200

call /tmp/12_noprof.json GET "/auth/profile" ""
expect "GET /auth/profile (NO token -> 401)" /tmp/12_noprof.json 401

echo ""
echo "════════════════════════════════════════════════════════════"
echo " AUTH: validation / error cases"
echo "════════════════════════════════════════════════════════════"

call /tmp/v1.json POST "/auth/register/request-otp" "{\"email\":\"not-an-email\",\"password\":\"$PASS\",\"role\":\"candidate\"}"
expect "POST register bad email -> 422" /tmp/v1.json 422

call /tmp/v2.json POST "/auth/register/verify-otp" "{\"email\":\"$A\",\"otp\":\"12345\"}"
expect "POST verify-otp bad format -> 422" /tmp/v2.json 422

call /tmp/v3.json POST "/auth/login" "{\"email\":\"$A\",\"password\":\"WrongPass999\"}"
expect "POST login wrong password -> 401" /tmp/v3.json 401

call /tmp/v4.json POST "/auth/login" "{\"email\":\"nobody_$TAG@jobmatch.test\",\"password\":\"$PASS\"}"
expect "POST login unknown email -> 404" /tmp/v4.json 404

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ADMIN: setup target user B"
echo "════════════════════════════════════════════════════════════"

call /tmp/20_reqB.json POST "/auth/register/request-otp" "{\"email\":\"$B\",\"password\":\"$PASS\",\"role\":\"candidate\"}"
expect "POST register B" /tmp/20_reqB.json 201
OTP_B=$(get_otp register "$B")
call /tmp/21_verB.json POST "/auth/register/verify-otp" "{\"email\":\"$B\",\"otp\":\"$OTP_B\"}"
expect "POST verify B" /tmp/21_verB.json 200

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ADMIN: endpoints (no role check — any token works)"
echo "════════════════════════════════════════════════════════════"

call /tmp/30_list.json GET "/admin/users?page=1&limit=5" "" "$TA"
expect "GET /admin/users (auth candidate token)" /tmp/30_list.json 200

call /tmp/31_noadmin.json GET "/admin/users" ""
expect "GET /admin/users (NO token -> 401)" /tmp/31_noadmin.json 401

call /tmp/32_byemail.json GET "/admin/users/email?email=$B" "" "$TA"
expect "GET /admin/users/email?email=B" /tmp/32_byemail.json 200
UID_B=$(jval /tmp/32_byemail.json data.id)
echo "     B.id=$UID_B"

call /tmp/33_byid.json GET "/admin/users/$UID_B" "" "$TA"
expect "GET /admin/users/:id (B)" /tmp/33_byid.json 200

call /tmp/34_status_ok.json PATCH "/admin/users/$UID_B/status" "{\"status\":\"suspended\"}" "$TA"
expect "PATCH status='suspended' (correct spelling)" /tmp/34_status_ok.json 200

call /tmp/35_status_typo.json PATCH "/admin/users/$UID_B/status" "{\"status\":\"supended\"}" "$TA"
expect "PATCH status='supended' (TYPO -> expect 500)" /tmp/35_status_typo.json 500

call /tmp/36_status_bad.json PATCH "/admin/users/$UID_B/status" "{\"status\":\"not_a_status\"}" "$TA"
expect "PATCH status='not_a_status' (invalid -> expect 500)" /tmp/36_status_bad.json 500

call /tmp/37_del.json DELETE "/admin/users/$UID_B" "" "$TA"
expect "DELETE /admin/users/:id (B)" /tmp/37_del.json 200

echo ""
echo "════════════════════════════════════════════════════════════"
echo " AUTH: logout + self soft-delete"
echo "════════════════════════════════════════════════════════════"

call /tmp/40_logout.json POST "/auth/logout" "{\"refreshToken\":\"$RA\"}" "$TA"
expect "POST /auth/logout (auth)" /tmp/40_logout.json 200

call /tmp/41_softdel.json PUT "/auth/soft-delete" "" "$TA"
expect "PUT /auth/soft-delete (auth, self)" /tmp/41_softdel.json 200

echo ""
echo "════════════════════════════════════════════════════════════"
echo " SUMMARY:  PASS=$PASS_CNT  FAIL=$FAIL_CNT"
echo "════════════════════════════════════════════════════════════"
