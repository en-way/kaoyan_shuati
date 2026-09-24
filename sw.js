/**
 * 2027 考研政治 1000 题 · Service Worker (v16)
 * 缓存策略: Network-First (网络优先 + 离线缓存秒级降级)
 * 具备离线可用性，断网时自动启用本地题库与应用代码
 */

const VERSION = 'v16';
const CACHE_NAME = `ky-quiz-${VERSION}`;

// 核心 App Shell（轻量级，强保证秒级原子安装成功）
const CORE_SHELL_ASSETS = [
  './',
  './index.html',
  `./css/style.css?v=20270924_${VERSION}`,
  `./js/app.js?v=20270924_${VERSION}`,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 题库大数据包（~1.9MB，采用第二阶段后台异步容错预存，杜绝因网络抖动中断整个 App Shell 安装）
const LARGE_DATA_ASSETS = [
  './data/questions.json'
];

// 1. Install: 两阶段渐进式缓存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[ServiceWorker v16] Precaching Core App Shell');
      await cache.addAll(CORE_SHELL_ASSETS);

      // 第二阶段：异步容错缓存大体积题库
      LARGE_DATA_ASSETS.forEach((asset) => {
        cache.add(asset).catch((err) => {
          console.warn('[ServiceWorker v16] Resilient prefetch for data asset failed, will fetch on-demand:', asset, err);
        });
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate: Clear Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch: Network-First with Offline Fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip browser-extension or chrome-extension requests
  if (!url.protocol.startsWith('http')) return;

  // 离线 API 拦截降级：如果是 /api/ 接口请求且断网，返回结构化 JSON 503 避免客户端 res.json() 语法崩溃
  if (url.pathname.startsWith('/api/')) {
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

  // 只对 GET 静态资源执行网络优先/缓存降级
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If network request succeeded, cache a copy for offline use
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Network failed (offline / weak connection), fallback to cache
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // If navigation request (page refresh/open), fallback to index.html
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