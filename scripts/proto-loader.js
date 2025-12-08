let GTFSRT_ROOT = null;

async function loadGTFSRTProto() {
    if (GTFSRT_ROOT) return GTFSRT_ROOT;

    try {
        // Updated path: look in the scripts folder
        GTFSRT_ROOT = await protobuf.load("scripts/gtfs-realtime.proto");
        console.log("✅ GTFS-RT Proto Loaded");
        return GTFSRT_ROOT;
    } catch (error) {
        console.error("❌ Failed to load gtfs-realtime.proto:", error);
        return null;
    }
}