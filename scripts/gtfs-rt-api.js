// =========================================================
// CALGARY OPEN DATA URLS
// =========================================================
// 1. Trip Updates (The Schedule - Preferred)
const URL_TRIP_UPDATES = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";

// 2. Vehicle Positions (The GPS Radar - Backup)
const URL_VEHICLE_POSITIONS = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";

// 3. Service Alerts (The Ticker)
const URL_ALERTS = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

// PROXY (Must use your Cloudflare Worker)
const PROXY_BASE = "https://bvctransitproxy.creative-018.workers.dev/?url=";

async function fetchGTFSRT(targetUrl) {
    const root = await loadGTFSRTProto();
    if (!root) return null;

    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    try {
        const response = await fetch(PROXY_BASE + encodeURIComponent(targetUrl));
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        // Use ArrayBuffer for binary data
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 10) throw new Error("Data too short/empty");

        const decoded = FeedMessage.decode(new Uint8Array(buffer));
        return FeedMessage.toObject(decoded, { enums: String });

    } catch (error) {
        console.error("❌ API Error:", error);
        return null;
    }
}

async function getTripUpdates() { return fetchGTFSRT(URL_TRIP_UPDATES); }
async function getVehiclePositions() { return fetchGTFSRT(URL_VEHICLE_POSITIONS); }
async function getServiceAlerts() { return fetchGTFSRT(URL_ALERTS); }
