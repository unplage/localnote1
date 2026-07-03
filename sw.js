// sw.js - 通用 Service Worker (适配 GitHub Pages 多项目)
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 更新版本号，强制刷新缓存（每次更新应用时修改版本号）
const CACHE_NAME = `pwa-cache${BASE_PATH.replace(/\//g, '-')}v331`;

// ---------- 2. 预缓存资源列表（内部 + 外部 CDN） ----------
// 内部资源
const INTERNAL_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  // 如果有图标，可追加
  // `${BASE_PATH}favicon.ico`,
];

// 外部 CDN 资源（必须缓存，否则离线无法加载）
const EXTERNAL_URLS = [
  // Font Awesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  // TipTap 核心库及扩展（所有依赖）
  'https://esm.sh/@tiptap/core@2',
  'https://esm.sh/@tiptap/starter-kit@2',
  'https://esm.sh/@tiptap/extension-placeholder@2',
  'https://esm.sh/@tiptap/extension-underline@2',
  'https://esm.sh/@tiptap/extension-text-style@2',
  'https://esm.sh/@tiptap/extension-color@2',
  'https://esm.sh/@tiptap/extension-highlight@2',
  'https://esm.sh/@tiptap/extension-text-align@2',
  'https://esm.sh/@tiptap/extension-image@2',
  'https://esm.sh/@tiptap/pm@2',
];

// 合并所有预缓存 URL
const PRECACHE_URLS = [...INTERNAL_URLS, ...EXTERNAL_URLS];

// 静态资源扩展名（用于判断是否缓存优先）
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// 允许缓存的外部域名列表
const ALLOWED_EXTERNAL_HOSTS = ['cdnjs.cloudflare.com', 'esm.sh'];

// ---------- 3. 工具函数 ----------
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 判断是否允许缓存的跨域资源
function isAllowedExternal(url) {
  return ALLOWED_EXTERNAL_HOSTS.includes(url.hostname);
}

// ---------- 4. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源数量:', PRECACHE_URLS.length);
        // 使用 allSettled 忽略单个资源失败
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting()) // 立即激活
  );
});

// ---------- 5. 激活阶段 ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache.startsWith('pwa-cache-') && cache !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ---------- 6. 请求拦截 ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  // ----- 6.1 导航请求（HTML）：网络优先，失败回退缓存 -----
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
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            console.log('[SW] 离线模式，使用缓存页面:', url.pathname);
            return cachedResponse;
          }
          return new Response(
            '<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // ----- 6.2 静态资源或允许的外部资源：缓存优先，未命中则网络请求并缓存 -----
  // 条件：同源静态资源 或 允许的外部域名资源
  const isInternalStatic = isStaticResource(url) && url.origin === location.origin;
  const isAllowedExternal = isAllowedExternal(url);

  if (isInternalStatic || isAllowedExternal) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
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
          return new Response('', { status: 408 });
        });
      })
    );
    return;
  }

  // ----- 6.3 其他请求（如 API 等）：不缓存，直接走网络 -----
  // （业务数据存储在 IndexedDB 中，不受影响）
});
