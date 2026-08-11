#!/usr/bin/env bash
# Part 2: seed admin + target via DB, then test admin endpoints & upsert-profile(POST).
set -u
BASE="http://localhost:5000/api/v1"
ADMIN_MAIL="admin_$RANDOM@jobmatch.test"
TGT_MAIL="target_$RANDOM@jobmatch.test"
ADMIN_PASS="Admin123!"
PG="docker exec -i jobmatch_test_pg psql -U jobmatch -d jobmatch_vn -t -A"

echo "=== seeding admin + target directly in DB ==="
H_ADMIN=$(cd "d:/metadata/jobmatch-vn/backend" && node -e 'require("bcrypt").hash("Admin123!",12).then(h=>process.stdout.write(h))')
docker exec -i jobmatch_test_pg psql -U jobmatch -d jobmatch_vn <<SQL
INSERT INTO users (email, password_hash, role, status, email_verified_at, metadata)
VALUES ('$ADMIN_MAIL', '$H_ADMIN', 'admin', 'active', now(), '{}'::jsonb);
INSERT INTO users (email, role, status, email_verified_at, metadata)
VALUES ('$TGT_MAIL', 'candidate', 'active', now(), '{}'::jsonb);
SQL

TGT_ID=$($PG -c "SELECT id FROM users WHERE email='$TGT_MAIL';")
echo "admin=$ADMIN_MAIL  target=$TGT_MAIL  target.id=$TGT_ID"

jval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let v=j;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(v==null?"":String(v));' "$1" "$2" 2>/dev/null; }
call() {
  local file="$1" method="$2" path="$3" json="${4:-}" tok="${5:-}"
  local hdr=(-H "Content-Type: application/json")
  [ -n "$tok" ] && hdr+=(-H "Authorization: Bearer $tok")
  local url="$BASE$path"
  if [ "$method" = "GET" ] || [ "$method" = "DELETE" ]; then
    curl -s -o "$file" -w 'HTTP_STATUS:%{http_code}' "${hdr[@]}" "$url" > "$file.tmp"
  else
    curl -s -o "$file" -w 'HTTP_STATUS:%{http_code}' -X "$method" "${hdr[@]}" -d "$json" "$url" > "$file.tmp"
  fi
}
expect() {
  local label="$1" file="$2" want="$3"
  local body; body="$(cat "$file" 2>/dev/null)"
  local status; status="$(grep -o 'HTTP_STATUS:[0-9]*' "$file.tmp" 2>/dev/null | head -1 | grep -o '[0-9]*')"
  rm -f "$file.tmp"
  local ok="❌"; [ "$status" = "$want" ] && ok="✅"
  printf "%s [%-3s want %s] %s\n     -> %s\n" "$ok" "${status:-?}" "$want" "$label" "$(echo "$body" | head -c 200 | tr '\n' ' ')"
}

echo ""
echo "=== login as admin ==="
call /tmp/a_login.json POST "/auth/login" "{\"email\":\"$ADMIN_MAIL\",\"password\":\"$ADMIN_PASS\"}"
expect "admin login" /tmp/a_login.json 200
ATOK=$(jval /tmp/a_login.json data.accessToken)
echo "admin token=${ATOK:0:24}..."

echo ""
echo "=== upsert-profile MUST be POST (router line 19) ==="
call /tmp/up_put.json PUT "/auth/upsert-profile" "{\"fullName\":\"Admin User\"}" "$ATOK"
expect "PUT /auth/upsert-profile (wrong method -> 404)" /tmp/up_put.json 404
call /tmp/up_post.json POST "/auth/upsert-profile" "{\"fullName\":\"Admin User\",\"phone\":\"0900000000\"}" "$ATOK"
expect "POST /auth/upsert-profile (auth)" /tmp/up_post.json 200

echo ""
echo "=== ADMIN endpoints with admin token ==="
call /tmp/m_list.json GET "/admin/users?page=1&limit=5" "" "$ATOK"
expect "GET /admin/users (admin)" /tmp/m_list.json 200

call /tmp/m_email.json GET "/admin/users/email?email=$TGT_MAIL" "" "$ATOK"
expect "GET /admin/users/email (admin)" /tmp/m_email.json 200

call /tmp/m_id.json GET "/admin/users/$TGT_ID" "" "$ATOK"
expect "GET /admin/users/:id (admin)" /tmp/m_id.json 200

call /tmp/m_susp.json PATCH "/admin/users/$TGT_ID/status" "{\"status\":\"suspended\"}" "$ATOK"
expect "PATCH status='suspended' (correct spelling -> 200)" /tmp/m_susp.json 200

call /tmp/m_typo.json PATCH "/admin/users/$TGT_ID/status" "{\"status\":\"supended\"}" "$ATOK"
expect "PATCH status='supended' (TYPO -> 500)" /tmp/m_typo.json 500

call /tmp/m_bogus.json PATCH "/admin/users/$TGT_ID/status" "{\"status\":\"bogus\"}" "$ATOK"
expect "PATCH status='bogus' (invalid -> 500)" /tmp/m_bogus.json 500

call /tmp/m_del.json DELETE "/admin/users/$TGT_ID" "" "$ATOK"
expect "DELETE /admin/users/:id (admin)" /tmp/m_del.json 200

# verify status change persisted (suspended) before delete? already deleted; check via fresh target
echo ""
echo "done"
