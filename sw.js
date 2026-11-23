/**
 * 考研政治 1000 题 · Service Worker (v38 多题库 ES Modules 版)
 * 缓存策略:
 * - 核心 App Shell 与拆分后的 ES Modules: install 阶段原子预缓存 + Network-First
 * - 多题库 JSON (`data/banks/*.json`, `data/questions.json`): 运行时按需缓存（避免 install 阶段预下载所有年份题库浪费用户流量）
 */

const VERSION = 'v38';
const ASSET_VER = `20271123_${VERSION}`;
const CACHE_NAME = `ky-quiz-${ASSET_VER}`;

// 核心 App Shell 与全部拆分后的原生 ES Modules & 模块化 CSS
const CORE_SHELL_ASSETS = [
  './',
  './index.html',
  `./css/tokens.css?v=${ASSET_VER}`,
  `./css/base.css?v=${ASSET_VER}`,
  `./css/hub.css?v=${ASSET_VER}`,
  `./css/practice.css?v=${ASSET_VER}`,
  `./css/modals.css?v=${ASSET_VER}`,
  `./css/responsive.css?v=${ASSET_VER}`,
  `./css/style.css?v=${ASSET_VER}`,
  `./js/main.js?v=${ASSET_VER}`,
  `./js/app.js?v=${ASSET_VER}`,
  `./js/config.js`,
  `./js/api.js`,
  `./js/state/store.js`,
  `./js/core/quiz.js`,
  `./js/core/exam.js`,
  `./js/core/sync.js`,
  `./js/ui/views.js`,
  `./js/ui/hub-view.js`,
  `./js/ui/practice-view.js`,
  `./js/ui/mistakes-view.js`,
  `./js/ui/explanation-renderer.js`,
  `./js/ui/modals.js`,
  `./data/catalog.json?v=${ASSET_VER}`,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 1. Install: 仅预缓存轻量级 App Shell 与目录清单，不强制预下载所有年份题库 JSON
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log(`[ServiceWorker ${VERSION}] Precaching Core App Shell & ES Modules`);
      await cache.addAll(CORE_SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate: 清理旧版本 ky-quiz-* 缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name.startsWith('ky-quiz-') && name !== CACHE_NAME) {
            console.log(`[ServiceWorker ${VERSION}] Removing old cache:`, name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch:
// - /api/ 接口：在线直通，离线返回结构化 503 JSON
// - data/banks/*.json 与 data/questions.json：运行时按需缓存 (Stale-While-Revalidate / Cache-First 带后台更新)
// - 其余 App Shell GET 请求：Network-First 带离线缓存回退
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) return;

  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({
          success: false,
          offline: true,
          error: '当前处于离线离网状态，网络请求失败（本地进度仍完好保存）'
        }), {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' })
        });
      })
    );
    return;
  }

  if (event.request.method !== 'GET') return;

  const isBankJson = url.pathname.includes('/data/banks/') || url.pathname.endsWith('/data/questions.json');

  if (isBankJson) {
    // 题库大文件按需缓存：优先读缓存秒开（并在后台静默校验更新），若未缓存则拉取并写入缓存
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const netRes = await networkFetch;
        if (netRes) return netRes;

        return new Response(JSON.stringify({ error: '离线状态且该年份题库尚未在本地缓存' }), {
          status: 503,
          headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' })
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request)
          || await caches.match(url.pathname);
        if (cachedResponse) {
          return cachedResponse;
        }

        if (event.request.mode === 'navigate') {
          const fallbackPage = await caches.match('./index.html');
          if (fallbackPage) return fallbackPage;
        }

        return new Response('离线状态且无对应本地缓存', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
