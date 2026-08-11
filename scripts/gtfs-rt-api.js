// ==========================================
// GTFS-RT API
// ------------------------------------------
// Fetches Calgary's realtime feeds through the Cloudflare Worker and decodes
// them with GTFSDecoder. No protobufjs, no .proto file, no CDN dependency.
// XMLHttpRequest rather than fetch, per the BVCTV TV-browser pattern.
// ==========================================

var URL_TRIP_UPDATES      = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";
var URL_VEHICLE_POSITIONS = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";
var URL_ALERTS            = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

var PROXY_BASE = "https://bvctransitproxy.creative-018.workers.dev/?url=";

// All three Calgary URLs end in the same "application%2Foctet-stream" suffix,
// so any cache key derived from the tail of the URL collides across feeds.
// Explicit names keep their caches and log lines apart.
var FEED_NAMES = {};
FEED_NAMES[URL_TRIP_UPDATES]      = "trips";
FEED_NAMES[URL_VEHICLE_POSITIONS] = "vehicles";
FEED_NAMES[URL_ALERTS]            = "alerts";

function feedName(url)   { return FEED_NAMES[url] || "unknown"; }
function cacheKeyFor(url) { return "gtfsrt_" + feedName(url); }

var CACHE_TTL_MS = 45 * 1000;

function readCache(key) {
    try {
        var raw = localStorage.getItem(key);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
        return parsed.data;
    } catch (e) { return null; }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* quota or private mode - non-fatal */ }
}

try { localStorage.removeItem("gtfsrt_tet-stream"); } catch (e) {}

function fetchFeed(url, kind) {
    var name = feedName(url);
    var cacheKey = cacheKeyFor(url);

    return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            console.warn("[" + name + "] timed out");
            resolve(readCache(cacheKey));
        }, 8000);

        var xhr = new XMLHttpRequest();
        xhr.open("GET", PROXY_BASE + encodeURIComponent(url), true);
        xhr.responseType = "arraybuffer";

        xhr.onload = function () {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                if (xhr.status < 200 || xhr.status >= 300) throw new Error("HTTP " + xhr.status);
                var buf = xhr.response;
                if (!buf || buf.byteLength < 50) throw new Error("response too small");

                var parsed = (kind === "alerts")
                    ? GTFSDecoder.parseAlerts(buf)
                    : GTFSDecoder.parseTripUpdates(buf);

                writeCache(cacheKey, parsed);
                console.log("[" + name + "] " + buf.byteLength + " bytes, " +
                            (kind === "alerts" ? parsed.alerts.length + " alerts"
                                               : parsed.updates.length + " trip updates"));
                resolve(parsed);
            } catch (err) {
                console.warn("[" + name + "] " + err.message);
                var cached = readCache(cacheKey);
                if (cached) console.info("[" + name + "] serving from cache");
                resolve(cached);
            }
        };

        xhr.onerror = function () {
            if (done) return;
            done = true;
            clearTimeout(timer);
            console.warn("[" + name + "] network error");
            resolve(readCache(cacheKey));
        };

        try { xhr.send(); } catch (e) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(readCache(cacheKey));
        }
    });
}

function getCachedFeed(url) { return readCache(cacheKeyFor(url)); }
function getTripUpdates()   { return fetchFeed(URL_TRIP_UPDATES, "trips"); }
function getAlerts()        { return fetchFeed(URL_ALERTS, "alerts"); }
