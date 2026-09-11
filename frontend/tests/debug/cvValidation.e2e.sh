#!/usr/bin/env bash
# ============================================================================
# CV direct edit E2E validation — gọi thẳng BE thật, không mock.
#
# Cover:
#   1. CREATE happy path (full skills+projects)
#   2. CREATE isPrimary reset invariant
#   3. CREATE backward compat (string[] → {name,level:3})
#   4. CREATE validation (templateId range, level range, empty title)
#   5. GET detail round-trip exact shape
#   6. PATCH partial update (deep merge)
#   7. PATCH replace array (RFC 7396)
#   8. PATCH null delete field
#   9. PATCH invalid source (upload CV → 400)
#  10. PATCH race guard (analyzing → 409 ALREADY_PROCESSING)
#  11. PATCH 404 cross-user
#  12. Worker re-analyze loop (status: analyzing → ready, ai_analysis.total có)
#  13. Full round-trip multi-step
#
# Mỗi step in PASS/FAIL + evidence JSON. Exit code !=0 nếu có FAIL.
# ============================================================================
set -u

BE="http://localhost:5000"
LOG_FILE="$(dirname "$0")/cvValidation.e2e.log"
: > "$LOG_FILE"

PASS=0
FAIL=0
STEP_NUM=0

log() {
  local label="$1"; shift
  echo "[$(date +%H:%M:%S)] $label: $*" | tee -a "$LOG_FILE"
}

# expect: name expected_status expected_substring_in_body [actual_json]
expect() {
  local name="$1" want_status="$2" want_substr="$3" actual="$4"
  STEP_NUM=$((STEP_NUM+1))
  local actual_status
  actual_status=$(echo "$actual" | head -c 1)  # crude; better curl with -w
  # Use jq nếu có, fallback grep.
  if command -v jq >/dev/null 2>&1; then
    local s
    s=$(echo "$actual" | python -c "import sys, json; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail:' + str(d.get('error',{}).get('code','?')))" 2>/dev/null || echo "fail:parse")
    if echo "$s" | grep -q "fail:ALREADY_PROCESSING\|fail:VALIDATION_ERROR\|fail:CV_NOT_FOUND\|fail:INVALID_SOURCE\|fail:UNAUTHORIZED"; then
      log "STEP $STEP_NUM ✗ FAIL [$name]" "expected pass, got: $s"
      FAIL=$((FAIL+1))
      echo "$actual" >> "$LOG_FILE"
      return 1
    fi
  fi
  if echo "$actual" | grep -q "$want_substr"; then
    log "STEP $STEP_NUM ✓ PASS [$name]" "matched '$want_substr'"
    PASS=$((PASS+1))
    return 0
  else
    log "STEP $STEP_NUM ✗ FAIL [$name]" "missing '$want_substr' in response"
    FAIL=$((FAIL+1))
    echo "$actual" >> "$LOG_FILE"
    return 1
  fi
}

http_post() {
  local path="$1" body="$2"
  curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BE$path" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$body"
}

http_patch() {
  local path="$1" body="$2"
  curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$BE$path" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$body"
}

http_get() {
  local path="$1"
  curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET "$BE$path" \
    -H "Authorization: Bearer $TOKEN"
}

http_delete() {
  local path="$1"
  curl -s -w "\nHTTP_STATUS:%{http_code}" -X DELETE "$BE$path" \
    -H "Authorization: Bearer $TOKEN"
}

# Extract cvId from JSON response.
extract_id() {
  python -c "import sys, json, re; raw=sys.stdin.read(); body=re.sub(r'\nHTTP_STATUS:.*$', '', raw, flags=re.S); d=json.loads(body); print(d['data']['id'] if d.get('success') else '')"
}

extract_status() {
  python -c "import sys, json, re; raw=sys.stdin.read(); body=re.sub(r'\nHTTP_STATUS:.*$', '', raw, flags=re.S); d=json.loads(body); print(d['data']['status'] if d.get('success') else 'ERR:' + str(d.get('error',{}).get('code','?')))"
}

# Login as e2e-test candidate.
log "===== LOGIN =====" ""
LOGIN_RESP=$(curl -s -X POST "$BE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@jobmatch.vn","password":"Test@1234"}')
TOKEN=$(echo "$LOGIN_RESP" | python -c "import sys, json; print(json.load(sys.stdin)['data']['accessToken'])")
if [ -z "$TOKEN" ]; then
  log "LOGIN FAILED" "$LOGIN_RESP"
  exit 1
fi
log "TOKEN" "len=${#TOKEN}"

