"""
PC / Desktop UI Adaptation Test Suite (v21)
Verifies:
1. Two-column practice layout on wide screens (>=1200px) with dedicated side explanation panel
2. 3D Mechanical keycap badge & keyboard tag ergonomics
3. Hub view 1400px max-width & 3~4 column chapter grid
4. Mistakes view double-column responsive grid on desktop
5. Side explanation panel multi-state rendering and real-time synchronization in app.js
6. HTML and SW v21 versioning & mobile non-regression
"""

import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_FILE = os.path.join(BASE_DIR, 'index.html')
CSS_FILE = os.path.join(BASE_DIR, 'css', 'style.css')
JS_FILE = os.path.join(BASE_DIR, 'js', 'app.js')
SW_FILE = os.path.join(BASE_DIR, 'sw.js')

def test_desktop_practice_two_column_layout():
    print("[1/6] Testing two-column practice layout with side explanation panel (>=1200px)...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    # HTML structure check
    assert '<div class="practice-main-column">' in html, "practice-main-column container missing in index.html"
    assert 'id="desktopSidePanel"' in html, "desktopSidePanel aside missing in index.html"
    assert 'id="sideExplPlaceholder"' in html, "sideExplPlaceholder missing in desktop side panel"
    assert 'id="sideExplActive"' in html, "sideExplActive missing in desktop side panel"
    assert 'id="sideExamCard"' in html, "sideExamCard missing in desktop side panel"
    assert 'id="sideExplAnswerVal"' in html, "sideExplAnswerVal missing in active explanation card"
    assert 'id="sideExplAnalysisText"' in html, "sideExplAnalysisText missing in active explanation card"

    # CSS base check (<1200px hidden)
    assert '.practice-side-panel {' in css or '.practice-side-panel,' in css, \
        ".practice-side-panel base rule missing"
    assert re.search(r'\.practice-side-panel\s*\{[^}]*display:\s*none', css) or \
           re.search(r'\.practice-side-palette,\s*\.practice-side-panel\s*\{[^}]*display:\s*none', css), \
        ".practice-side-panel must be display: none by default for mobile/tablet"

    # CSS >=1024px breakpoint check
    assert '@media (min-width: 1024px)' in css or '@media (min-width: 1200px)' in css, "Missing @media (min-width: 1024px) in style.css"
    wide_section = css[css.find('@media (min-width: 1024px)'):]
    
    assert 'grid-template-columns:' in wide_section, \
           "Two-column grid definition missing for desktop practice-container"
    assert '.question-card .explanation-panel' in wide_section, \
        "Left card explanation panel must be hidden on desktop to avoid duplicate rendering"
    assert 'display: none !important' in wide_section, \
        "display: none !important missing for left card explanation on desktop"
    assert 'position: sticky' in wide_section, "Side panel sticky positioning missing"
    print("  ✓ Two-column practice layout and responsive side explanation panel verified")

def test_mechanical_keycaps_and_keyboard_ergonomics():
    print("[2/6] Testing 3D mechanical keycap badges & shortcuts tags...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    # CSS keycap badge 3D styling
    assert '.option-key-badge' in css, ".option-key-badge missing in style.css"
    assert 'box-shadow:' in css and 'border-bottom:' in css, \
        ".option-key-badge missing 3D keycap border/shadow styling"
    assert '.keycap-tag' in css, ".keycap-tag class missing in style.css"

    # HTML keycap tag tags on buttons
    assert '<kbd class="desktop-only-inline keycap-tag">J</kbd>' in html, \
        "Prev question button missing keycap tag [J]"
    assert '<kbd class="desktop-only-inline keycap-tag">K / 空格</kbd>' in html, \
        "Next question button missing keycap tag [K / 空格]"
    assert '<kbd class="desktop-only-inline keycap-tag">F</kbd>' in html, \
        "Flag button missing keycap tag [F]"
    assert '<kbd class="desktop-only-inline keycap-tag">E</kbd>' in html, \
        "Expl button missing keycap tag [E]"
    assert '<kbd class="desktop-only-inline keycap-tag">Tab</kbd>' in html, \
        "Drawer button missing keycap tag [Tab]"
    print("  ✓ 3D mechanical keycap badges and action bar shortcuts tags verified")

def test_hub_view_wide_grid():
    print("[3/6] Testing Hub view 1400px container & multi-column grid...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    assert '#viewHub' in css, "#viewHub missing in style.css"
    bp_idx = css.find('@media (min-width: 1024px)')
    if bp_idx == -1: bp_idx = css.find('@media (min-width: 1200px)')
    wide_section = css[bp_idx:]
    assert 'max-width: 1400px' in wide_section, "Wide screen #viewHub max-width: 1400px missing"
    assert 'grid-template-columns:' in wide_section or \
           'grid-template-columns: repeat(3, 1fr)' in css, \
           "Multi-column chapter grid layout missing in wide view"
    print("  ✓ Hub view 1400px max-width & adaptive multi-column grid verified")

def test_mistakes_view_double_column():
    print("[4/6] Testing Mistakes view double-column grid layout...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    bp_idx = css.find('@media (min-width: 1024px)')
    if bp_idx == -1: bp_idx = css.find('@media (min-width: 1200px)')
    wide_section = css[bp_idx:]
    assert '#viewMistakes .mistakes-list' in wide_section or '.mistakes-list' in wide_section, \
        "Wide screen mistakes-list grid missing in style.css"
    assert 'repeat(2, minmax(0, 1fr))' in wide_section or 'repeat(2, 1fr)' in wide_section, \
        "Mistakes list double-column layout missing for desktop"
    print("  ✓ Mistakes view desktop double-column grid verified")

def test_side_explanation_panel_sync():
    print("[5/6] Testing side explanation panel rendering and real-time synchronization...")
    with open(JS_FILE, 'r', encoding='utf-8') as f:
        js = f.read()

    assert 'renderSideExplanationPanel' in js, "renderSideExplanationPanel method missing in app.js"
    assert 'sideExplPlaceholder' in js, "sideExplPlaceholder references missing in app.js"
    assert 'sideExplActive' in js, "sideExplActive references missing in app.js"
    assert 'sideExamCard' in js, "sideExamCard references missing in app.js"
    assert 'sideResultBanner' in js, "sideResultBanner references missing in app.js"
    assert 'generatePaletteGridHtml' in js, "generatePaletteGridHtml method missing in app.js"
    assert 'updateDrawerIfOpen' in js, "updateDrawerIfOpen method missing in app.js"

    # Verify renderSideExplanationPanel is called in renderExplanationPanel
    render_idx = js.find('renderExplanationPanel(q) {')
    assert render_idx != -1, "renderExplanationPanel method missing in app.js"
    render_body = js[render_idx:render_idx + 3000]
    assert 'this.renderSideExplanationPanel' in render_body, \
        "renderSideExplanationPanel must be called in renderExplanationPanel"

    # Verify toggleFlagCurrent updates sideFlagIcon
    flag_idx = js.find('toggleFlagCurrent() {')
    assert flag_idx != -1, "toggleFlagCurrent method missing in app.js"
    flag_body = js[flag_idx:flag_idx + 1500]
    assert 'sideFlagIcon' in flag_body, \
        "sideFlagIcon must be updated in toggleFlagCurrent"
    print("  ✓ Side explanation panel multi-state engine verified")

def test_versioning_and_mobile_compatibility():
    print("[6/6] Testing v24 asset versioning, fluid typography & mobile/desktop account display...")
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(SW_FILE, 'r', encoding='utf-8') as f:
        sw = f.read()
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(JS_FILE, 'r', encoding='utf-8') as f:
        js = f.read()

    # Version bump
    assert ('v=20271002_v27' in html or 'v=20270930_v26' in html or 'v=20270930_v25' in html or 'v=20270930_v24' in html), "index.html missing v24-v27 query string"
    assert ("VERSION = 'v27'" in sw or "VERSION = 'v26'" in sw or "VERSION = 'v25'" in sw or "VERSION = 'v24'" in sw), "sw.js missing VERSION = 'v27'"
    assert ('20271002_${VERSION}' in sw or '20270930_${VERSION}' in sw), "sw.js missing asset URLs"

    # Fluid typography & 4-tier manual font scaling checks
    assert '--font-scale: 1' in css, "Missing --font-scale CSS variable in style.css"
    assert '--fs-stem:' in css and 'clamp(' in css, "Missing fluid clamp() typography variables in style.css"
    assert 'data-font-size="sm"' in css and 'data-font-size="xl"' in css, "Missing 4-tier data-font-size rules in style.css"
    assert 'tabular-nums' in css, "Missing tabular-nums rule in style.css"
    assert 'id="pFontSizeBtn"' in html, "Missing PC font size switcher button #pFontSizeBtn in index.html"
    assert 'class="font-size-segmented"' in html, "Missing mobile 4-tier font size segmented control in index.html"
    assert 'setFontSize(' in js and 'cycleFontSize(' in js, "Missing setFontSize / cycleFontSize methods in app.js"
    assert '.keyboard-hints > span' in css, "Missing .keyboard-hints > span alignment rule in style.css"
    assert 'id="mUserAccount"' in html and 'id="menuNickname"' in html, "Missing #mUserAccount or #menuNickname in index.html"
    assert 'copyUsername(' in js, "Missing copyUsername method in app.js"

    # Mobile compatibility check: .desktop-only hidden on <= 768px
    mobile_query = css[css.find('@media (max-width: 768px)'):css.find('@media (max-width: 480px)')]
    assert '.desktop-only { display: none !important; }' in mobile_query, \
        "Mobile query must hide .desktop-only elements"
    assert '.desktop-only-inline { display: none !important; }' in mobile_query, \
        "Mobile query must hide .desktop-only-inline elements"
    print("  ✓ Version v24, fluid typography, bottom bar & dual nickname+@account display verified")

if __name__ == '__main__':
    print("=== PC / Desktop UI & Typography Adaptation Test Suite (v24) ===")
    try:
        test_desktop_practice_two_column_layout()
        test_mechanical_keycaps_and_keyboard_ergonomics()
        test_hub_view_wide_grid()
        test_mistakes_view_double_column()
        test_side_explanation_panel_sync()
        test_versioning_and_mobile_compatibility()
        print("\nAll 6 desktop & typography adaptation tests passed successfully! 🚀")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
        sys.exit(1)
