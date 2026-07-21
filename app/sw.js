/* Tent House Manager — offline service worker.
   Precaches the whole app so it opens and runs with no internet.
   Bump CACHE when you change any app file to push the update. */
const CACHE="tenthouse-app-v2";
const ASSETS=[
  "./",
  "index.html",
  "booking.html",
  "inventory.html",
  "analytics.html",
  "common.js",
  "theme.css",
  "manifest.webmanifest",
  "icon.svg",
  "icon-maskable.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png"
];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET") return;                       // only cache reads
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;        // ignore fonts/other CDNs
  e.respondWith(
    caches.match(req).then(hit=>{
      if(hit) return hit;                              // offline-first
      return fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
        return res;
      }).catch(()=>caches.match("index.html"));        // last resort
    })
  );
});