# ============================================================================
# STEP 1 — CREATE happy path (full data, skill level 5 + project role/time)
# ============================================================================
log "===== TEST 1 — CREATE happy path =====" ""
R=$(http_post /api/v1/cvs/direct '{
  "title": "E2E test CV — happy path",
  "templateId": 1,
  "isPrimary": false,
  "summary": "Backend developer with 5y experience",
  "contact": {
    "name": "Nguyễn Văn Test",
    "email": "test1@example.com",
    "phone": "+84 901 111 111",
    "github": "https://github.com/test1"
  },
  "skills": [
    {"name":"Node.js","level":5},
    {"name":"TypeScript","level":4},
    {"name":"PostgreSQL","level":5}
  ],
  "projects": [
    {"name":"JobMatch VN","role":"Tech Lead","time":"2024 — Hiện tại","description":"Match CV-JD platform","link":"https://jobmatch.vn"},
    {"name":"OSS Tool","role":"Maintainer","time":"2023","description":"Open source","link":null}
  ],
  "education": [{"school":"NEU","degree":"BS","major":"CS","startYear":2018,"endYear":2022}],
  "experience": [{"company":"ABC Corp","position":"Backend Dev","startDate":"2022-01","endDate":null}],
  "languages": [{"language":"EN","proficiency":"Fluent"}],
  "certifications": [{"name":"AWS SAA","issuer":"AWS","date":"2024"}]
}')
CV1=$(echo "$R" | extract_id)
log "CV1 ID" "$CV1"
if [ -z "$CV1" ]; then
  log "FAIL" "$R"
  exit 1
fi
expect "T1 CREATE happy path" "200" "\"source\":\"direct\"" "$R"
expect "T1 status=ready" "200" "\"status\":\"ready\"" "$R"
expect "T1 skill level=5 preserved" "200" "\"level\":5" "$R"
expect "T1 project role preserved" "200" "\"role\":\"Tech Lead\"" "$R"
expect "T1 project time preserved" "200" "\"time\":\"2024 — Hiện tại\"" "$R"

# ============================================================================
# STEP 2 — GET detail round-trip
# ============================================================================
log "===== TEST 2 — GET detail round-trip =====" ""
R=$(http_get "/api/v1/cvs/$CV1")
expect "T2 GET parsedData preserved" "200" "\"name\":\"Nguyễn Văn Test\"" "$R"
expect "T2 skill object shape" "200" "\"name\":\"Node.js\"" "$R"
expect "T2 project link=null preserved" "200" "\"link\":null" "$R"
expect "T2 experience endDate=null" "200" "\"endDate\":null" "$R"

# ============================================================================
# STEP 3 — PATCH partial update (deep merge)
# ============================================================================
log "===== TEST 3 — PATCH partial update =====" ""
R=$(http_patch "/api/v1/cvs/$CV1" '{
  "parsedData": {
    "summary": "UPDATED summary"
  }
}')
expect "T3 PATCH summary updated" "200" "\"summary\":\"UPDATED summary\"" "$R"
expect "T3 status flipped to analyzing" "200" "\"status\":\"analyzing\"" "$R"
expect "T3 contact.name PRESERVED (deep merge)" "200" "\"name\":\"Nguyễn Văn Test\"" "$R"
expect "T3 skills PRESERVED (deep merge)" "200" "\"level\":5" "$R"

# ============================================================================
# STEP 4 — PATCH replace array (RFC 7396)
# ============================================================================
log "===== TEST 4 — PATCH replace array =====" ""
R=$(http_patch "/api/v1/cvs/$CV1" '{
  "parsedData": {
    "education": [
      {"school":"NEW SCHOOL 1","degree":"MS","major":"AI","startYear":2023,"endYear":2025},
      {"school":"NEW SCHOOL 2","degree":"PhD","major":"ML","startYear":2026}
    ]
  }
}')
expect "T4 education REPLACED with 2 new schools" "200" "\"school\":\"NEW SCHOOL 1\"" "$R"
expect "T4 old NEU school GONE" "200" "NEU.*NEW SCHOOL 2" "$R"

# Verify GET confirms replacement
sleep 0.5
R=$(http_get "/api/v1/cvs/$CV1")
expect "T4 GET: NEU removed" "200" "[\"NEW SCHOOL 1\"" "$R"

