#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/test_ui_adaptation.py
Automated Verification Suite for UI/UX Multi-Device Responsive Adaptation (v18)
"""

import os
import re
import sys

# Configure stdout for UTF-8 on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_FILE = os.path.join(BASE_DIR, 'css', 'style.css')
HTML_FILE = os.path.join(BASE_DIR, 'index.html')
JS_FILE = os.path.join(BASE_DIR, 'js', 'app.js')

def test_css_variables():
    print("[1/6] Testing CSS variables and theme contrast...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    assert '--accent-gold: #ffcc00;' in content, "Missing --accent-gold variable"
    assert '--font-mono:' in content, "Missing --font-mono variable"
    assert '--text-muted: #8da0b8;' in content, "AA contrast text-muted variable not updated"
    print("  ✓ CSS variables defined with high-contrast palette")

def test_viewport_and_safe_areas():
    print("[2/6] Testing mobile viewports, safe-area insets, and scroll locking...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    assert 'min-height: 100dvh;' in content, "Missing 100dvh modern viewport unit in body"
    assert 'safe-area-inset-left' in content and 'safe-area-inset-right' in content, \
        "Missing horizontal safe area insets in body"
    assert 'body.modal-open' in content, "Missing body.modal-open CSS rule"
    assert 'touch-action: none;' in content, "Missing touch-action: none; in modal scroll lock"
    print("  ✓ Modern dynamic viewports and safe-area insets configured")

def test_typography_and_option_wrapping():
    print("[3/6] Testing option ergonomics and typography wrapping...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # Option items alignment & breaking
    assert 'align-items: flex-start;' in content, "Option item should align to top for multi-line text"
    assert 'overflow-wrap: break-word;' in content or 'word-break: break-word;' in content, \
        "Option text missing word break protection"
    # Tag ellipsis
    assert 'text-overflow: ellipsis;' in content, "Missing ellipsis truncation on long chapter tags"
    # Badge colors
    assert '#050b14' in content, "Correct badge text should be dark for high AAA contrast"
    print("  ✓ Typography, badges, and long option wrapping validated")

def test_modal_and_drawer_ergonomics():
    print("[4/6] Testing modal cards, drawers, and tap target sizes...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # Drawer backdrop padding reset
    assert '.drawer-backdrop {' in content and 'padding: 0 !important;' in content, \
        "Drawer backdrop should have padding: 0"
    # Modal card max height
    assert 'max-height: 90dvh;' in content or 'max-height: 85dvh;' in content, \
        "Modal card missing dvh max-height constraint"
    # Drawer close target size
    assert 'min-width: 44px;' in content and 'min-height: 44px;' in content, \
        "Drawer close button must have at least 44px x 44px tap target"
    print("  ✓ Modal scrolling and 44px tap ergonomics verified")

def test_mobile_and_tablet_media_queries():
    print("[5/6] Testing responsive breakpoints (<=768px, <=480px, 769-1024px)...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # iOS auto zoom prevention
    assert 'font-size: 16px' in content, "Form controls must have 16px font on mobile to prevent iOS zoom"
    # Avoid double bottom bar clipping
    assert 'calc(114px + env(safe-area-inset-bottom' in content, \
        "Missing practice view bottom clearance (114px + safe area) for dual bottom bars"
    # Exam summary card responsive collapse
    assert '@media (max-width: 480px)' in content, "Missing ultra-small breakpoint for exam card"
    # Tablet adaptation
    assert '@media (min-width: 769px) and (max-width: 1024px)' in content, \
        "Missing tablet breakpoint for clean navigation"
    print("  ✓ Responsive breakpoints and iOS auto-zoom protections verified")

def test_html_and_js_modal_integration():
    print("[6/6] Testing HTML version bumps and JS scroll lock logic...")
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(JS_FILE, 'r', encoding='utf-8') as f:
        js = f.read()

    assert 'v=20270924_v18' in html, "HTML static assets not bumped to v18"
    assert 'App.closeExamReportModal(event)' in html, "Exam report modal missing click-outside dismiss"

    # JS scroll lock logic
    assert 'updateBodyScrollLock' in js, "Missing updateBodyScrollLock in app.js"
    assert 'modal-open' in js, "app.js should toggle modal-open on body"
    assert '.modal-backdrop, .drawer-backdrop' in js, "Keydown shield should check both modal and drawer backdrops"
    assert 'this.closeQuestionMoreMenu()' in js, "Escape key should close question more menu"
    print("  ✓ JS modal state sync and keyboard shields verified")

if __name__ == '__main__':
    print("=== UI/UX Multi-Device Responsive Adaptation Test Suite ===")
    try:
        test_css_variables()
        test_viewport_and_safe_areas()
        test_typography_and_option_wrapping()
        test_modal_and_drawer_ergonomics()
        test_mobile_and_tablet_media_queries()
        test_html_and_js_modal_integration()
        print("\nAll 6 test suites passed successfully! 🚀")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
        sys.exit(1)
