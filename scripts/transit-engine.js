// ==========================================
// CONFIGURATION
// ==========================================
const STOP_CITY_HALL_WEST = "6822"; 
const STOP_CITY_HALL_EAST = "6831"; 
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
    if (diff < -90) return -1; 
    return Math.max(0, Math.round(diff / 60)); 
}

function mapRouteColor(routeId) {
    if (routeId.includes(ROUTE_RED)) return "red";
    if (routeId.includes(ROUTE_BLUE)) return "blue";
    return "blue"; 
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
    console.log("🚀 ENGINE ONLINE: HYBRID MODE v2");

    async function update() {
        const feed = await getTripUpdates();
        
        if (!feed || !feed.entity) {
            console.warn("⚠️ Data fetch empty. Retrying in 30s...");
            return;
        }

        // Get Server Time
        let serverTime = Math.floor(Date.now() / 1000); 
        if (feed.header && feed.header.timestamp) {
            const feedTs = getSafeLong(feed.header.timestamp);
            if (feedTs > 0) serverTime = feedTs;
        }

        const westTrains = [];
        const eastTrains = [];
        const processedTrips = new Set();
        
        // DEBUG: Log the first entity to see exactly what the data looks like
        if (feed.entity.length > 0) {
            console.log("🔍 Sample Data Structure:", feed.entity[0]);
        }
        
        for (const entity of feed.entity) {
            // HYBRID CHECK: Handle both CamelCase and snake_case
            const tripUpdate = entity.tripUpdate || entity.trip_update;
            if (!tripUpdate) continue;

            const stopTimeUpdate = tripUpdate.stopTimeUpdate || tripUpdate.stop_time_update;
            if (!stopTimeUpdate) continue;

            const trip = tripUpdate.trip;
            // HYBRID CHECK: tripId vs trip_id
            const tripId = trip.tripId || trip.trip_id;
            
            if (processedTrips.has(tripId)) continue;

            // HYBRID CHECK: routeId vs route_id
            const routeId = trip.routeId || trip.route_id || "";
            if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

            const lineColor = mapRouteColor(routeId);

            for (const stopUpdate of stopTimeUpdate) {
                // HYBRID CHECK: stopId vs stop_id
                const stopId = stopUpdate.stopId || stopUpdate.stop_id;
                const arrival = stopUpdate.arrival || stopUpdate.departure; 
                
                if (!arrival || !arrival.time) continue;

                const timeVal = getSafeLong(arrival.time);
                const minutes = calculateMinutes(timeVal, serverTime);

                if (minutes === -1 || minutes > 60) continue;

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

        westTrains.sort((a, b) => a.minutes - b.minutes);
        eastTrains.sort((a, b) => a.minutes - b.minutes);

        console.log(`✅ Update Success: Found ${westTrains.length} West, ${eastTrains.length} East`);

        if (typeof window.renderColumn === "function") {
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
        }
    }

    update();
    setInterval(update, 30000);
}
