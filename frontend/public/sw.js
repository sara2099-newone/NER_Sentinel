// Offline support for the NER Sentinel app shell (HTML/CSS/JS/map
// tiles-library) — addresses the SIH brief's "low-network/offline
// functionality" requirement, which the SPA had no coverage for at
// all before this.
//
// Design (adapted from the reference official/sw.js in this project,
// same reasoning): API GET requests (/api/...) are NEVER served from
// cache. Risk levels, incident status, and who-needs-help are exactly
// the data an official or citizen must never see as stale-but-look-
// current — so if the network is down, those calls fail visibly
// (the app's existing fetch error handling already surfaces that)
// rather than silently showing yesterday's dashboard as if it were
// live. Only the static app shell and CDN libraries are cached, so
// the app still *opens* offline even though live data won't load
// until connectivity returns.

const CACHE_NAME = "ner-sentinel-v1";

const APP_FILES = [
    "./",
    "./index.html",
    "./app.js",
    "./styles.css",
    "./manifest.json",
    "./icon.svg",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(
                APP_FILES.map((url) => cache.add(url).catch((error) => console.log("Precache failed for", url, error)))
            )
        )
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(handleShellFetch(event.request));
});

async function handleShellFetch(request) {
    let networkResponse;
    try {
        networkResponse = await fetch(request);
    } catch (networkError) {
        const cached = await caches.match(request);
        return cached || caches.match("./index.html");
    }

    const cacheable = networkResponse.status === 200 || networkResponse.type === "opaque";
    if (cacheable) {
        const responseToCache = networkResponse.clone();
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, responseToCache))
            .catch((cacheError) => console.log("Cache put failed for", request.url, cacheError));
    }

    return networkResponse;
}
