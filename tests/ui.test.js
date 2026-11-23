import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../js/state/store.js';
import { viewMethods } from '../js/ui/views.js';
import { modalMethods } from '../js/ui/modals.js';
import { escapeHtml } from '../js/ui/sanitize.js';

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

  await t.test('_headers 应配置全局安全响应头与 SW/HTML 不缓存策略', () => {
    const headersFile = fs.readFileSync(path.resolve('_headers'), 'utf8');
    assert.match(headersFile, /X-Content-Type-Options:\s*nosniff/);
    assert.match(headersFile, /X-Frame-Options:\s*DENY/);
    assert.match(headersFile, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
    assert.match(headersFile, /\/sw\.js[\s\S]*Cache-Control:\s*no-cache,\s*no-store,\s*must-revalidate/);
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
    const cleanedPaths = [];
    for (const raw of entries) {
      const clean = raw.replace(/\?.*$/, '').replace(/^\.\//, '');
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
});
