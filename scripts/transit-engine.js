// ==========================================
// CONFIGURATION (UPDATED WITH NEW IDS)
// ==========================================
// found via Topology Scan
const STOPS_WEST = ["6762", "6822"]; // 6762 is the new active ID
const STOPS_EAST = ["8977", "6831", "6832"]; // 8977 is the new active ID

// ==========================================
// UTILITIES
// ==========================================
function getSafeLong(val) { 
    if (!val) return 0; 
    if (typeof val === 'number') return val; 
    if (val.low !== undefined) return val.low; 
    return 0; 
}

function calculateMinutes(eta, referenceTime) { 
    const diff = eta - referenceTime;
    // Show trains that departed up to 90 seconds ago (boarding buffer)
    if (diff < -90) return -1; 
    return Math.max(0, Math.round(diff / 60)); 
}

function mapRouteColor(routeId) {
    // Universal Matcher: If it's not standard, guess based on known IDs
    if (routeId.includes("201") || routeId.includes("Red") || routeId.includes("156")) return "red";
    if (routeId.includes("202") || routeId.includes("Blue")) return "blue";
    return "blue"; // Default
}

function getDestinationName(lineColor, direction) {
    if (direction === 'WEST') {
        return lineColor === 'red' ? "Tuscany" : "69 Street";
    } else {
        return lineColor === 'red' ? "Somerset" : "Saddletowne";
    }
}

// ==========================================
// ENGINE LOGIC
// ==========================================
async function startTransitDashboard() {
    console.log("🚀 ENGINE ONLINE: FINAL CONFIG (Targeting 6762 & 8977)");

    async function update() {
        const feed = await getTripUpdates();
        
        if (!feed || !feed.entity) {
            console.warn("⚠️ Data fetch empty. Retrying...");
            return;
        }

        let serverTime = Math.floor(Date.now() / 1000); 
        if (feed.header && feed.header.timestamp) {
            const feedTs = getSafeLong(feed.header.timestamp);
            if (feedTs > 0) serverTime = feedTs;
        }

        const westTrains = [];
        const eastTrains = [];
        const processedTrips = new Set();
        
        for (const entity of feed.entity) {
            if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

            const trip = entity.tripUpdate.trip;
            const tripId = trip.tripId || trip.trip_id;
            const routeId = trip.routeId || trip.route_id || "";
            
            if (processedTrips.has(tripId)) continue;

            // COLOR LOGIC
            const lineColor = mapRouteColor(routeId);

            // STOP MATCHING LOGIC
            for (const stopUpdate of entity.tripUpdate.stopTimeUpdate) {
                const stopId = stopUpdate.stopId;
                const arrival = stopUpdate.arrival || stopUpdate.departure; 
                if (!arrival || !arrival.time) continue;

                const timeVal = getSafeLong(arrival.time);
                const minutes = calculateMinutes(timeVal, serverTime);

                if (minutes === -1 || minutes > 60) continue;

                // CHECK WESTBOUND (Using New ID 6762)
                if (STOPS_WEST.includes(stopId)) {
                    westTrains.push({
                        destination: getDestinationName(lineColor, 'WEST'),
                        line: lineColor,
                        minutes: minutes,
                        status: minutes <= 1 ? "Boarding" : "On Time",
                        tripId: tripId
                    });
                    processedTrips.add(tripId);
                    break; 
                }

                // CHECK EASTBOUND (Using New ID 8977)
                if (STOPS_EAST.includes(stopId)) {
                    eastTrains.push({
                        destination: getDestinationName(lineColor, 'EAST'),
                        line: lineColor,
                        minutes: minutes,
                        status: minutes <= 1 ? "Boarding" : "On Time",
                        tripId: tripId
                    });
                    processedTrips.add(tripId);
                    break; 
                }
            }
        }

        // Sort by time
        westTrains.sort((a, b) => a.minutes - b.minutes);
        eastTrains.sort((a, b) => a.minutes - b.minutes);

        console.log(`✅ Success: ${westTrains.length} West, ${eastTrains.length} East`);

        // RENDER
        if (typeof window.renderColumn === "function") {
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
        }
    }

    // Start immediately, refresh every 30s
    update();
    setInterval(update, 30000);
}