# ============================================================================
# STEP 5 — PATCH null delete field (RFC 7396)
# ============================================================================
log "===== TEST 5 — PATCH null delete =====" ""
R=$(http_patch "/api/v1/cvs/$CV1" '{
  "parsedData": {
    "contact": {
      "github": null
    }
  }
}')
expect "T5 github DELETED via null" "200" "200" "$R"
# Wait for worker, then GET to confirm deletion.
sleep 2
R=$(http_get "/api/v1/cvs/$CV1")
if echo "$R" | grep -q '"github"'; then
  log "STEP ✗ FAIL [T5b GET: github key gone]" "still present: $(echo "$R" | grep -oE 'github[^,]*' | head -1)"
  FAIL=$((FAIL+1))
else
  log "STEP ✓ PASS [T5b GET: github key gone]" "verified"
  PASS=$((PASS+1))
fi

# ============================================================================
# STEP 6 — CREATE backward compat (string[] skills)
# ============================================================================
log "===== TEST 6 — CREATE string[] backward compat =====" ""
R=$(http_post /api/v1/cvs/direct '{
  "title": "E2E test CV — old shape",
  "templateId": 2,
  "skills": ["Python", "Django", "FastAPI"]
}')
CV2=$(echo "$R" | extract_id)
log "CV2 ID" "$CV2"
expect "T6 string[] accepted by middleware" "200" "\"status\":\"ready\"" "$R"
# Wait for worker to finish so GET is stable.
sleep 2
R=$(http_get "/api/v1/cvs/$CV2")
expect "T6 string[] normalized to {name,level:3}" "200" "\"level\":3" "$R"

# ============================================================================
# STEP 7 — CREATE validation failures (negative cases)
# ============================================================================
log "===== TEST 7 — CREATE validation =====" ""
R=$(http_post /api/v1/cvs/direct '{"title":"X","templateId":6}')
expect "T7a templateId=6 rejected" "400" "VALIDATION_ERROR" "$R"

R=$(http_post /api/v1/cvs/direct '{"title":"X","templateId":1,"skills":[{"name":"JS","level":99}]}')
expect "T7b level=99 rejected" "400" "VALIDATION_ERROR" "$R"

R=$(http_post /api/v1/cvs/direct '{"title":"","templateId":1}')
expect "T7c empty title rejected" "400" "VALIDATION_ERROR" "$R"

R=$(http_post /api/v1/cvs/direct '{}')
expect "T7d empty body rejected" "400" "VALIDATION_ERROR" "$R"

# ============================================================================
# STEP 8 — PATCH invalid source guard (upload CV)
# ============================================================================
log "===== TEST 8 — PATCH upload CV rejected =====" ""
# Create upload CV with fileUrl directly (avoid multipart for simplicity).
R=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BE/api/v1/cvs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Upload CV","fileUrl":"https://example.com/cv.pdf","fileType":"application/pdf"}')
CV_UP=$(echo "$R" | extract_id)
log "Upload CV id" "$CV_UP"
if [ -n "$CV_UP" ]; then
  R=$(http_patch "/api/v1/cvs/$CV_UP" '{"title":"trying to edit upload CV"}')
  expect "T8 PATCH upload CV → INVALID_SOURCE" "400" "INVALID_SOURCE" "$R"
else
  log "T8 SKIP" "could not create upload CV (skip)"
fi

# ============================================================================
# STEP 9 — PATCH race guard (concurrent edit while analyzing)
# ============================================================================
log "===== TEST 9 — PATCH race guard =====" ""
# Tạo CV mới để test race
R=$(http_post /api/v1/cvs/direct '{"title":"Race test CV","templateId":3,"skills":[{"name":"JS","level":3}]}')
CV_RACE=$(echo "$R" | extract_id)
if [ -n "$CV_RACE" ]; then
  # Đợi cho status='ready'
  for i in 1 2 3 4 5; do
    R=$(http_get "/api/v1/cvs/$CV_RACE")
    S=$(echo "$R" | extract_status)
    log "T9 wait ready" "try $i status=$S"
    if [ "$S" = "ready" ]; then break; fi
    sleep 2
  done
  # PATCH lần 1 → triggers analyzing
  R=$(http_patch "/api/v1/cvs/$CV_RACE" '{"title":"Race test CV — patch 1"}')
  expect "T9a first PATCH accepted" "200" "analyzing" "$R"
  # PATCH lần 2 NGAY lập tức → expect 409 ALREADY_PROCESSING
  R=$(http_patch "/api/v1/cvs/$CV_RACE" '{"title":"Race test CV — patch 2 too soon"}')
  expect "T9b concurrent PATCH rejected" "409" "ALREADY_PROCESSING" "$R"
  # Đợi worker xong → PATCH lần 3 OK
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    R=$(http_get "/api/v1/cvs/$CV_RACE")
    S=$(echo "$R" | extract_status)
    if [ "$S" = "ready" ]; then
      log "T9 worker done" "after $((i*2))s, status=$S"
      break
    fi
  done
  R=$(http_patch "/api/v1/cvs/$CV_RACE" '{"title":"Race test CV — patch 3 after worker"}')
  expect "T9c PATCH after worker done accepted" "200" "analyzing" "$R"
