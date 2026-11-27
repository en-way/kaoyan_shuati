/**
 * 考研政治 1000 题 · Service Worker (v38 多题库 ES Modules 加固版)
 * 缓存策略:
 * - 核心 App Shell 与拆分后的 ES Modules (/js/*.js, /css/*.css, /data/catalog.json, 页面导航):
 *   install 阶段以 cache: 'no-cache' 原子预缓存 + Network-First (fetch(..., { cache: 'no-cache' }))，断网回退缓存
 * - 多题库 JSON (`data/banks/*.json`, `data/questions.json`): 运行时按需缓存
 * - `/api/*` 与非 GET 请求: 严禁缓存，直接跳过走网络
 */

const VERSION = 'v38';
const ASSET_VER = `20271123_${VERSION}_10`;
const CACHE_NAME = `ky-quiz-${ASSET_VER}`;

// 移除 Cloudflare Pages 重定向产生的 redirected: true 标记，防止 Chromium/Edge PWA 拦截加载
function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers)
  });
}

// 核心 App Shell 与全部拆分后的原生 ES Modules & 模块化 CSS
const CORE_SHELL_ASSETS = [
  '/',
  `./css/tokens.css?v=${ASSET_VER}`,
  `./css/base.css?v=${ASSET_VER}`,
  `./css/hub.css?v=${ASSET_VER}`,
  `./css/practice.css?v=${ASSET_VER}`,
  `./css/modals.css?v=${ASSET_VER}`,
  `./css/responsive.css?v=${ASSET_VER}`,
  `./css/style.css?v=${ASSET_VER}`,
  `./js/main.js?v=${ASSET_VER}`,
  `./js/app.js?v=${ASSET_VER}`,
  './js/config.js',
  './js/api.js',
  './js/state/store.js',
  './js/core/quiz.js',
  './js/core/exam.js',
  './js/core/sync.js',
  './js/core/auth-ui.js',
  './js/core/admin-ui.js',
  './js/core/cloud-sync.js',
  './js/ui/views.js',
  './js/ui/hub-view.js',
  './js/ui/practice-view.js',
  './js/ui/practice-controls.js',
  './js/ui/mistakes-view.js',
  './js/ui/explanation-renderer.js',
  './js/ui/sanitize.js',
  './js/ui/modals.js',
  `./data/catalog.json?v=${ASSET_VER}`,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 1. Install: 以 no-cache 绕过 HTTP 缓存预缓存 App Shell，并立即 skipWaiting()
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log(`[ServiceWorker ${ASSET_VER}] Precaching Core App Shell & ES Modules`);
        await Promise.all(
          CORE_SHELL_ASSETS.map(async (asset) => {
            const req = new Request(asset, { cache: 'no-cache' });
            const res = await fetch(req);
            if (!res.ok) {
              throw new Error(`Precache failed (${res.status}) for ${asset}`);
            }
            await cache.put(asset, cleanResponse(res));
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// 2. Activate: 清理所有非当前 CACHE_NAME 的旧缓存并立即接管页面 clients.claim()
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log(`[ServiceWorker ${ASSET_VER}] Removing old cache:`, name);
            return caches.delete(name);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

// 3. Fetch:
// - 非 GET、非同源、/api/* 路径：严禁缓存，直接走网络
// - data/banks/*.json 与 data/questions.json：运行时按需缓存
// - 页面导航、/js/*.js、/css/*.css、/data/catalog.json 等同源静态资源：Network-First (cache: 'no-cache') + 离线回退
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;

  const isBankJson = url.pathname.includes('/data/banks/') || url.pathname.endsWith('/data/questions.json');
  if (isBankJson) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        if (cached) return cached;
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

  // 仅对页面 HTML 导航（根路径、/index.html 或无扩展名路由）统一请求 '/'，避免拦截直接访问的 .json/.js 静态文件
  const isPageNavigation = request.mode === 'navigate' && (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    !/\.[^/]+$/.test(url.pathname)
  );
  if (isPageNavigation) {
    event.respondWith(
      fetch('/', { cache: 'no-cache' })
        .then(async (networkResponse) => {
          const cleaned = cleanResponse(networkResponse);
          if (cleaned && cleaned.status === 200) {
            const responseClone = cleaned.clone();
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put('/', responseClone);
            } catch (_) {}
          }
          return cleaned;
        })
        .catch(async () => {
          const cachedRoot = await caches.match('/');
          if (cachedRoot) {
            return cleanResponse(cachedRoot);
          }

          return new Response('离线状态且无对应本地缓存', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
          });
        })
    );
    return;
  }

  // Network-First: 联网时强制校验最新版本并写回缓存，断网时回退缓存
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(async (networkResponse) => {
        const cleaned = cleanResponse(networkResponse);
        if (cleaned && cleaned.status === 200) {
          const responseClone = cleaned.clone();
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, responseClone);
          } catch (_) {}
        }
        return cleaned;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request)
          || await caches.match(url.pathname);
        if (cachedResponse) {
          return cleanResponse(cachedResponse);
        }

        return new Response('离线状态且无对应本地缓存', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
