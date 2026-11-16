// sw.js - 通用 Service Worker (适配 GitHub Pages 多项目)
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常
//
// v2 变更（离线健壮性专项）：
//   1. 导航请求增加超时，避免弱网下白屏数十秒
//   2. 导航响应增加「内容指纹校验」，防止弱网/门户 WiFi 的登录页被写进离线缓存
//   3. 预缓存清单补全（补 fa-v4compatibility 字体）
//   4. 静态资源离线缺失时返回带类型的降级响应，不再返回空 body
//   5. 移除 install 阶段的无条件 skipWaiting()，改为「提示式更新」，避免静默劫持页面
//   6. install 阶段生成预缓存自检报告，供页面端「离线自检」面板读取
//   7. 离线兜底页支持目录根路径回退（/pwa1 与 /pwa1/ 的差异）

// ---------- 1. 动态路径与缓存名称 ----------
// 获取当前 sw.js 所在的目录路径（例如 '/pwa1/'）
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 把作用域路径转成安全的标识片段（'/pwa1/' -> '-pwa1-'）
const PROJECT_SLUG = BASE_PATH.replace(/\//g, '-');
// 缓存版本：静态资源或逻辑变化时 +1
const CACHE_VERSION = 20;
// 本应用缓存名的公共前缀（例如 'pwa-cache-pwa1-'）
const CACHE_PREFIX = `pwa-cache${PROJECT_SLUG}`;
// 当前使用的缓存名（例如 'pwa-cache-pwa1-v15'）
const CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;

// 只匹配「本应用自己」的缓存（如 pwa-cache-pwa1-v1 / v2 ...）
// 结尾锚定 v\d+，避免误伤 pwa-cache-pwa1-sub-v1 这类子路径项目的缓存
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const OWN_CACHE_RE = new RegExp(`^pwa-cache${escapeRegExp(PROJECT_SLUG)}v\\d+$`);

// 内容指纹：用于识别「返回的到底是不是本应用的页面」
// 弱网 / 门户 WiFi 下 fetch 可能成功返回 200 + 门户登录页，
// 若直接写入缓存，离线时用户看到的会是别人的登录页。
const APP_MARKER = '仿素记日记';
// 网络超时（毫秒）：超时立即回落到缓存，而不是干等浏览器 TCP 超时
const NAV_TIMEOUT_MS = 4000;
const ASSET_TIMEOUT_MS = 6000;
// 预缓存自检报告的缓存键（页面端通过 caches.match 读取）
const REPORT_KEY = '__precache_report__';

// 预缓存资源列表（全部使用相对于当前 sw.js 的路径）
const PRECACHE_URLS = [
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
  `${BASE_PATH}webfonts/fa-v4compatibility.woff2`,
];

// 静态资源扩展名（用于判断是否缓存优先）
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// ---------- 2. 工具函数 ----------
function isStaticResource(url) {
  const parts = url.pathname.split('.');
  if (parts.length < 2) return false;
  const ext = parts.pop().toLowerCase();
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

// 带超时的 fetch：弱网下不会长时间白屏
function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// 离线兜底页（仅在连缓存都没有时使用）
const OFFLINE_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>仿素记日记 - 离线</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F8F9FA;color:#333;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{text-align:center;max-width:380px}
.icon{font-size:60px;margin-bottom:16px}
.title{font-size:22px;font-weight:700;margin-bottom:8px}
.desc{font-size:14px;color:#777;line-height:1.7;margin-bottom:20px}
.desc b{color:#333}
.btn{display:inline-block;padding:12px 28px;background:#5D5CDE;color:#fff;border:none;border-radius:10px;font-size:15px;cursor:pointer;text-decoration:none}
.btn:hover{background:#4a4abf}
@media (prefers-color-scheme:dark){body{background:#121212;color:#E0E0E0}.desc{color:#AAA}.desc b{color:#E0E0E0}}
</style></head><body><div class="card">
<div class="icon">📴</div>
<div class="title">当前处于离线状态</div>
<div class="desc">网络不可用，且本机尚未缓存可用的应用页面。<br><br>请连接网络后<b>重新加载一次</b>，之后即可完全离线使用。<br>已保存的笔记数据不会丢失。</div>
<button class="btn" onclick="location.reload()">重新加载</button>
</div></body></html>`;

// 静态资源缺失时的最小降级 CSS（避免图标字体丢失导致布局完全失控）
const MINIMAL_CRITICAL_CSS = `:root{--primary-color:#5D5CDE}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#F8F9FA;color:#333}
i.fa-solid,i.fa-regular,i.fa-brands,i[class^="fa-"]{font-style:normal;font-family:system-ui,sans-serif;display:inline-block;width:1em;opacity:.55}
i.fa-search::before{content:"🔍"}i.fa-cog::before{content:"⚙"}i.fa-tags::before{content:"🏷"}
i.fa-plus::before{content:"＋"}i.fa-times::before{content:"✕"}i.fa-trash::before{content:"🗑"}
i.fa-check::before{content:"✓"}i.fa-clock::before{content:"🕐"}i.fa-arrow-left::before{content:"‹"}
i.fa-book::before{content:"📕"}i.fa-book-open::before{content:"📖"}i.fa-calendar-alt::before{content:"📅"}
i.fa-calendar-day::before{content:"📆"}i.fa-calendar-week::before{content:"📅"}i.fa-pen::before{content:"✎"}
i.fa-quote-left::before{content:"❝"}i.fa-code::before{content:"‹›"}i.fa-file-export::before{content:"📤"}
i.fa-lock::before{content:"🔒"}i.fa-exclamation-triangle::before{content:"⚠"}i.fa-rotate-left::before{content:"↺"}
i.fa-rotate-right::before{content:"↻"}i.fa-bold::before{content:"B"}i.fa-italic::before{content:"I"}
i.fa-underline::before{content:"U"}i.fa-strikethrough::before{content:"S"}i.fa-list-ul::before{content:"≡"}
i.fa-list-ol::before{content:"≡"}i.fa-outdent::before{content:"⇤"}i.fa-indent::before{content:"⇥"}
i.fa-align-left::before{content:"⇤"}i.fa-align-center::before{content:"⇹"}i.fa-align-right::before{content:"⇥"}
i.fa-trash-alt::before{content:"🗑"}i.fa-restore::before{content:"♻"}i.fa-wifi::before{content:"📶"}`;

// ---------- 3. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const failed = [];
      await Promise.allSettled(
        PRECACHE_URLS.map(async url => {
          try {
            await cache.add(url);
          } catch (err) {
            failed.push({ url, error: String(err && err.message || err) });
            console.warn('[SW] 预缓存失败', url, err);
          }
        })
      );
      // 写入自检报告，供页面端「离线自检」面板读取
      const report = {
        version: CACHE_VERSION,
        basePath: BASE_PATH,
        cachedAt: Date.now(),
        total: PRECACHE_URLS.length,
        failed,
        urls: PRECACHE_URLS
      };
      await cache.put(REPORT_KEY, new Response(JSON.stringify(report), {
        headers: { 'Content-Type': 'application/json;charset=UTF-8' }
      }));
      console.log('[SW] 预缓存完成，失败', failed.length, '项');
      // 注意：这里不再无条件 skipWaiting()。
      // 新版本先处于 waiting 状态，由页面端弹出「发现新版本」提示，
      // 用户点击「立即更新」后再通过 SKIP_WAITING 消息激活。
      // 这样可避免更新在用户编辑途中静默接管页面。
    })
  );
});

// ---------- 4. 激活阶段（只清理当前项目的旧缓存） ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中，缓存版本 v' + CACHE_VERSION);
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

  // ----- 5.1 导航请求（HTML）：网络优先(带超时+指纹校验)，失败回退缓存 -----
  if (isNavigateRequest(request)) {
    event.respondWith((async () => {
      try {
        const net = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
        if (net && net.ok && !net.redirected) {
          const contentType = net.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            // 读取正文做指纹校验：确认确实是本应用，而不是门户登录页
            const text = await net.clone().text();
            if (text.includes(APP_MARKER)) {
              try {
                const cache = await caches.open(CACHE_NAME);
                // 重新构造 headers：原响应可能带 content-encoding / content-length，
                // 它们描述的是「压缩后的原始响应」，直接套用到已解码的文本上
                // 会导致离线读取时解码失败或被截断。
                const headers = new Headers();
                headers.set('content-type', net.headers.get('content-type') || 'text/html;charset=UTF-8');
                headers.set('cache-control', 'no-cache');
                await cache.put(request, new Response(text, { status: 200, headers }));
              } catch (e) {
                console.warn('[SW] 写入页面缓存失败:', e);
              }
            } else {
              console.warn('[SW] 响应不含应用标记，判定为门户/劫持页，不写入离线缓存');
            }
          }
        }
        return net;
      } catch (err) {
        console.log('[SW] 网络不可用或超时，回退离线缓存:', url.pathname);
        // 网络失败，只从本项目缓存获取
        const cachedResponse = await matchOwnCache(request);
        if (cachedResponse) return cachedResponse;
        // 目录根路径回退：/pwa1 与 /pwa1/ 在离线时可能只缓存了其中一个
        const rootCandidates = [BASE_PATH, BASE_PATH + 'index.html'];
        for (const candidate of rootCandidates) {
          try {
            const alt = await matchOwnCache(candidate);
            if (alt) return alt;
          } catch (e) { /* 忽略 */ }
        }
        // 连缓存都没有，返回自定义离线页
        return new Response(OFFLINE_HTML, {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/html;charset=UTF-8' }
        });
      }
    })());
    return;
  }

  // ----- 5.2 静态资源请求：缓存优先，未命中则网络请求并缓存 -----
  if (isStaticResource(url)) {
    event.respondWith(
      matchOwnCache(request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetchWithTimeout(request, ASSET_TIMEOUT_MS).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone))
              .catch(err => console.warn('[SW] 写入静态缓存失败:', err));
          }
          return networkResponse;
        }).catch(() => {
          // 完全离线且无缓存：返回带类型的降级响应，而不是空 body
          console.warn('[SW] 离线且未缓存:', url.pathname);
          const isCss = url.pathname.toLowerCase().endsWith('.css');
          return new Response(isCss ? MINIMAL_CRITICAL_CSS : '', {
            status: 504,
            statusText: 'Offline asset missing',
            headers: {
              'Content-Type': isCss ? 'text/css;charset=UTF-8' : 'application/octet-stream',
              'X-Offline-Missing': '1'
            }
          });
        });
      })
    );
    return;
  }

  // ----- 5.3 其他请求（如 API、manifest 等）默认不缓存，直接走网络 -----
  // （业务数据存储在 IndexedDB 中，不受影响）
});

// ---------- 6. 消息处理 ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // 必须包在 waitUntil 里：否则 install/activate 事务可能在 skipWaiting 完成前被拆除，
    // 「立即更新」点了没反应。skipWaiting 在非 installed 状态会抛 InvalidStateError，一并吞掉。
    event.waitUntil(
      self.skipWaiting().catch(err => console.warn('[SW] skipWaiting 失败:', err))
    );
  }
  // 页面端主动请求预缓存报告（离线自检）。
  // 页面通过 MessageChannel 传入了 port，必须用 port 回传；
  // 用 event.source 回传会落到页面的 navigator.serviceWorker 'message' 事件上，页面收不到。
  if (event.data && event.data.type === 'GET_PRECACHE_REPORT') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.match(REPORT_KEY))
        .then(r => r ? r.json() : null)
        .catch(() => null)
        .then(report => {
          const msg = { type: 'PRECACHE_REPORT', report: report || null };
          const port = event.ports && event.ports[0];
          if (port) port.postMessage(msg);
          else if (event.source && event.source.postMessage) event.source.postMessage(msg);
        })
    );
  }
});
