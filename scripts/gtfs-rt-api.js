// Calgary Open Data URLs
const URL_TRIP_UPDATES = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";
const URL_VEHICLE_POSITIONS = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";
const URL_ALERTS = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

// ==========================================
// PROXY CONFIGURATION
// ==========================================
const PROXIES = [
    "https://corsproxy.io/?",                  // Primary: Usually fastest
    "https://api.allorigins.win/raw?url=",     // Backup 1: Reliable but slower
    "https://thingproxy.freeboard.io/fetch/"   // Backup 2: Last resort
];

async function fetchWithFailover(targetUrl) {
    for (const proxyBase of PROXIES) {
        try {
            const fetchUrl = proxyBase + encodeURIComponent(targetUrl);
            
            // INCREASED TIMEOUT: We now wait 10 seconds before giving up
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); 

            const response = await fetch(fetchUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            // SECURITY CHECK: Did we get an error page instead of data?
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("text/html")) {
                throw new Error("Proxy returned HTML error page instead of binary data.");
            }
            
            const buffer = await response.arrayBuffer();
            
            // VALIDATION: Is the file too small?
            if (buffer.byteLength < 100) {
                throw new Error("Data too short (likely corrupted).");
            }

            // Success! Return the data
            return buffer;

        } catch (error) {
            // Log this as a warning, not an error. It's normal for proxies to fail occasionally.
            console.warn(`⚠️ Proxy ${proxyBase} failed or timed out. Switching to next backup...`);
        }
    }
    throw new Error("All proxies failed. Check internet connection.");
}

async function fetchGTFSRT(url) {
    const root = await loadGTFSRTProto();
    if (!root) return null;

    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    try {
        const buffer = await fetchWithFailover(url);
        // Decode the binary buffer
        const decoded = FeedMessage.decode(new Uint8Array(buffer));
        return FeedMessage.toObject(decoded, { enums: String });
    } catch (error) {
        console.error("❌ API Error:", error);
        return null;
    }
}

async function getTripUpdates() { return fetchGTFSRT(URL_TRIP_UPDATES); }
async function getVehiclePositions() { return fetchGTFSRT(URL_VEHICLE_POSITIONS); }