// ==========================================
// CONFIGURATION
// ==========================================
// City Hall / Bow Valley College Stop IDs
const STOP_CITY_HALL_WEST = "6822"; 
const STOP_CITY_HALL_EAST = "6831"; 

// Route Identifiers
const ROUTE_RED = "201";
const ROUTE_BLUE = "202";

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
    if (routeId.includes(ROUTE_RED)) return "red";
    if (routeId.includes(ROUTE_BLUE)) return "blue";
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
    console.log("🚀 ENGINE ONLINE: PROCESSING DATA");

    async function update() {
        // 1. Fetch Data
        const feed = await getTripUpdates();
        
        // 2. Safety Check
        if (!feed || !feed.entity) {
            console.warn("⚠️ Data fetch empty. Retrying in 30s...");
            return;
        }

        // 3. Get Server Time
        let serverTime = Math.floor(Date.now() / 1000); 
        if (feed.header && feed.header.timestamp) {
            const feedTs = getSafeLong(feed.header.timestamp);
            if (feedTs > 0) serverTime = feedTs;
        }

        // 4. Process Trains
        const westTrains = [];
        const eastTrains = [];
        const processedTrips = new Set();
        
        for (const entity of feed.entity) {
            if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

            const trip = entity.tripUpdate;
            const tripId = trip.trip.tripId;
            
            // Avoid duplicates
            if (processedTrips.has(tripId)) continue;

            // Filter for Red/Blue Lines only
            const routeId = trip.trip.routeId || "";
            if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

            const lineColor = mapRouteColor(routeId);

            // Find our stop in the list
            for (const stopUpdate of trip.stopTimeUpdate) {
                const stopId = stopUpdate.stopId;
                const arrival = stopUpdate.arrival || stopUpdate.departure; 
                if (!arrival || !arrival.time) continue;

                const timeVal = getSafeLong(arrival.time);
                const minutes = calculateMinutes(timeVal, serverTime);

                // Filter: Only show trains in next 60 mins
                if (minutes === -1 || minutes > 60) continue;

                // Westbound (Tuscany / 69 St)
                if (stopId === STOP_CITY_HALL_WEST) {
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

                // Eastbound (Saddletowne / Somerset)
                if (stopId === STOP_CITY_HALL_EAST) {
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

        // 5. Sort by time
        westTrains.sort((a, b) => a.minutes - b.minutes);
        eastTrains.sort((a, b) => a.minutes - b.minutes);

        console.log(`✅ Update Success: Found ${westTrains.length} West, ${eastTrains.length} East`);

        // 6. RENDER TO SCREEN
        if (typeof window.renderColumn === "function") {
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
        }
    }

    // Run immediately, then every 30s
    update();
    setInterval(update, 30000);
}
