// Calgary Open Data URLs
const URL_TRIP_UPDATES      = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";
const URL_VEHICLE_POSITIONS = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";
const URL_ALERTS            = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

// ==========================================
// PROXY — dedicated Cloudflare Worker
// ==========================================
const PROXY_BASE = "https://bvctransitproxy.creative-018.workers.dev/?url=";

// ==========================================
// FEED IDENTITY
// ------------------------------------------
// All three Calgary URLs end in the same
// "application%2Foctet-stream" suffix, so any
// key derived from the tail of the URL is
// IDENTICAL for all three feeds. Explicit
// names are the only safe way to tell them
// apart in cache keys and log messages.
// ==========================================
const FEED_NAMES = {};
FEED_NAMES[URL_TRIP_UPDATES]      = "trips";
FEED_NAMES[URL_VEHICLE_POSITIONS] = "vehicles";
FEED_NAMES[URL_ALERTS]            = "alerts";

function feedName(url) {
    return FEED_NAMES[url] || "unknown";
}

function cacheKeyFor(url) {
    return "gtfsrt_" + feedName(url);
}

// ==========================================
// LOCAL CACHE
// ==========================================
const CACHE_TTL_MS = 45 * 1000; // 45s — covers the 30s refresh cycle

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
        return parsed.data;
    } catch (e) { return null; }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* storage full — ignore */ }
}

// One-time cleanup of the old colliding key from previous versions
try { localStorage.removeItem("gtfsrt_tet-stream"); } catch (e) {}

// ==========================================
// CORE FETCH
// ==========================================
async function fetchGTFSRT(url) {
    const name     = feedName(url);
    const cacheKey = cacheKeyFor(url);

    const root = await loadGTFSRTProto();
    if (!root) return null;

    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    const controller = new AbortController();
    const timeoutId  = setTimeout(function () { controller.abort(); }, 8000);

    try {
        const response = await fetch(PROXY_BASE + encodeURIComponent(url), {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error("HTTP " + response.status);

        const contentType = response.headers.get("content-type") || "";
        if (contentType.indexOf("text/html") > -1) {
            throw new Error("Proxy returned HTML — worker may be down");
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 50) throw new Error("Response too small");

        const decoded = FeedMessage.decode(new Uint8Array(buffer));

        // longs: Number keeps int64 timestamps as plain numbers so they survive
        // the JSON round-trip into localStorage without becoming {low,high} objects.
        const obj = FeedMessage.toObject(decoded, { enums: String, longs: Number });

        writeCache(cacheKey, obj);
        console.log("✅ [" + name + "] " + buffer.byteLength + " bytes, " +
                    (obj.entity ? obj.entity.length : 0) + " entities");
        return obj;

    } catch (error) {
        clearTimeout(timeoutId);
        console.warn("⚠️ [" + name + "] live fetch failed: " + error.message);

        const cached = readCache(cacheKey);
        if (cached) {
            console.info("📦 [" + name + "] serving from cache");
            return cached;
        }
        return null;
    }
}

// Synchronous — returns cached data instantly (used at page load)
function getCachedFeed(url) {
    return readCache(cacheKeyFor(url));
}

async function getTripUpdates()      { return fetchGTFSRT(URL_TRIP_UPDATES); }
async function getVehiclePositions() { return fetchGTFSRT(URL_VEHICLE_POSITIONS); }
