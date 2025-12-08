// ==========================================
// CONFIGURATION
// ==========================================

// Verified Stop IDs for City Hall / Bow Valley College (Free Fare Zone)
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
    if (typeof val.toNumber === 'function') return val.toNumber();
    if (val.low !== undefined) return val.low;
    return 0;
}

function calculateMinutes(eta, referenceTime) {
    // CLOCK-PROOF FIX: Compare against Server Time, not Computer Time
    const diff = eta - referenceTime;
    
    // Filter: Allow trains that departed up to 90 seconds ago (buffer)
    if (diff < -90) return -1; 
    
    // Return minutes
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
// ALERT LOGIC
// ==========================================

async function updateAlertBanner() {
    const banner = document.getElementById('alert-banner');
    const textSpan = document.getElementById('alert-text');
    if (!banner || !textSpan) return;

    try {
        const feed = await fetchGTFSRT(URL_ALERTS);
        let activeAlertMsg = "";

        if (feed && feed.entity) {
            const alertEntity = feed.entity.find(e => 
                e.alert && e.alert.informedEntity && e.alert.informedEntity.some(ie => 
                    ie.routeId && (ie.routeId.includes('201') || ie.routeId.includes('202'))
                )
            );

            if (alertEntity && alertEntity.alert.headerText && alertEntity.alert.headerText.translation) {
                activeAlertMsg = alertEntity.alert.headerText.translation[0].text;
            }
        }

        if (activeAlertMsg) {
            textSpan.innerText = activeAlertMsg;
            textSpan.classList.add('scrolling');
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            textSpan.classList.remove('scrolling');
        }
    } catch(e) {
        console.warn("Alert fetch failed", e);
    }
}

// ==========================================
// MAIN TRAIN LOGIC
// ==========================================

async function buildTrainList() {
    const feed = await getTripUpdates();
    
    if (!feed || !feed.entity) {
        console.warn("No data received from TripUpdates feed");
        return { westTrains: [], eastTrains: [] };
    }

    // --- TIME SYNC FIX ---
    // Use the timestamp from the City's server, NOT your computer's clock.
    let serverTime = Math.floor(Date.now() / 1000); 
    if (feed.header && feed.header.timestamp) {
        const feedTs = getSafeLong(feed.header.timestamp);
        if (feedTs > 0) serverTime = feedTs;
    }
    // ---------------------

    const westTrains = [];
    const eastTrains = [];
    const processedTrips = new Set();
    
    // DEBUG: Count what we see
    let debugScan = { total: 0, redBlue: 0, relevantStops: 0 };

    for (const entity of feed.entity) {
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

        const trip = entity.tripUpdate;
        const tripId = trip.trip.tripId;
        
        if (processedTrips.has(tripId)) continue;
        debugScan.total++;

        const routeId = trip.trip.routeId || "";
        if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;
        debugScan.redBlue++;

        const lineColor = mapRouteColor(routeId);

        for (const stopUpdate of trip.stopTimeUpdate) {
            const stopId = stopUpdate.stopId;
            const arrival = stopUpdate.arrival || stopUpdate.departure; 
            if (!arrival || !arrival.time) continue;

            const timeVal = getSafeLong(arrival.time);
            const minutes = calculateMinutes(timeVal, serverTime);

            // Check if this is our stop (for debugging)
            if (stopId === STOP_CITY_HALL_WEST || stopId === STOP_CITY_HALL_EAST) {
                debugScan.relevantStops++;
            }

            if (minutes === -1 || minutes > 60) continue;

            // --- WESTBOUND ---
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

            // --- EASTBOUND ---
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

    // Print the DEBUG SCAN to the console
    console.log(`🔍 SCAN REPORT: Saw ${debugScan.total} trips. ${debugScan.redBlue} were Red/Blue. ${debugScan.relevantStops} stopped at City Hall.`);

    // Sort by time
    westTrains.sort((a, b) => a.minutes - b.minutes);
    eastTrains.sort((a, b) => a.minutes - b.minutes);

    return { 
        westTrains: westTrains.slice(0, 3), 
        eastTrains: eastTrains.slice(0, 3) 
    };
}

// ==========================================
// ENGINE START
// ==========================================

async function startTransitDashboard() {
    console.log("🚀 CLOCK-PROOF ENGINE v3 STARTED");
    
    let failureCount = 0;

    async function update() {
        const liveDot = document.getElementById('live-indicator');
        if (liveDot) liveDot.classList.add('stale');

        try {
            const { westTrains, eastTrains } = await buildTrainList();
            await updateAlertBanner();

            // Render
            const westCont = document.getElementById('westbound-container');
            const eastCont = document.getElementById('eastbound-container');

            // Pass data to the HTML renderer
            if (typeof window.renderColumn === "function") {
                window.renderColumn("westbound-container", westTrains);
                window.renderColumn("eastbound-container", eastTrains);
            }

            if (liveDot) liveDot.classList.remove('stale');
            failureCount = 0; 
            console.log(`✅ Valid Trains: ${westTrains.length} West, ${eastTrains.length} East`);

        } catch (e) {
            console.error("Transit Engine Error:", e);
            failureCount++;
            if (failureCount >= 3) {
                const safeMessage = `<div style="font-size: 20px; opacity: 0.7; padding: 20px;">Reconnecting...</div>`;
                const westCont = document.getElementById('westbound-container');
                const eastCont = document.getElementById('eastbound-container');
                if (westCont) westCont.innerHTML = safeMessage;
                if (eastCont) eastCont.innerHTML = safeMessage;
            }
        }
    }

    update();
    setInterval(update, 30000); 
}
