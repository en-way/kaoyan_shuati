"""
PC / Desktop UI Adaptation Test Suite (v20)
Verifies:
1. Two-column practice layout on wide screens (>=1200px) with sticky side palette
2. 3D Mechanical keycap badge & keyboard tag ergonomics
3. Hub view 1400px max-width & 3~4 column chapter grid
4. Mistakes view double-column responsive grid on desktop
5. Palette HTML generation and real-time synchronization in app.js
6. HTML and SW v20 versioning & mobile non-regression
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
    print("[1/6] Testing two-column practice layout for >=1200px...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    # HTML structure check
    assert '<div class="practice-main-column">' in html, "practice-main-column container missing in index.html"
    assert 'id="desktopSidePalette"' in html, "desktopSidePalette aside missing in index.html"
    assert 'id="sideGridContainer"' in html, "sideGridContainer missing in desktop side palette"
    assert 'id="sidePaletteStats"' in html, "sidePaletteStats missing in desktop side palette"
    assert 'id="sidePaletteProgressFill"' in html, "sidePaletteProgressFill missing in desktop side palette"
    assert 'id="sideExamSubmitBtn"' in html, "sideExamSubmitBtn missing in desktop side palette"

    # CSS base check (<1200px hidden)
    assert '.practice-side-palette {' in css, ".practice-side-palette base rule missing"
    assert re.search(r'\.practice-side-palette\s*\{[^}]*display:\s*none', css), \
        ".practice-side-palette must be display: none by default for mobile/tablet"

    # CSS >=1200px breakpoint check
    assert '@media (min-width: 1200px)' in css, "Missing @media (min-width: 1200px) in style.css"
    wide_section = css[css.find('@media (min-width: 1200px)'):]
    
    assert 'grid-template-columns: minmax(0, 1fr) 340px' in wide_section or \
           'grid-template-columns: minmax(0, 1fr) 340px' in css, \
           "Two-column grid definition missing for desktop practice-container"
    assert 'position: sticky' in wide_section, "Side palette sticky positioning missing"
    assert 'calc(100vh - 96px)' in wide_section or 'calc(100vh -' in wide_section, \
           "Side palette dynamic height missing"
    print("  ✓ Two-column practice layout and sticky side palette verified")

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
    wide_section = css[css.find('@media (min-width: 1200px)'):]
    assert 'max-width: 1400px' in wide_section, "Wide screen #viewHub max-width: 1400px missing"
    assert 'grid-template-columns: repeat(auto-fill, minmax(380px, 1fr))' in wide_section or \
           'grid-template-columns: repeat(3, 1fr)' in css, \
           "Multi-column chapter grid layout missing in wide view"
    print("  ✓ Hub view 1400px max-width & adaptive multi-column grid verified")

def test_mistakes_view_double_column():
    print("[4/6] Testing Mistakes view double-column grid layout...")
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    wide_section = css[css.find('@media (min-width: 1200px)'):]
    assert '#viewMistakes .mistakes-list' in wide_section or '.mistakes-list' in wide_section, \
        "Wide screen mistakes-list grid missing in style.css"
    assert 'repeat(2, minmax(0, 1fr))' in wide_section or 'repeat(2, 1fr)' in wide_section, \
        "Mistakes list double-column layout missing for desktop"
    print("  ✓ Mistakes view desktop double-column grid verified")

def test_js_palette_synchronization():
    print("[5/6] Testing JS palette rendering and real-time synchronization...")
    with open(JS_FILE, 'r', encoding='utf-8') as f:
        js = f.read()

    assert 'generatePaletteGridHtml' in js, "generatePaletteGridHtml method missing in app.js"
    assert 'updateSidePalette' in js, "updateSidePalette method missing in app.js"
    assert 'sideGridContainer' in js, "sideGridContainer references missing in app.js"
    assert 'sidePaletteStats' in js, "sidePaletteStats references missing in app.js"
    assert 'sidePaletteProgressFill' in js, "sidePaletteProgressFill references missing in app.js"
    assert 'sideExamSubmitBtn' in js, "sideExamSubmitBtn references missing in app.js"

    # Verify updateSidePalette is called in renderQuestion
    render_idx = js.find('renderQuestion() {')
    assert render_idx != -1, "renderQuestion method missing in app.js"
    render_body = js[render_idx:render_idx + 8000]
    assert 'this.updateSidePalette()' in render_body, \
        "updateSidePalette must be called in renderQuestion"

    # Verify toggleFlagCurrent updates side palette
    flag_idx = js.find('toggleFlagCurrent() {')
    assert flag_idx != -1, "toggleFlagCurrent method missing in app.js"
    flag_body = js[flag_idx:flag_idx + 1500]
    assert 'this.updateSidePalette()' in flag_body, \
        "updateSidePalette must be called in toggleFlagCurrent"
    print("  ✓ JS palette HTML generator and auto-sync methods verified")

def test_versioning_and_mobile_compatibility():
    print("[6/6] Testing v20 asset versioning and mobile compatibility...")
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(SW_FILE, 'r', encoding='utf-8') as f:
        sw = f.read()
    with open(CSS_FILE, 'r', encoding='utf-8') as f:
        css = f.read()

    # Version bump
    assert 'v=20270930_v20' in html, "index.html missing v=20270930_v20 query string"
    assert "VERSION = 'v20'" in sw, "sw.js missing VERSION = 'v20'"
    assert '20270930_${VERSION}' in sw, "sw.js missing 20270930_${VERSION} asset URLs"

    # Mobile compatibility check: .desktop-only hidden on <= 768px
    mobile_query = css[css.find('@media (max-width: 768px)'):css.find('@media (max-width: 480px)')]
    assert '.desktop-only { display: none !important; }' in mobile_query, \
        "Mobile query must hide .desktop-only elements"
    assert '.desktop-only-inline { display: none !important; }' in mobile_query, \
        "Mobile query must hide .desktop-only-inline elements"
    print("  ✓ Version v20 bump and mobile backwards compatibility verified")

if __name__ == '__main__':
    print("=== PC / Desktop UI Adaptation Test Suite (v20) ===")
    try:
        test_desktop_practice_two_column_layout()
        test_mechanical_keycaps_and_keyboard_ergonomics()
        test_hub_view_wide_grid()
        test_mistakes_view_double_column()
        test_js_palette_synchronization()
        test_versioning_and_mobile_compatibility()
        print("\nAll 6 desktop adaptation tests passed successfully! 🚀")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
        sys.exit(1)
