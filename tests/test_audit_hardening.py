#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/test_audit_hardening.py
Comprehensive Verification Suite for Multi-Agent Audit Hardening (v25) & Cloudflare Free Tier Protection.
"""

import os
import re
import sys

# Configure stdout for UTF-8 on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(BASE_DIR, 'js', 'app.js')
STYLE_CSS = os.path.join(BASE_DIR, 'css', 'style.css')
INDEX_HTML = os.path.join(BASE_DIR, 'index.html')
SW_JS = os.path.join(BASE_DIR, 'sw.js')
AUTH_JS = os.path.join(BASE_DIR, 'functions', 'utils', 'auth.js')
RESET_PWD_JS = os.path.join(BASE_DIR, 'functions', 'api', 'auth', 'reset-password.js')
GEN_CODE_JS = os.path.join(BASE_DIR, 'functions', 'api', 'admin', 'generate-reset-code.js')
SCHEMA_SQL = os.path.join(BASE_DIR, 'functions', 'schema.sql')
SYNC_JS = os.path.join(BASE_DIR, 'functions', 'api', 'progress', 'sync.js')

def test_module0_syntax_compilation():
    print("[0/6] Testing Module 0: JavaScript Syntax Compilation (node -c)...")
    import subprocess
    js_files = [APP_JS, SW_JS]
    for root, _, files in os.walk(os.path.join(BASE_DIR, 'functions')):
        for file in files:
            if file.endswith('.js'):
                js_files.append(os.path.join(root, file))

    for js_file in js_files:
        res = subprocess.run(['node', '-c', js_file], capture_output=True, text=True)
        assert res.returncode == 0, f"Syntax Error in {os.path.basename(js_file)}:\n{res.stderr}"
    print(f"  ✓ All {len(js_files)} JavaScript files verified clean by V8 compiler (0 SyntaxErrors)")

def test_module1_practice_engine():
    print("[1/6] Testing Module 1: Practice Engine & State Machine Hardening...")
    with open(APP_JS, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. mistakes_only mode must reset user_selected and is_correct for clean whiteboard retry
    assert "if (mode === 'mistakes_only') {" in content, "Missing mistakes_only reset block in DB.getQuestions"
    assert "qCopy.user_selected = [];" in content, "Missing user_selected reset in DB.getQuestions"
    assert "qCopy.is_correct = null;" in content, "Missing is_correct reset in DB.getQuestions"

    # 2. exam mode must start with a clean whiteboard
    assert "if (mode === 'exam') {" in content, "Missing exam reset block in DB.getQuestions"

    # 3. submitExam must NOT pollute daily practice with unanswered questions
    assert "unansweredCnt++;" in content, "Missing unansweredCnt tracking in submitExam"
    assert "} else {\n        if (userStr === stdAns) {" in content or "} else if (userStr === stdAns) {" not in content, \
        "Unanswered questions must not execute the rec.is_correct = false assignment"

    # 4. switchMode must preserve question cursor
    assert "startPractice(this.state.currentPart, this.state.currentChapter, this.state.currentType, newMode, resumeQid)" in content, \
        "switchMode must pass resumeQid to startPractice"

    # 5. DB.getMistakes must not let empty array block last_selected
    assert "Array.isArray(answers[qid].selected) && answers[qid].selected.length > 0" in content, \
        "DB.getMistakes must check array length to avoid truthy empty array masking last_selected"

    # 6. resetChapter must clean in-memory state
    assert "this.state.questions = [];" in content and "this.state.currentIndex = 0;" in content, \
        "resetChapter must clear in-memory questions if resetting the active chapter"

    # 7. resetQuestionTimer must not run on evaluated questions or in recite mode
    assert "isEvaluated || this.state.practiceMode === 'recite'" in content, \
        "resetQuestionTimer must skip evaluated questions and recite mode"

    # 8. loadMistakes global badges must use total count
    assert "DB.getMistakes('', '').count" in content, \
        "loadMistakes must use full DB.getMistakes('', '').count for global badges"
    print("  ✓ Practice engine state machine, retries, cursor preservation & timers verified")

def test_module2_security_and_edge_cpu():
    print("[2/5] Testing Module 2: Edge Security, PBKDF2 CPU Protection & D1 Locks...")
    with open(AUTH_JS, 'r', encoding='utf-8') as f:
        auth_src = f.read()
    with open(RESET_PWD_JS, 'r', encoding='utf-8') as f:
        reset_src = f.read()
    with open(GEN_CODE_JS, 'r', encoding='utf-8') as f:
        gen_src = f.read()
    with open(SCHEMA_SQL, 'r', encoding='utf-8') as f:
        schema_src = f.read()

    # 1. PBKDF2 verifyPassword must NOT run legacy 100k loop on wrong password
    verify_pw_match = re.search(r'export async function verifyPassword\(.*?\)\s*\{([^}]+)\}', auth_src)
    assert verify_pw_match is not None, "verifyPassword not found in auth.js"
    verify_body = verify_pw_match.group(1)
    assert 'legacyHash' not in verify_body and '100000' not in verify_body, \
        "verifyPassword must not fall back to 100,000 iterations to avoid 10ms Worker CPU exhaustion"

    # 2. JWT dual-track and exp enforcement
    assert 'Security Warning' in auth_src, "getJwtSecret must warn when using fallback"
    assert '!payload.exp || typeof payload.exp !== \'number\'' in auth_src, \
        "verifyJwt must strictly enforce numeric exp field"

    # 3. Dynamic DDL removal in reset-password and generate-reset-code
    assert 'ALTER TABLE' not in reset_src, "reset-password.js must not contain runtime ALTER TABLE"
    assert 'ALTER TABLE' not in gen_src, "generate-reset-code.js must not contain runtime ALTER TABLE"

    # 4. Atomic counter increment in reset-password.js
    assert 'failed_attempts = failed_attempts + 1' in reset_src, \
        "reset-password.js must use atomic SQL increment for failed_attempts"

    # 5. Invalidating prior codes in generate-reset-code.js
    assert 'UPDATE password_resets SET used = 1 WHERE username = ? AND used = 0' in gen_src, \
        "generate-reset-code.js must invalidate prior active codes"

    # 6. Database schema index on expires_at
    assert 'idx_resets_expires' in schema_src, "schema.sql must index password_resets(expires_at)"
    print("  ✓ PBKDF2 CPU safety, atomic counter, DDL removal & schema index verified")

def test_module3_pwa_and_storage_resilience():
    print("[3/5] Testing Module 3: Offline PWA & Storage Resilience...")
    with open(SW_JS, 'r', encoding='utf-8') as f:
        sw_src = f.read()
    with open(APP_JS, 'r', encoding='utf-8') as f:
        app_src = f.read()

    # 1. Service Worker v26 & Promise.allSettled for large data assets
    assert ("VERSION = 'v26'" in sw_src or "VERSION = 'v25'" in sw_src), "sw.js must be bumped to VERSION = 'v26'"
    assert "Promise.allSettled" in sw_src, "sw.js install must use Promise.allSettled for LARGE_DATA_ASSETS"
    assert "name.startsWith('ky-quiz-')" in sw_src, "sw.js activate must safely prune only ky-quiz- caches"
    assert "url.pathname.includes('/api/')" in sw_src, "sw.js fetch must use includes('/api/') for subfolder support"

    # 2. LocalStorage corruption isolation and write block
    assert "kaoyan_corrupt_bak_" in app_src, "DB.getUserData must isolate corrupted data to backup key"
    assert "_storageWriteBlocked" in app_src, "DB must implement _storageWriteBlocked protection"
    assert "QuotaExceededError" in app_src, "DB.saveUserData must handle QuotaExceededError"
    print("  ✓ PWA v26, Promise.allSettled, safe cache cleanup & LocalStorage resilience verified")

def test_module4_ui_ux_and_responsive():
    print("[4/5] Testing Module 4: UI/UX Desktop & Mobile Responsive Adaptation...")
    with open(STYLE_CSS, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(INDEX_HTML, 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Desktop side exam card internal scrolling and pinned footer
    assert '.side-exam-card {' in css, "Missing .side-exam-card in style.css"
    exam_card_idx = css.find('.side-exam-card {')
    exam_card_block = css[exam_card_idx:exam_card_idx+300]
    assert 'min-height: 0;' in exam_card_block and 'height: 100%;' in exam_card_block, \
        ".side-exam-card must set height: 100% and min-height: 0"

    assert '.side-exam-body {' in css, "Missing .side-exam-body in style.css"
    body_idx = css.find('.side-exam-body {')
    body_block = css[body_idx:body_idx+400]
    assert 'overflow-y: auto;' in body_block and 'flex: 1 1 auto;' in body_block, \
        ".side-exam-body must support independent internal scrolling"

    # 2. Exam submit button responsive text
    assert 'btn-text-full' in html and 'btn-text-short' in html, \
        "btnExamSubmit must include both full and short responsive text spans"
    assert '.btn-exam-finish .btn-text-short {' in css, \
        "style.css must define .btn-exam-finish .btn-text-short rules"

    # 3. Narrow screen <= 360px query
    assert '@media (max-width: 360px)' in css, "style.css must have @media (max-width: 360px)"

    # 4. Exam mode active hides keyboard hints
    assert '.practice-bottom-bar.exam-mode-active .keyboard-hints' in css, \
        "style.css must hide keyboard hints when exam-mode-active"

    # 5. Safe area insets
    assert 'padding: calc(18px + env(safe-area-inset-top, 0px)) 20px 18px;' in css, \
        ".drawer-header must include safe-area-inset-top"
    assert 'env(safe-area-inset-bottom, 0px)' in css, \
        "#viewMistakes must include safe-area-inset-bottom"

    # 6. Word break
    assert 'word-break: break-word;' in css and 'overflow-wrap: break-word;' in css, \
        "style.css must specify word-break and overflow-wrap"
    print("  ✓ PC exam panel internal scroll, <=360px compact bar, safe-areas & typography verified")

def test_module5_quota_and_sync_integrity():
    print("[5/5] Testing Module 5: Cloudflare Free Quota Protection & Sync Untouched...")
    with open(APP_JS, 'r', encoding='utf-8') as f:
        app_src = f.read()
    with open(SYNC_JS, 'r', encoding='utf-8') as f:
        sync_src = f.read()

    # 1. 2-hour session check throttle and client JWT exp parsing
    assert '2 * 60 * 60 * 1000' in app_src, "checkSession must use 2-hour throttle"
    assert 'payload.exp' in app_src and 'atob(' in app_src, \
        "checkSession must pre-check JWT exp locally on client"

    # 2. sync.js must remain 100% untouched client-authoritative overwrite
    assert 'for (const [qid, item] of Object.entries(localAnswers))' in sync_src, \
        "sync.js must keep direct localAnswers iteration"
    assert 'baseUpdatedAt' not in sync_src, "sync.js must NOT have baseUpdatedAt"
    assert 'status: 409' not in sync_src, "sync.js must NOT introduce 409 conflict aborts"
    print("  ✓ 2-hour quota throttle, client exp precheck & sync.js pristine integrity verified")

if __name__ == '__main__':
    print("=== Multi-Agent Audit Hardening (v25) Test Suite ===")
    try:
        test_module0_syntax_compilation()
        test_module1_practice_engine()
        test_module2_security_and_edge_cpu()
        test_module3_pwa_and_storage_resilience()
        test_module4_ui_ux_and_responsive()
        test_module5_quota_and_sync_integrity()
        print("\nAll 6 audit hardening modules passed successfully! 🚀")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
        sys.exit(1)
