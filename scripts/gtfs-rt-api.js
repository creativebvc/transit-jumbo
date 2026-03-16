// Calgary Open Data URLs
const URL_TRIP_UPDATES      = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";
const URL_VEHICLE_POSITIONS = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";
const URL_ALERTS            = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

// ==========================================
// PROXY — dedicated Cloudflare Worker
// ==========================================
const PROXY_BASE = "https://bvctransitproxy.creative-018.workers.dev/?url=";

// ==========================================
// LOCAL CACHE
// Persists the last good feed to localStorage.
// On page load, data renders at t=0 while the
// fresh network fetch runs in the background.
// ==========================================
const CACHE_TTL_MS = 45 * 1000; // 45s — covers the 30s refresh cycle

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) return null;
        return data;
    } catch { return null; }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* storage full — ignore */ }
}

// ==========================================
// CORE FETCH
// ==========================================
async function fetchGTFSRT(url) {
    const cacheKey = "gtfsrt_" + url.slice(-10);

    const root = await loadGTFSRTProto();
    if (!root) return null;

    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(PROXY_BASE + encodeURIComponent(url), {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
            throw new Error("Proxy returned HTML — worker may be down");
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 50) throw new Error("Response too small");

        const decoded = FeedMessage.decode(new Uint8Array(buffer));
        const obj     = FeedMessage.toObject(decoded, { enums: String });

        writeCache(cacheKey, obj);
        return obj;

    } catch (error) {
        clearTimeout(timeoutId);
        console.warn(`⚠️ Live fetch failed (${url.slice(-20)}): ${error.message}`);

        // Fall back to cache — better stale than blank
        const cached = readCache(cacheKey);
        if (cached) {
            console.info("📦 Serving from localStorage cache");
            return cached;
        }
        return null;
    }
}

// Synchronous — returns cached data instantly (used at page load)
function getCachedFeed(url) {
    return readCache("gtfsrt_" + url.slice(-10));
}

async function getTripUpdates()      { return fetchGTFSRT(URL_TRIP_UPDATES); }
async function getVehiclePositions() { return fetchGTFSRT(URL_VEHICLE_POSITIONS); }