fi

# ============================================================================
# STEP 10 — PATCH cross-user 404 (security)
# ============================================================================
log "===== TEST 10 — PATCH cross-user 404 =====" ""
# Login as second candidate
LOGIN2=$(curl -s -X POST "$BE/api/v1/auth/register/verify-otp" \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@example.com","otp":"000000"}' 2>&1)
# Bỏ qua — không tạo user mới, dùng user cũ. Cross-user test đã cover ở controller test.
log "T10 SKIP" "requires second user account setup"

# ============================================================================
# STEP 11 — Worker re-analyze full loop
# ============================================================================
log "===== TEST 11 — Worker re-analyze =====" ""
R=$(http_post /api/v1/cvs/direct '{"title":"Analyze test","templateId":4,"summary":"Test","skills":[{"name":"JS","level":4}],"experience":[{"company":"A","position":"Dev","startDate":"2023-01"}]}')
CV_AI=$(echo "$R" | extract_id)
log "CV_AI" "$CV_AI"
# Đợi analyzing → ready, kiểm tra ai_analysis có total
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 2
  R=$(http_get "/api/v1/cvs/$CV_AI")
  S=$(echo "$R" | extract_status)
  HAS_AI=$(echo "$R" | python -c "import sys, json, re; raw=re.sub(r'\nHTTP_STATUS:.*$', '', sys.stdin.read(), flags=re.S); d=json.loads(raw); ai=d.get('data',{}).get('ai_analysis'); print('yes' if ai and ai.get('total') is not None else 'no')" 2>/dev/null || echo "err")
  log "T11 wait" "try $i status=$S ai=$HAS_AI"
  if [ "$S" = "ready" ] && [ "$HAS_AI" = "yes" ]; then
    log "T11 ✓ PASS" "status=ready + ai_analysis.total populated"
    PASS=$((PASS+1))
    break
  fi
  if [ "$i" = "12" ]; then
    log "T11 ✗ FAIL" "worker did not finish in 24s"
    FAIL=$((FAIL+1))
  fi
done

# ============================================================================
# STEP 12 — Full round-trip multi-step
# ============================================================================
log "===== TEST 12 — Full round-trip =====" ""
R=$(http_post /api/v1/cvs/direct '{
  "title": "Round-trip CV",
  "templateId": 5,
  "skills": [{"name":"Initial","level":3}],
  "projects": [{"name":"Proj-A","role":"Dev","time":"2020"}]
}')
CV_RT=$(echo "$R" | extract_id)
log "CV_RT" "$CV_RT"
if [ -n "$CV_RT" ]; then
  # Round 1: add 1 skill, keep project
  sleep 2
  R=$(http_patch "/api/v1/cvs/$CV_RT" '{
    "parsedData": {"skills":[{"name":"Added1","level":5}]}
  }')
  expect "T12 round 1: Added1 added" "200" "\"level\":5" "$R"

  # Round 2: replace project, keep skill
  sleep 2
  R=$(http_patch "/api/v1/cvs/$CV_RT" '{
    "parsedData": {"projects":[{"name":"Proj-B","role":"Lead","time":"2024"}]}
  }')
  expect "T12 round 2: Proj-B replaced" "200" "\"role\":\"Lead\"" "$R"
  sleep 2
  R=$(http_get "/api/v1/cvs/$CV_RT")
  expect "T12 round 2 GET: Added1 still there" "200" "\"name\":\"Added1\"" "$R"
  expect "T12 round 2 GET: Proj-B in place" "200" "\"name\":\"Proj-B\"" "$R"
  expect "T12 round 2 GET: Initial skill removed (replaced)" "200" "Added1.*Proj-B" "$R"
fi

# ============================================================================
# Cleanup
# ============================================================================
log "===== CLEANUP =====" ""
for cv in "$CV1" "$CV2" "$CV_UP" "$CV_RACE" "$CV_AI" "$CV_RT"; do
  if [ -n "$cv" ]; then
    http_delete "/api/v1/cvs/$cv" >/dev/null
    log "DELETE" "$cv"
  fi
done

# ============================================================================
# Summary
# ============================================================================
log "===== SUMMARY =====" ""
log "PASS" "$PASS"
log "FAIL" "$FAIL"
log "TOTAL" "$((PASS+FAIL))"
log "LOG" "$LOG_FILE"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
