// sw.js - 通用 Service Worker (适配 GitHub Pages 多项目)
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
// 获取当前 sw.js 所在的目录路径（例如 '/pwa1/'）
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 把作用域路径转成安全的标识片段（'/pwa1/' -> '-pwa1-'）
const PROJECT_SLUG = BASE_PATH.replace(/\//g, '-');
// 缓存版本：静态资源或逻辑变化时 +1
const CACHE_VERSION = 14;
// 本应用缓存名的公共前缀（例如 'pwa-cache-pwa1-'）
const CACHE_PREFIX = `pwa-cache${PROJECT_SLUG}`;
// 当前使用的缓存名（例如 'pwa-cache-pwa1-v14'）
const CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;
// 只匹配「本应用自己」的缓存（如 pwa-cache-pwa1-v1 / v2 ...）
// 结尾锚定 v\d+，避免误伤 pwa-cache-pwa1-sub-v1 这类子路径项目的缓存
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const OWN_CACHE_RE = new RegExp(`^pwa-cache${escapeRegExp(PROJECT_SLUG)}v\\d+$`);

// 预缓存资源列表（全部使用相对于当前 sw.js 的路径）
const PRECACHE_URLS = [
  `${BASE_PATH}sw.js`,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}favicon.ico`,
  `${BASE_PATH}icons/icon.svg`,
  `${BASE_PATH}icons/icon-192.png`,
  `${BASE_PATH}icons/icon-512.png`,
  `${BASE_PATH}icons/icon-maskable-192.png`,
  `${BASE_PATH}icons/icon-maskable-512.png`,
  `${BASE_PATH}icons/apple-touch-icon.png`,
  `${BASE_PATH}fontawesome.min.css`,
  `${BASE_PATH}webfonts/fa-solid-900.woff2`,
  `${BASE_PATH}webfonts/fa-regular-400.woff2`,
  `${BASE_PATH}webfonts/fa-brands-400.woff2`,
];

// 静态资源扩展名（用于判断是否缓存优先）
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// ---------- 2. 工具函数 ----------
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 是否属于本项目作用域（避免影响同源下的其它 PWA）
function inScope(url) {
  if (BASE_PATH === '/') return true;
  const root = BASE_PATH.slice(0, -1); // '/pwa1'
  return url.pathname === root || url.pathname.startsWith(BASE_PATH);
}

// 只在本项目缓存中查找，避免误命中其它 PWA 的同名资源
function matchOwnCache(request) {
  return caches.open(CACHE_NAME).then(cache => cache.match(request));
}

// ---------- 3. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源:', PRECACHE_URLS);
        // 使用 allSettled 忽略单个资源失败
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting()) // 立即激活
  );
});

// ---------- 4. 激活阶段（只清理当前项目的旧缓存） ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      // 关键：只清理「本项目」的旧版本缓存，绝不删除同源其它 PWA 的缓存
      return Promise.all(
        cacheNames
          .filter(cache => OWN_CACHE_RE.test(cache) && cache !== CACHE_NAME)
          .map(cache => {
            console.log('[SW] 删除本项目旧缓存:', cache);
            return caches.delete(cache);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ---------- 5. 请求拦截 ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求，且必须落在本项目作用域内
  if (url.origin !== location.origin || request.method !== 'GET' || !inScope(url)) {
    return;
  }

  // ----- 5.1 导航请求（HTML）：网络优先，失败回退缓存 -----
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // 网络失败，只从本项目缓存获取
          const cachedResponse = await matchOwnCache(request);
          if (cachedResponse) {
            console.log('[SW] 离线模式，使用缓存页面:', url.pathname);
            return cachedResponse;
          }
          // 连缓存都没有，返回自定义离线页（可预置 offline.html）
          // 如果希望更美观，可以预缓存一个 offline.html 并在这里返回它
          return new Response(
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>仿素记日记 - 离线</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F8F9FA;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#333}.card{text-align:center;padding:40px 20px}.icon{font-size:64px;margin-bottom:16px}.title{font-size:24px;font-weight:600;margin-bottom:8px}.desc{font-size:16px;color:#777;margin-bottom:24px}.btn{display:inline-block;padding:12px 32px;background:#5D5CDE;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;text-decoration:none}.btn:hover{background:#4a4abf}</style></head><body><div class="card"><div class="icon">📴</div><div class="title">网络已断开</div><div class="desc">仿素记日记无法加载最新页面<br>请检查网络连接后刷新</div><button class="btn" onclick="location.reload()">重新加载</button></div></body></html>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
          );
        })
    );
    return;
  }

  // ----- 5.2 静态资源请求：缓存优先，未命中则网络请求并缓存 -----
  if (isStaticResource(url)) {
    event.respondWith(
      matchOwnCache(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          // 完全离线且无缓存，返回空响应（可自定义）
          return new Response('', { status: 408 });
        });
      })
    );
    return;
  }

  // ----- 5.3 其他请求（如 API）默认不缓存，直接走网络 -----
  // （业务数据通常存储在 IndexedDB 中，不受影响）
});

// ---------- 6. 消息处理 ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
