#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/test_sync_overwrite.py
Verification suite for Client-Authoritative Snapshot Overwrite behavior.
"""

import os
import re
import sys

# Configure stdout for UTF-8 on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYNC_JS = os.path.join(BASE_DIR, 'functions', 'api', 'progress', 'sync.js')
APP_JS = os.path.join(BASE_DIR, 'js', 'app.js')

def test_server_sync_overwrite_logic():
    print("[1/3] Testing server sync.js client-authoritative overwrite logic...")
    with open(SYNC_JS, 'r', encoding='utf-8') as f:
        content = f.read()

    # Must NOT contain the old union-merge set loop
    assert 'allAnswerQids = new Set' not in content, \
        "Old union-merge set logic still found in sync.js"
    assert 'allMistakeQids = new Set' not in content, \
        "Old union-merge mistake set logic still found in sync.js"

    # Must contain direct iteration over localAnswers and localMistakes
    assert 'for (const [qid, item] of Object.entries(localAnswers))' in content, \
        "Missing direct localAnswers iteration in sync.js"
    assert 'for (const [qid, item] of Object.entries(localMistakes))' in content, \
        "Missing direct localMistakes iteration in sync.js"

    # Must retain validQid security check
    assert 'validQid' in content, "Missing validQid sanitization check"
    print("  ✓ Server sync.js confirmed client-authoritative overwrite without union merge")

def test_client_download_overwrite():
    print("[2/3] Testing client downloadFromCloud replacement mode...")
    with open(APP_JS, 'r', encoding='utf-8') as f:
        content = f.read()

    # downloadFromCloud must call setFromCloud, NOT mergeFromCompact
    download_section = re.search(r'async downloadFromCloud\(.*?\}\s*,\s*//', content, re.DOTALL)
    assert download_section is not None, "downloadFromCloud method not found"
    snippet = download_section.group(0)

    assert 'DB.setFromCloud(data)' in snippet, \
        "downloadFromCloud should use DB.setFromCloud(data) for direct replacement"
    assert 'DB.mergeFromCompact(data)' not in snippet, \
        "downloadFromCloud must NOT use DB.mergeFromCompact(data)"
    print("  ✓ Client downloadFromCloud confirmed using direct setFromCloud replacement")

def test_client_reset_and_dirty_flag():
    print("[3/3] Testing resetLocalData dirty state persistence...")
    with open(APP_JS, 'r', encoding='utf-8') as f:
        content = f.read()

    # resetLocalData must persist kaoyan_is_dirty_2027
    assert "localStorage.setItem('kaoyan_is_dirty_2027', '1')" in content, \
        "resetLocalData must persist dirty flag"
    # init must check kaoyan_is_dirty_2027
    assert "localStorage.getItem('kaoyan_is_dirty_2027') === '1'" in content, \
        "auth.init must restore persistent dirty flag"
    # uploadToCloud must remove kaoyan_is_dirty_2027
    assert "localStorage.removeItem('kaoyan_is_dirty_2027')" in content, \
        "uploadToCloud must clear persistent dirty flag upon successful upload"
    print("  ✓ Persistent dirty state and reset-to-upload workflow verified")

if __name__ == '__main__':
    print("=== Client-Authoritative Snapshot Overwrite Test Suite ===")
    try:
        test_server_sync_overwrite_logic()
        test_client_download_overwrite()
        test_client_reset_and_dirty_flag()
        print("\nAll 3 tests passed successfully! 🚀")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
        sys.exit(1)
