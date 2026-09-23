/* Offline shell. Bump CACHE on every deploy so clients pick up the new build. */
var CACHE = "eai-v58";
var ASSETS = ["./", "./index.html", "./privacy.html", "./support.html", "./manifest.webmanifest",
              "./icons/icon-192.png", "./icons/apple-touch-icon.png",
              "./icons/benchmark-favicon.svg"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("eai-v") === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== "GET") return;                       // never cache submissions
  if(url.origin !== location.origin) return;                   // fonts and the sheet go straight to the network
  e.respondWith(
    fetch(e.request).then(function(res){
      var copy = res.clone();
      if(res.ok) caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){
        return hit || caches.match("./index.html");
      });
    })
  );
});
