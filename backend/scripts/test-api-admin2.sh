#!/usr/bin/env bash
# Part 2 re-test: verify routing after adminUserRouter mount + typo bug.
set -u
BASE="http://localhost:5000/api/v1"
ADMIN_MAIL="admin2_$RANDOM@jobmatch.test"
TGT_MAIL="target2_$RANDOM@jobmatch.test"
ADMIN_PASS="Admin123!"

echo "=== seed admin + target in pg:5434 ==="
H_ADMIN=$(cd "d:/metadata/jobmatch-vn/backend" && node -e 'require("bcrypt").hash("Admin123!",12).then(h=>process.stdout.write(h))')
docker exec -i jobmatch_test_pg psql -U jobmatch -d jobmatch_vn <<SQL
INSERT INTO users (email, password_hash, role, status, email_verified_at, metadata)
VALUES ('$ADMIN_MAIL', '$H_ADMIN', 'admin', 'active', now(), '{}'::jsonb);
INSERT INTO users (email, role, status, email_verified_at, metadata)
VALUES ('$TGT_MAIL', 'candidate', 'active', now(), '{}'::jsonb);
SQL
TGT_ID=$(docker exec jobmatch_test_pg psql -U jobmatch -d jobmatch_vn -t -A -c "SELECT id FROM users WHERE email='$TGT_MAIL';")
echo "admin=$ADMIN_MAIL  target=$TGT_MAIL  target.id=$TGT_ID"

jval() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let v=j;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(v==null?"":String(v));' "$1" "$2" 2>/dev/null; }
call() {
  local file="$1" method="$2" path="$3" json="${4:-}" tok="${5:-}"
  local hdr=(-H "Content-Type: application/json")
  [ -n "$tok" ] && hdr+=(-H "Authorization: Bearer $tok")
  if [ "$method" = "GET" ] || [ "$method" = "DELETE" ]; then
    curl -s -o "$file" -w 'HTTP_STATUS:%{http_code}' "${hdr[@]}" "$BASE$path" > "$file.tmp"
  else
    curl -s -o "$file" -w 'HTTP_STATUS:%{http_code}' -X "$method" "${hdr[@]}" -d "$json" "$BASE$path" > "$file.tmp"
  fi
}
show() {
  local label="$1" file="$2" want="$3"
  local status; status="$(grep -o 'HTTP_STATUS:[0-9]*' "$file.tmp" 2>/dev/null | head -1 | grep -o '[0-9]*')"
  local body; body="$(cat "$file" 2>/dev/null | head -c 180 | tr '\n' ' ')"
  rm -f "$file.tmp"
  local ok="❌"; [ "$status" = "$want" ] && ok="✅"
  printf "%s [%-3s want %s] %s\n     -> %s\n" "$ok" "${status:-?}" "$want" "$label" "$body"
}

echo ""
echo "=== login admin ==="
call /tmp/a2.json POST "/auth/login" "{\"email\":\"$ADMIN_MAIL\",\"password\":\"$ADMIN_PASS\"}"
show "admin login" /tmp/a2.json 200
ATOK=$(jval /tmp/a2.json data.accessToken)
echo "admin token=${ATOK:0:20}..."

echo ""
echo "=========================================="
echo " BIẾN THỂ 1: /admin/users/...  (BẠN KỲ VỌNG)"
echo "=========================================="
call /tmp/s1.json GET "/admin/users" "" "$ATOK";       show "GET  /admin/users" /tmp/s1.json 200
call /tmp/s2.json GET "/admin/users/email?email=$TGT_MAIL" "" "$ATOK"; show "GET  /admin/users/email" /tmp/s2.json 200
call /tmp/s3.json GET "/admin/users/$TGT_ID" "" "$ATOK"; show "GET  /admin/users/:id" /tmp/s3.json 200
call /tmp/s4.json PATCH "/admin/users/$TGT_ID/status" "{\"status\":\"suspended\"}" "$ATOK"; show "PATCH /admin/users/:id/status (suspended)" /tmp/s4.json 200
call /tmp/s5.json DELETE "/admin/users/$TGT_ID" "" "$ATOK"; show "DELETE /admin/users/:id" /tmp/s5.json 200

# re-create target (deleted above) for variant 2
docker exec -i jobmatch_test_pg psql -U jobmatch -d jobmatch_vn <<SQL
UPDATE users SET deleted_at=NULL WHERE email='$TGT_MAIL';
SQL

echo ""
echo "=========================================================="
echo " BIẾN THỂ 2: /admin/users/users/...  (DO MOUNT KÉP — THỰC TẾ)"
echo "=========================================================="
call /tmp/d1.json GET "/admin/users/users" "" "$ATOK";       show "GET  /admin/users/users" /tmp/d1.json 200
call /tmp/d2.json GET "/admin/users/users/email?email=$TGT_MAIL" "" "$ATOK"; show "GET  /admin/users/users/email" /tmp/d2.json 200
call /tmp/d3.json GET "/admin/users/users/$TGT_ID" "" "$ATOK"; show "GET  /admin/users/users/:id" /tmp/d3.json 200

echo ""
echo "--- typo test trên route thực sự chạy (double prefix) ---"
call /tmp/t1.json PATCH "/admin/users/users/$TGT_ID/status" "{\"status\":\"suspended\"}" "$ATOK"
show "PATCH status='suspended' (đúng chính tả -> 200)" /tmp/t1.json 200
call /tmp/t2.json PATCH "/admin/users/users/$TGT_ID/status" "{\"status\":\"supended\"}" "$ATOK"
show "PATCH status='supended' (TYPO -> 500)" /tmp/t2.json 500

echo ""
echo "--- check leak passwordHash trong listUsers mới? ---"
call /tmp/lk.json GET "/admin/users/users?limit=2" "" "$ATOK"
if grep -q "passwordHash" /tmp/lk.json 2>/dev/null; then
  echo "❌ listUsers VẪN leak passwordHash"
else
  echo "✅ listUsers KHÔNG còn leak passwordHash (controller mới select cột trắng)"
fi

call /tmp/d5.json DELETE "/admin/users/users/$TGT_ID" "" "$ATOK"; show "DELETE /admin/users/users/:id" /tmp/d5.json 200
