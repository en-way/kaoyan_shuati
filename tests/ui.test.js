import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DB } from '../js/state/store.js';
import { viewMethods } from '../js/ui/views.js';
import { modalMethods } from '../js/ui/modals.js';
import { escapeHtml } from '../js/ui/sanitize.js';
import { createAuthController } from '../js/core/sync.js';

const UI_DIR = path.resolve('js/ui');

test('UI 模块静态契约与防回归校验', async (t) => {
  const uiFiles = fs.readdirSync(UI_DIR).filter(f => f.endsWith('.js'));

  await t.test('js/ui/*.js 中所有 DB.<method>() 调用必须真实存在于 DB 对象上', () => {
    const missing = [];
    for (const file of uiFiles) {
      const content = fs.readFileSync(path.join(UI_DIR, file), 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(/\bDB\.([a-zA-Z0-9_]+)\s*\(/g)) {
          const method = match[1];
          if (typeof DB[method] !== 'function') {
            missing.push(`${file}:${idx + 1} -> DB.${method}()`);
          }
        }
      });
    }
    assert.deepEqual(missing, [], `发现未定义的 DB 方法调用:\n${missing.join('\n')}`);
  });

  await t.test('js/ui/*.js 中所有 this.<method>() 调用必须已正确挂载到 App', () => {
    const appMethods = new Set([
      ...Object.keys(viewMethods),
      ...Object.keys(modalMethods),
      'init'
    ]);
    const missing = [];
    for (const file of uiFiles) {
      const content = fs.readFileSync(path.join(UI_DIR, file), 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(/\bthis\.([a-zA-Z0-9_]+)\s*\(/g)) {
          const method = match[1];
          if (!appMethods.has(method)) {
            missing.push(`${file}:${idx + 1} -> this.${method}()`);
          }
        }
      });
    }
    assert.deepEqual(missing, [], `发现未挂载到 App 的 this 方法调用:\n${missing.join('\n')}`);
  });

  await t.test('js/ui/*.js 中所有 this.auth.<method>() 调用必须真实存在于 auth 控制器上', () => {
    const dummyAuth = createAuthController(() => ({}));
    const authMethods = new Set(Object.keys(dummyAuth).filter(k => typeof dummyAuth[k] === 'function'));
    const missing = [];
    for (const file of uiFiles) {
      const content = fs.readFileSync(path.join(UI_DIR, file), 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(/\bthis\.auth\.([a-zA-Z0-9_]+)\s*\(/g)) {
          const method = match[1];
          if (!authMethods.has(method)) {
            missing.push(`${file}:${idx + 1} -> this.auth.${method}()`);
          }
        }
      });
    }
    assert.deepEqual(missing, [], `发现未挂载到 App.auth 的方法调用:\n${missing.join('\n')}`);
  });

  await t.test('css/modals.css 中 .modal-backdrop 与 .drawer-backdrop 默认隐藏且仅 .is-open 时显示', () => {
    const modalsCss = fs.readFileSync(path.resolve('css/modals.css'), 'utf8');
    assert.match(modalsCss, /\.modal-backdrop,\s*\.drawer-backdrop\s*\{\s*display:\s*none;\s*\}/);
    assert.match(modalsCss, /\.modal-backdrop\.is-open,\s*\.drawer-backdrop\.is-open\s*\{\s*display:\s*flex;\s*\}/);
  });

  await t.test('escapeHtml 应完整转义危险 HTML 与属性字符', () => {
    const dirty = `<img src="x" onerror='alert(1)'>&`;
    assert.equal(
      escapeHtml(dirty),
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;'
    );
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  await t.test('_headers 应配置严格 CSP (Inline-Script SHA-256 精确匹配)、安全响应头与不缓存策略', () => {
    const headersFile = fs.readFileSync(path.resolve('_headers'), 'utf8');
    assert.match(headersFile, /X-Content-Type-Options:\s*nosniff/);
    assert.match(headersFile, /X-Frame-Options:\s*DENY/);
    assert.match(headersFile, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
    assert.match(headersFile, /\/sw\.js[\s\S]*Cache-Control:\s*no-cache,\s*no-store,\s*must-revalidate/);
    assert.match(headersFile, /Content-Security-Policy:/);
    assert.equal(/'unsafe-inline'[^;]*script-src|script-src[^;]*'unsafe-inline'/i.test(headersFile), false, 'CSP script-src 不应使用 unsafe-inline');

    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const inlineScripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)]
      .filter((m) => !/\ssrc=/i.test(m[0]))
      .map((m) => m[1]);
    assert.equal(inlineScripts.length, 2, 'index.html 应仅包含 2 段必要头部内联脚本');
    for (const scriptBody of inlineScripts) {
      assert.equal(/[\r\n]/.test(scriptBody), false, '内联脚本保持单行以避免 CRLF/LF 哈希漂移');
      const digest = 'sha256-' + crypto.createHash('sha256').update(scriptBody, 'utf8').digest('base64');
      assert.ok(headersFile.includes(`'${digest}'`), `_headers CSP 缺失内联脚本哈希 ${digest}`);
    }
  });

  await t.test('重构后应消除硬编码霓虹青、内联事件及原生阻塞 alert/confirm 弹窗', () => {
    const cssFiles = fs.readdirSync(path.resolve('css')).filter(f => f.endsWith('.css'));
    for (const f of cssFiles) {
      const css = fs.readFileSync(path.resolve('css', f), 'utf8');
      assert.equal(/0,\s*240,\s*255|#00f0ff/i.test(css), false, `${f} 不应存在硬编码霓虹青`);
    }

    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert.equal(/\bon(click|submit|change)=/i.test(html), false, 'index.html 不应存在内联 onclick/onsubmit/onchange');

    const jsDirs = ['js', 'js/core', 'js/state', 'js/ui'];
    for (const dir of jsDirs) {
      for (const f of fs.readdirSync(path.resolve(dir)).filter(x => x.endsWith('.js'))) {
        const content = fs.readFileSync(path.resolve(dir, f), 'utf8');
        const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.equal(/\bwindow\.(alert|confirm|prompt)\s*\(|\b(?<!\.)(alert|confirm|prompt)\s*\(/.test(stripped), false, `${dir}/${f} 不应调用原生阻塞弹窗`);
      }
    }
  });

  await t.test('sw.js 的 CORE_SHELL_ASSETS 清单中的所有本地文件必须在磁盘存在', () => {
    const swContent = fs.readFileSync(path.resolve('sw.js'), 'utf8');
    const match = swContent.match(/const\s+CORE_SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(match, 'sw.js 应定义 CORE_SHELL_ASSETS');
    const entries = [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    assert.ok(entries.length >= 20, 'CORE_SHELL_ASSETS 清单应完整');
    assert.equal(entries.includes('/'), true, 'sw.js 预缓存清单应包含根路径 /');
    assert.equal(
      entries.some((entry) => /(^|\/)index\.html(\?|$)/.test(entry)),
      false,
      'sw.js 不应预缓存 ./index.html，防止触发 Cloudflare 308 重定向响应拦截'
    );
    const cleanedPaths = [];
    for (const raw of entries) {
      const clean = raw.replace(/\?.*$/, '').replace(/^\.?\/+/, '');
      if (!clean) continue;
      cleanedPaths.push(clean);
      assert.equal(fs.existsSync(path.resolve(clean)), true, `sw.js 预缓存资源缺失: ${raw}`);
    }
    for (const splitMod of [
      'js/core/auth-ui.js',
      'js/core/admin-ui.js',
      'js/core/cloud-sync.js',
      'js/ui/practice-controls.js'
    ]) {
      assert.ok(cleanedPaths.includes(splitMod), `sw.js 预缓存应包含拆分模块 ${splitMod}`);
    }
  });

  await t.test('manifest.json 应为合法 JSON 且采用根路径 id / start_url / scope', () => {
    const raw = fs.readFileSync(path.resolve('manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
  });

  await t.test('index.html 与 css/tokens.css 应具备浅色护眼首屏防闪屏机制', () => {
    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const scriptMatch = html.match(/<meta\s+name="theme-color"[^>]*>\s*<script>([\s\S]*?)<\/script>[\s\S]*?<link\s+rel="stylesheet"\s+href="css\/tokens\.css/);
    assert.ok(scriptMatch, 'index.html 应在 <meta name="theme-color"> 之后、tokens.css 之前内联同步主题脚本');
    const inlineCode = scriptMatch[1];
    assert.match(inlineCode, /try\s*\{[\s\S]*\}\s*catch\s*\(/);
    assert.match(inlineCode, /kaoyan_theme_2027/);
    assert.match(inlineCode, /data-theme['"],\s*['"]light['"]/);
    assert.match(inlineCode, /#f6f4ef/i);

    const tokensCss = fs.readFileSync(path.resolve('css/tokens.css'), 'utf8');
    assert.match(tokensCss, /html\[data-theme="light"\]\s+body/);
  });

  await t.test('CI 工作流、云同步安全、A11y/无缩放锁定与状态机防回归校验', () => {
    const ci = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
    assert.match(ci, /tests\/ui\.test\.js/);
    assert.match(ci, /tests\/auth\.test\.js/);
    assert.match(ci, /tests\/client-sync\.test\.js/);

    const cloudSync = fs.readFileSync(path.resolve('js/core/cloud-sync.js'), 'utf8');
    assert.match(cloudSync, /isSilent && !forceFull && !isBankDirty && bankLastSync/);
    assert.match(cloudSync, /if\s*\(shouldPurge\)\s*\{\s*this\.purgeAllUserData\(/);

    const swContent = fs.readFileSync(path.resolve('sw.js'), 'utf8');
    assert.match(swContent, /isPageNavigation\s*=\s*request\.mode\s*===\s*'navigate'/);
    assert.match(swContent, /!\\?\/\\.\[\^\/\]\+\$\/\.test\(url\.pathname\)|!\/\\\.\[\^\/\]\+\$\/\.test\(url\.pathname\)/);
    assert.match(swContent, /BANK_CACHE_NAME\s*=\s*'ky-quiz-banks-v1'/);

    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert.equal(/user-scalable=no|maximum-scale=1/i.test(html), false, '禁止限制用户缩放 viewport');
    assert.equal(html.includes('questionMoreModal'), false, '已移除死代码弹窗 #questionMoreModal');
    assert.match(html, /id="authModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /label\s+for="loginUsername"/);

    const respCss = fs.readFileSync(path.resolve('css/responsive.css'), 'utf8');
    assert.match(respCss, /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*?\.header-center/);
    assert.match(respCss, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);

    const modalsCss = fs.readFileSync(path.resolve('css/modals.css'), 'utf8');
    assert.match(modalsCss, /#confirmDialogModal\s*\{[\s\S]*z-index:\s*1100/);

    // 轻量行为断言：全科无章节错题特训切全库模考应被拦截；exam_review 允许显示解析
    let warned = 0;
    const fakeApp = {
      ...viewMethods,
      state: { practiceMode: 'mistakes_only', currentChapter: '', currentPart: '', currentIndex: 0, questions: [{ id: 'Q_0001' }] },
      showToast() { warned++; },
      updateModePillsUI() {},
      startPractice() { throw new Error('不应进入全库模考'); }
    };
    fakeApp.switchMode('exam');
    assert.equal(warned, 1);
    assert.equal(fakeApp.state.practiceMode, 'mistakes_only');

    const pvSrc = fs.readFileSync(path.resolve('js/ui/practice-view.js'), 'utf8');
    assert.match(pvSrc, /DB\.questionsMap\s*&&\s*DB\.questionsMap\[qItem\.id\]/, 'exam_review 快照必须从原始题库回填答案与解析');
  });
});
