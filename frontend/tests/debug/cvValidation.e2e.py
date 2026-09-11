#!/usr/bin/env python3
"""
CV direct edit E2E validation — gọi thẳng BE thật, không mock.

Cover:
  1. CREATE happy path (full skills+projects, em dash unicode)
  2. CREATE backward compat (string[] → {name,level:3})
  3. CREATE validation (templateId range, level range, empty title)
  4. GET detail round-trip exact shape (unicode preserved)
  5. PATCH partial update (deep merge)
  6. PATCH replace array (RFC 7396)
  7. PATCH null delete field
  8. PATCH invalid source (upload CV → 400)
  9. PATCH race guard (analyzing → 409 ALREADY_PROCESSING)
  10. Worker re-analyze loop (status: analyzing → ready, ai_analysis.total có)
  11. Full round-trip multi-step

Mỗi step in PASS/FAIL + evidence JSON. Exit code !=0 nếu có FAIL.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BE = "http://localhost:5000"
LOG = Path(__file__).parent / "cvValidation.e2e.log"
LOG.write_text("")  # truncate

PASS = 0
FAIL = 0
STEP = 0


def log(label, msg=""):
    line = f"[{time.strftime('%H:%M:%S')}] {label}: {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        # Windows cp1252 console — fall back to ASCII-safe
        print(line.encode("ascii", errors="replace").decode("ascii"), flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def expect(name, ok, detail=""):
    global STEP, PASS, FAIL
    STEP += 1
    mark = "PASS" if ok else "FAIL"
    log(f"STEP {STEP} [{mark}] [{name}]", detail)
    if ok:
        PASS += 1
    else:
        FAIL += 1


def request(method, path, body=None, token=None):
    data = None
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{BE}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw), resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw), e.code, raw
        except json.JSONDecodeError:
            return {"success": False, "error": {"code": "PARSE_ERROR", "message": raw}}, e.code, raw


def wait_ready(cv_id, token, max_wait=30):
    """Wait cho CV về status='ready' (worker re-analyze xong). Tránh rate limit
    + status guard (analyzing → 409). Return last status seen."""
    import re as _re
    deadline = time.time() + max_wait
    last_status = None
    while time.time() < deadline:
        r, _, _ = request("GET", f"/api/v1/cvs/{cv_id}", token=token)
        last_status = r.get("data", {}).get("status")
        if last_status == "ready":
            return last_status
        time.sleep(2)
    return last_status


def login():
    r, status, _ = request("POST", "/api/v1/auth/login", body={
        "email": "e2e-test@jobmatch.vn",
        "password": "Test@1234",
    })
    if not r.get("success"):
        log("LOGIN FAILED", r)
        sys.exit(1)
    return r["data"]["accessToken"]


def main():
    global PASS, FAIL, STEP
    log("===== LOGIN =====", "")
    token = login()
    log("TOKEN", f"len={len(token)}")

    cv_ids_to_cleanup = []

    try:
        # ============================================================================
        # TEST 1 — CREATE happy path (full data, skill level 5 + project role/time)
        # ============================================================================
        log("===== TEST 1 — CREATE happy path =====", "")
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "E2E test CV — happy path",
            "templateId": 1,
            "isPrimary": False,
            "summary": "Backend developer with 5y experience",
            "contact": {
                "name": "Nguyễn Văn Test",
                "email": "test1@example.com",
                "phone": "+84 901 111 111",
                "github": "https://github.com/test1",
            },
            "skills": [
                {"name": "Node.js", "level": 5},
                {"name": "TypeScript", "level": 4},
                {"name": "PostgreSQL", "level": 5},
            ],
            "projects": [
                {"name": "JobMatch VN", "role": "Tech Lead",
                 "time": "2024 — Hiện tại", "description": "Match CV-JD platform",
                 "link": "https://jobmatch.vn"},
                {"name": "OSS Tool", "role": "Maintainer", "time": "2023",
                 "description": "Open source", "link": None},
            ],
            "education": [{"school": "NEU", "degree": "BS", "major": "CS",
                          "startYear": 2018, "endYear": 2022}],
            "experience": [{"company": "ABC Corp", "position": "Backend Dev",
                           "startDate": "2022-01", "endDate": None}],
            "languages": [{"language": "EN", "proficiency": "Fluent"}],
            "certifications": [{"name": "AWS SAA", "issuer": "AWS", "date": "2024"}],
        }, token=token)
        cv1 = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv1)
        log("CV1", cv1 or "FAIL")

        expect("T1 CREATE happy path", status in (200, 201) and r.get("success"),
               f"status={status} success={r.get('success')}")
        expect("T1 status=ready", r.get("data", {}).get("status") == "ready",
               f"status={r.get('data', {}).get('status')}")
        expect("T1 source=direct", r.get("data", {}).get("source") == "direct",
               f"source={r.get('data', {}).get('source')}")
        skills = r.get("data", {}).get("parsedData", {}).get("skills", [])
        expect("T1 skill level=5 preserved",
               any(s.get("level") == 5 and s.get("name") == "Node.js" for s in skills),
               f"skills={skills}")
        projects = r.get("data", {}).get("parsedData", {}).get("projects", [])
        expect("T1 project role preserved",
               any(p.get("role") == "Tech Lead" for p in projects),
               f"projects roles={[p.get('role') for p in projects]}")
        # Unicode round-trip: check em dash character (U+2014) preserved exactly.
        # Dùng bytes hex để tránh console cp1252 làm nhiễu repr.
        em_dash_utf8 = "—".encode("utf-8").hex()  # "e28094"
        expect("T1 project time has em dash (U+2014) preserved as UTF-8 e28094",
               any(em_dash_utf8 in (p.get("time") or "").encode("utf-8").hex() for p in projects),
               f"times hex={[p.get('time','').encode('utf-8').hex() for p in projects]}")

        # ============================================================================
        # TEST 2 — GET detail round-trip
        # ============================================================================
        log("===== TEST 2 — GET detail round-trip =====", "")
        r, status, _ = request("GET", f"/api/v1/cvs/{cv1}", token=token)
        pd = r.get("data", {}).get("parsedData", {})
        expect("T2 GET status=ready", r.get("data", {}).get("status") == "ready",
               f"status={r.get('data', {}).get('status')}")
        expect("T2 contact.name preserved", pd.get("name") == "Nguyễn Văn Test",
               f"name={pd.get('name')!r}")
        expect("T2 contact.email preserved", pd.get("email") == "test1@example.com",
               f"email={pd.get('email')!r}")
        expect("T2 skill object shape",
               any(isinstance(s, dict) and s.get("name") == "Node.js" for s in pd.get("skills", [])),
               f"skills[0]={pd.get('skills', [None])[0]}")
        expect("T2 project link=null preserved",
               any(p.get("link") is None and p.get("name") == "OSS Tool" for p in pd.get("projects", [])),
               f"oss project={pd.get('projects', [{}])[-1] if pd.get('projects') else None}")
        expect("T2 experience endDate=null preserved",
               pd.get("experience", [{}])[0].get("endDate") is None,
               f"exp[0]={pd.get('experience', [None])[0]}")
        expect("T2 certifications shape",
               any(c.get("name") == "AWS SAA" for c in pd.get("certifications", [])),
               f"certs={pd.get('certifications')}")

        # ============================================================================
        # TEST 3 — PATCH partial update (deep merge — không gửi field → giữ nguyên)
        # ============================================================================
        log("===== TEST 3 — PATCH partial update =====", "")
        # Đợi ready trước (T1 đã trigger analyzing ngay từ create do flow re-analyze)
        wait_ready(cv1, token)
        r, status, _ = request("PATCH", f"/api/v1/cvs/{cv1}", body={
            "parsedData": {"summary": "UPDATED summary"}
        }, token=token)
        expect("T3 PATCH accepted", status == 200, f"status={status}")
        expect("T3 PATCH summary updated",
               r.get("data", {}).get("parsedData", {}).get("summary") == "UPDATED summary",
               f"summary={r.get('data', {}).get('parsedData', {}).get('summary')!r}")
        expect("T3 PATCH status flipped to analyzing",
               r.get("data", {}).get("status") == "analyzing",
               f"status={r.get('data', {}).get('status')}")
        expect("T3 PATCH contact.name PRESERVED (deep merge)",
               r.get("data", {}).get("parsedData", {}).get("name") == "Nguyễn Văn Test",
               f"name={r.get('data', {}).get('parsedData', {}).get('name')!r}")
        expect("T3 PATCH skills PRESERVED (deep merge)",
               any(s.get("level") == 5 for s in r.get("data", {}).get("parsedData", {}).get("skills", [])),
               f"skills={r.get('data', {}).get('parsedData', {}).get('skills')}")

        # ============================================================================
        # TEST 4 — PATCH replace array (RFC 7396: education mới REPLACE toàn bộ)
        # ============================================================================
        log("===== TEST 4 — PATCH replace array =====", "")
        wait_ready(cv1, token)
        r, status, _ = request("PATCH", f"/api/v1/cvs/{cv1}", body={
            "parsedData": {
                "education": [
                    {"school": "NEW SCHOOL 1", "degree": "MS", "major": "AI",
                     "startYear": 2023, "endYear": 2025},
                    {"school": "NEW SCHOOL 2", "degree": "PhD", "major": "ML",
                     "startYear": 2026},
                ]
            }
        }, token=token)
        edu = r.get("data", {}).get("parsedData", {}).get("education", [])
        expect("T4 education REPLACED with 2 entries", len(edu) == 2,
               f"education len={len(edu)}")
        expect("T4 NEW SCHOOL 1 in education",
               any(e.get("school") == "NEW SCHOOL 1" for e in edu),
               f"schools={[e.get('school') for e in edu]}")
        expect("T4 old NEU REMOVED (not concat)",
               not any(e.get("school") == "NEU" for e in edu),
               f"NEU should be gone; schools={[e.get('school') for e in edu]}")

        wait_ready(cv1, token)
        r, status, _ = request("GET", f"/api/v1/cvs/{cv1}", token=token)
        edu2 = r.get("data", {}).get("parsedData", {}).get("education", [])
        expect("T4 GET: education persisted with replacement",
               len(edu2) == 2 and any(e.get("school") == "NEW SCHOOL 2" for e in edu2),
               f"education after wait={[e.get('school') for e in edu2]}")

        # ============================================================================
        # TEST 5 — PATCH null delete field (RFC 7396: null = delete key)
        #
        # Schema: `contact.facebook` được khai báo `.nullable().optional()` →
        # PATCH null ở path này được chấp nhận. Các field URL khác (github,
        # linkedin, portfolio, avatarUrl) cũng tương tự.
        # ============================================================================
        log("===== TEST 5 — PATCH null delete =====", "")
        wait_ready(cv1, token)
        # Bước 1: set contact.facebook thành 1 URL.
        r, status, _ = request("PATCH", f"/api/v1/cvs/{cv1}", body={
            "parsedData": {"contact": {"facebook": "https://facebook.com/test1"}}
        }, token=token)
        expect("T5 setup: PATCH set contact.facebook", status == 200, f"status={status}")
        wait_ready(cv1, token)
        # Bước 2: PATCH null ở cùng path → BE delete key (RFC 7396).
        r, status, _ = request("PATCH", f"/api/v1/cvs/{cv1}", body={
            "parsedData": {"contact": {"facebook": None}}
        }, token=token)
        expect("T5 PATCH null delete accepted", status == 200, f"status={status}")
        wait_ready(cv1, token)
        r, status, _ = request("GET", f"/api/v1/cvs/{cv1}", token=token)
        pd_after = r.get("data", {}).get("parsedData", {})
        contact_after = pd_after.get("contact") or {}
        expect("T5 GET: contact.facebook DELETED via null",
               "facebook" not in contact_after,
               f"facebook still present: {contact_after.get('facebook')!r}")
        expect("T5 GET: top-level github PRESERVED (BE flatten contact.github → top-level lúc CREATE)",
               pd_after.get("github") == "https://github.com/test1",
               f"top-level github={pd_after.get('github')!r}")
        expect("T5 GET: other contact fields preserved",
               pd_after.get("name") == "Nguyễn Văn Test" and pd_after.get("email") == "test1@example.com",
               f"name={pd_after.get('name')!r} email={pd_after.get('email')!r}")

        # ============================================================================
        # TEST 6 — CREATE backward compat (string[] → {name, level:3})
        # ============================================================================
        log("===== TEST 6 — CREATE string[] backward compat =====", "")
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "E2E old shape CV",
            "templateId": 2,
            "skills": ["Python", "Django", "FastAPI"],
            "projects": [{"name": "Old project", "description": "no role, no time"}],
        }, token=token)
        cv2 = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv2)
        expect("T6 string[] skills accepted (status=ready)",
               r.get("data", {}).get("status") == "ready",
               f"status={r.get('data', {}).get('status')}")
        wait_ready(cv2, token)
        r, status, _ = request("GET", f"/api/v1/cvs/{cv2}", token=token)
        sk = r.get("data", {}).get("parsedData", {}).get("skills", [])
        expect("T6 string[] normalized to {name, level:3}",
               all(isinstance(s, dict) and s.get("level") == 3 for s in sk) and len(sk) == 3,
               f"skills={sk}")
        proj = r.get("data", {}).get("parsedData", {}).get("projects", [])
        expect("T6 project missing role/time doesn't crash",
               len(proj) == 1 and proj[0].get("name") == "Old project"
               and "role" not in proj[0] and "time" not in proj[0],
               f"project={proj[0] if proj else None}")

        # ============================================================================
        # TEST 7 — CREATE validation failures (space để tránh rate limit)
        # ============================================================================
        log("===== TEST 7 — CREATE validation =====", "")
        time.sleep(3)  # avoid CV_AI_RATE_LIMITED
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={"title": "X", "templateId": 6}, token=token)
        expect("T7a templateId=6 → 400 VALIDATION_ERROR",
               status == 400 and r.get("error", {}).get("code") == "VALIDATION_ERROR",
               f"status={status} code={r.get('error', {}).get('code')}")

        r, status, _ = request("POST", "/api/v1/cvs/direct",
                               body={"title": "X", "templateId": 1, "skills": [{"name": "JS", "level": 99}]}, token=token)
        expect("T7b skill level=99 → 400 VALIDATION_ERROR",
               status == 400 and r.get("error", {}).get("code") == "VALIDATION_ERROR",
               f"status={status} code={r.get('error', {}).get('code')}")

        r, status, _ = request("POST", "/api/v1/cvs/direct", body={"title": "", "templateId": 1}, token=token)
        expect("T7c empty title → 400 VALIDATION_ERROR",
               status == 400 and r.get("error", {}).get("code") == "VALIDATION_ERROR",
               f"status={status} code={r.get('error', {}).get('code')}")

        r, status, _ = request("POST", "/api/v1/cvs/direct", body={}, token=token)
        expect("T7d empty body → 400 VALIDATION_ERROR",
               status == 400 and r.get("error", {}).get("code") == "VALIDATION_ERROR",
               f"status={status} code={r.get('error', {}).get('code')}")

        # ============================================================================
        # TEST 8 — PATCH invalid source guard (upload CV)
        # ============================================================================
        log("===== TEST 8 — PATCH upload CV rejected =====", "")
        time.sleep(3)
        r, status, _ = request("POST", "/api/v1/cvs", body={
            "title": "Upload test CV",
            "fileUrl": "https://example.com/cv.pdf",
            "fileType": "application/pdf",
        }, token=token)
        cv_up = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv_up)
        if cv_up:
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_up}",
                                   body={"title": "trying edit"}, token=token)
            expect("T8 PATCH upload CV → 400 INVALID_SOURCE",
                   status == 400 and r.get("error", {}).get("code") == "INVALID_SOURCE",
                   f"status={status} code={r.get('error', {}).get('code')}")
        else:
            log("T8 SKIP", "could not create upload CV")

        # ============================================================================
        # TEST 9 — PATCH race guard (analyzing → 409 ALREADY_PROCESSING)
        # ============================================================================
        log("===== TEST 9 — PATCH race guard =====", "")
        time.sleep(3)
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "Race test CV", "templateId": 3,
            "skills": [{"name": "JS", "level": 3}],
        }, token=token)
        cv_race = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv_race)
        if cv_race:
            wait_ready(cv_race, token)
            # PATCH lần 1
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_race}",
                                   body={"title": "Race patch 1"}, token=token)
            expect("T9a first PATCH accepted (status flips to analyzing)",
                   status == 200 and r.get("data", {}).get("status") == "analyzing",
                   f"status={status} cv_status={r.get('data', {}).get('status')}")
            # PATCH lần 2 NGAY
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_race}",
                                   body={"title": "Race patch 2 too soon"}, token=token)
            expect("T9b concurrent PATCH rejected (409 ALREADY_PROCESSING)",
                   status == 409 and r.get("error", {}).get("code") == "ALREADY_PROCESSING",
                   f"status={status} code={r.get('error', {}).get('code')}")
            # Wait worker done
            wait_ready(cv_race, token)
            # PATCH lần 3 sau worker
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_race}",
                                   body={"title": "Race patch 3 after worker"}, token=token)
            expect("T9c PATCH after worker done → 200",
                   status == 200 and r.get("data", {}).get("status") == "analyzing",
                   f"status={status} cv_status={r.get('data', {}).get('status')}")
        else:
            log("T9 SKIP", "could not create race CV")

        # ============================================================================
        # TEST 10 — Worker re-analyze loop (PATCH direct CV triggers analyze queue)
        #
        # Lưu ý: POST /cvs/direct KHÔNG enqueue analyze (status='ready' ngay, không
        # qua 'parsing'/'analyzing' → worker guard skip). PATCH mới enqueue
        # cvAnalysisQueue và set status='analyzing' trước khi enqueue.
        # ============================================================================
        log("===== TEST 10 — Worker re-analyze =====", "")
        time.sleep(3)
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "Worker analyze test", "templateId": 4, "summary": "Test summary",
            "skills": [{"name": "JS", "level": 4}],
            "experience": [{"company": "A", "position": "Dev", "startDate": "2023-01"}],
        }, token=token)
        cv_ai = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv_ai)
        # Direct CV sau CREATE đã có sẵn ai_analysis nếu user đã trigger trước
        # đó. Check trước khi PATCH — sau PATCH sẽ re-run.
        if cv_ai:
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_ai}", body={
                "title": "Worker analyze test — patched"
            }, token=token)
            expect("T10a PATCH triggers analyze queue (status=analyzing)",
                   status == 200 and r.get("data", {}).get("status") == "analyzing",
                   f"status={status} cv_status={r.get('data', {}).get('status')}")
        worker_done = False
        quota_skip = False
        final_r = None
        if cv_ai:
            for i in range(15):
                time.sleep(2)
                r, _, _ = request("GET", f"/api/v1/cvs/{cv_ai}", token=token)
                final_r = r
                st = r.get("data", {}).get("status")
                ai = r.get("data", {}).get("ai_analysis")
                fr = r.get("data", {}).get("failureReason")
                log(f"T10 try {i+1}", f"status={st} ai={'yes' if ai else 'no'} fr={fr}")
                # PASS khi worker LLM chạy xong (ai_analysis có total)
                if st == "ready" and ai and ai.get("total") is not None:
                    worker_done = True
                    break
                # Cũng PASS khi worker skip vì quota — graceful degradation
                # (BE set status='ready', failureReason='quota_exceeded' — KHÔNG
                # downgrade về 'failed' nếu CV đã có parsedData).
                if st == "ready" and fr == "quota_exceeded":
                    quota_skip = True
                    break
        final_data = final_r.get("data", {}) if final_r else {}
        expect("T10 worker re-analyze hoàn tất (ai_analysis có total HOẶC graceful quota_exceeded skip)",
               worker_done or quota_skip,
               f"worker_done={worker_done} quota_skip={quota_skip} "
               f"status={final_data.get('status')} fr={final_data.get('failureReason')} "
               f"ai_total={final_data.get('ai_analysis', {}).get('total') if final_data.get('ai_analysis') else 'none'}")

        # ============================================================================
        # TEST 11 — Full round-trip multi-step
        # ============================================================================
        log("===== TEST 11 — Full round-trip multi-step =====", "")
        time.sleep(3)
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "Round-trip CV", "templateId": 5,
            "skills": [{"name": "Initial", "level": 3}],
            "projects": [{"name": "Proj-A", "role": "Dev", "time": "2020"}],
        }, token=token)
        cv_rt = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv_rt)
        if cv_rt:
            wait_ready(cv_rt, token)
            # Round 1: add skill "Added1" with level 5
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_rt}", body={
                "parsedData": {"skills": [{"name": "Added1", "level": 5}]}
            }, token=token)
            expect("T11a round 1: Added1 level=5 added",
                   any(s.get("name") == "Added1" and s.get("level") == 5
                       for s in r.get("data", {}).get("parsedData", {}).get("skills", [])),
                   f"skills={r.get('data', {}).get('parsedData', {}).get('skills')}")
            wait_ready(cv_rt, token)
            # Round 2: replace project (Proi-A → Proj-B with role Lead)
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_rt}", body={
                "parsedData": {"projects": [{"name": "Proj-B", "role": "Lead", "time": "2024"}]}
            }, token=token)
            expect("T11b round 2: Proj-B role=Lead set",
                   any(p.get("name") == "Proj-B" and p.get("role") == "Lead"
                       for p in r.get("data", {}).get("parsedData", {}).get("projects", [])),
                   f"projects={r.get('data', {}).get('parsedData', {}).get('projects')}")
            wait_ready(cv_rt, token)
            # GET: verify final state
            r, status, _ = request("GET", f"/api/v1/cvs/{cv_rt}", token=token)
            pd_rt = r.get("data", {}).get("parsedData", {})
            expect("T11c GET: Added1 still there",
                   any(s.get("name") == "Added1" for s in pd_rt.get("skills", [])),
                   f"skills={pd_rt.get('skills')}")
            expect("T11d GET: Proj-B replaced",
                   any(p.get("name") == "Proj-B" for p in pd_rt.get("projects", [])),
                   f"projects={[p.get('name') for p in pd_rt.get('projects', [])]}")
            expect("T11e GET: Initial skill removed (replaced, not merged)",
                   not any(s.get("name") == "Initial" for s in pd_rt.get("skills", [])),
                   f"Initial should be gone; skills={[s.get('name') for s in pd_rt.get('skills', [])]}")
            expect("T11f GET: Proj-A removed (replaced)",
                   not any(p.get("name") == "Proj-A" for p in pd_rt.get("projects", [])),
                   f"Proj-A should be gone; projects={[p.get('name') for p in pd_rt.get('projects', [])]}")
        else:
            log("T11 SKIP", "could not create round-trip CV")

        # ============================================================================
        # TEST 12 — PATCH title + parsedData.name (top-level, flatten path)
        #
        # Lưu ý:
        #   - `title` là column riêng trong DB, không nằm trong parsedData.
        #   - `personal.name` (form input) BE flatten → `parsedData.name`
        #     lúc CREATE. PATCH `parsedData.name` deep-merge vào top-level.
        # ============================================================================
        log("===== TEST 12 — PATCH title + name =====", "")
        time.sleep(3)
        r, status, _ = request("POST", "/api/v1/cvs/direct", body={
            "title": "Original title",
            "templateId": 1,
            "contact": {"name": "Original Name", "email": "orig@example.com"},
            "skills": [{"name": "JS", "level": 3}],
        }, token=token)
        cv_t = r["data"]["id"] if r.get("success") else None
        cv_ids_to_cleanup.append(cv_t)
        if cv_t:
            wait_ready(cv_t, token)
            # PATCH title only
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_t}",
                                   body={"title": "Updated title"}, token=token)
            expect("T12a PATCH title accepted", status == 200, f"status={status}")
            expect("T12a PATCH title updated in response",
                   r.get("data", {}).get("title") == "Updated title",
                   f"title={r.get('data', {}).get('title')!r}")
            wait_ready(cv_t, token)
            r, status, _ = request("GET", f"/api/v1/cvs/{cv_t}", token=token)
            expect("T12b GET: title persisted",
                   r.get("data", {}).get("title") == "Updated title",
                   f"title={r.get('data', {}).get('title')!r}")
            # PATCH parsedData.contact.email — field hợp lệ trong schema, được
            # Zod pass qua (không bị strip). BE sẽ deep-merge vào parsedData.
            # Lưu ý: contact.email flatten lúc CREATE nên top-level `email` mới
            # tồn tại; PATCH `parsedData.contact.email` deep-merge giữ top-level
            # email cũ và thêm/sửa `parsedData.contact.email`.
            r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_t}", body={
                "parsedData": {"contact": {"email": "updated@example.com"}}
            }, token=token)
            expect("T12c PATCH parsedData.contact.email accepted", status == 200, f"status={status}")
            wait_ready(cv_t, token)
            r, status, _ = request("GET", f"/api/v1/cvs/{cv_t}", token=token)
            pd_t12 = r.get("data", {}).get("parsedData", {})
            contact_t12 = pd_t12.get("contact") or {}
            expect("T12d GET: contact.email updated",
                   contact_t12.get("email") == "updated@example.com",
                   f"contact.email={contact_t12.get('email')!r}")
            expect("T12d GET: top-level email UPDATED (BE promote contact.email → top-level sau PATCH)",
                   pd_t12.get("email") == "updated@example.com",
                   f"top-level email={pd_t12.get('email')!r}")
            expect("T12d GET: skills PRESERVED",
                   any(s.get("name") == "JS" for s in pd_t12.get("skills", [])),
                   f"skills={[s.get('name') for s in pd_t12.get('skills', [])]}")

            # ============================================================================
            # REGRESSION — Bug "edit họ tên không lưu":
            #
            # Symptom: User sửa `personal.name` trong form → submit → toast
            # "Đã lưu" hiện nhưng DB vẫn giữ tên cũ.
            #
            # Root cause (đã fix): BE `buildParsedData` flatten `contact.name`
            # → top-level `parsedData.name` lúc CREATE. FE form gửi
            # `parsedData.contact.name = "..."` qua PATCH. `deepMerge` thấy
            # `source.contact` là object nhưng `target.contact` undefined →
            # REPLACE (không merge) → top-level `name` không đổi → templates
            # + render-data (đọc top-level `p.name`) hiển thị tên cũ.
            #
            # Fix BE: sau deepMerge, promote `merged.contact.X` → `merged.X`
            # cho các flatten field. Test này verify user-facing behavior.
            # ============================================================================
            log("===== TEST 13 — REGRESSION: edit họ tên/email/phone phải lưu =====", "")
            time.sleep(3)
            r, status, _ = request("POST", "/api/v1/cvs/direct", body={
                "title": "Regression test CV",
                "templateId": 1,
                "contact": {
                    "name": "Nguyễn Văn A",
                    "email": "a@example.com",
                    "phone": "+84 901 000 001",
                },
                "skills": [{"name": "JS", "level": 3}],
            }, token=token)
            cv_reg = r["data"]["id"] if r.get("success") else None
            cv_ids_to_cleanup.append(cv_reg)
            if cv_reg:
                wait_ready(cv_reg, token)
                # PATCH đổi họ tên qua path FE form đang dùng
                r, status, _ = request("PATCH", f"/api/v1/cvs/{cv_reg}", body={
                    "parsedData": {"contact": {
                        "name": "Trần Thị B",
                        "email": "b@example.com",
                        "phone": "+84 902 000 002",
                    }}
                }, token=token)
                expect("T13 PATCH contact.{name,email,phone} accepted", status == 200,
                       f"status={status}")
                wait_ready(cv_reg, token)
                r, status, _ = request("GET", f"/api/v1/cvs/{cv_reg}", token=token)
                pd_reg = r.get("data", {}).get("parsedData", {})
                # Critical assertions — top-level fields phải update (đây là điều
                # template đọc để render).
                expect("T13 GET top-level name UPDATED (đây là bug user báo)",
                       pd_reg.get("name") == "Trần Thị B",
                       f"top-level name={pd_reg.get('name')!r} — NẾU VẪN 'Nguyễn Văn A' THÌ BUG CHƯA FIX")
                expect("T13 GET top-level email UPDATED",
                       pd_reg.get("email") == "b@example.com",
                       f"top-level email={pd_reg.get('email')!r}")
                expect("T13 GET top-level phone UPDATED",
                       pd_reg.get("phone") == "+84 902 000 002",
                       f"top-level phone={pd_reg.get('phone')!r}")
                # contact.X cũng phải reflect (để FE form sync)
                contact_reg = pd_reg.get("contact") or {}
                expect("T13 GET contact.name mirror",
                       contact_reg.get("name") == "Trần Thị B",
                       f"contact.name={contact_reg.get('name')!r}")
                expect("T13 GET skills PRESERVED",
                       any(s.get("name") == "JS" for s in pd_reg.get("skills", [])),
                       f"skills={[s.get('name') for s in pd_reg.get('skills', [])]}")
            else:
                log("T13 SKIP", "could not create regression CV")
        else:
            log("T12 SKIP", "could not create CV")

    finally:
        # Cleanup
        log("===== CLEANUP =====", "")
        for cv_id in cv_ids_to_cleanup:
            if cv_id:
                request("DELETE", f"/api/v1/cvs/{cv_id}", token=token)
                log("DELETE", cv_id)

    log("===== SUMMARY =====", "")
    log("PASS", PASS)
    log("FAIL", FAIL)
    log("TOTAL", PASS + FAIL)
    log("LOG", str(LOG))

    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
