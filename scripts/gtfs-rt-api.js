// URLs
const URL_TRIP_UPDATES = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream";
const URL_ALERTS = "https://data.calgary.ca/download/jhgn-ynqj/application%2Foctet-stream";

// PROXY
const PROXY_BASE = "https://bvctransitproxy.creative-018.workers.dev/?url=";

async function fetchGTFSRT(targetUrl) {
    const root = await loadGTFSRTProto();
    if (!root) return null;
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    try {
        // STANDARD FETCH (No hacks)
        const response = await fetch(PROXY_BASE + encodeURIComponent(targetUrl));
        if (!response.ok) throw new Error("HTTP " + response.status);
        
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 100) throw new Error("Data too short");
        
        const decoded = FeedMessage.decode(new Uint8Array(buffer));
        return FeedMessage.toObject(decoded, { enums: String });
    } catch (error) {
        console.error("API Error:", error);
        return null;
    }
}

async function getTripUpdates() { return fetchGTFSRT(URL_TRIP_UPDATES); }
// (You can remove vehicle positions if you aren't using them)
