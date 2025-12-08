// ==========================================
// CONFIGURATION
// ==========================================

// Verified Stop IDs for City Hall / Bow Valley College (Free Fare Zone)
// Westbound (Towards Tuscany / 69 St / Downtown West)
const STOP_CITY_HALL_WEST = "6822"; 

// Eastbound (Towards Somerset / Saddletowne / NE / South)
const STOP_CITY_HALL_EAST = "6831"; 

const ROUTE_RED = "201";
const ROUTE_BLUE = "202";

// ==========================================
// UTILITIES
// ==========================================

function unixToMinutes(eta) {
    const now = Math.floor(Date.now() / 1000);
    const diff = eta - now;
    
    // FILTER: If the train departed more than 60 seconds ago (-1 min), 
    // we return -1 to indicate it should be hidden immediately.
    if (diff < -60) return -1; 
    
    // Otherwise return minutes (clamped to 0 minimum)
    return Math.max(0, Math.round(diff / 60));
}

function mapRouteColor(routeId) {
    if (routeId.includes(ROUTE_RED)) return "red";
    if (routeId.includes(ROUTE_BLUE)) return "blue";
    return "blue"; // Default fallback
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

    // Fetch Alerts
    const feed = await fetchGTFSRT(URL_ALERTS);
    
    let activeAlertMsg = "";

    if (feed && feed.entity) {
        // Find relevant alerts for Red (201) or Blue (202) lines
        const alertEntity = feed.entity.find(e => 
            e.alert && e.alert.informedEntity.some(ie => 
                ie.routeId && (ie.routeId.includes('201') || ie.routeId.includes('202'))
            )
        );

        if (alertEntity && alertEntity.alert.headerText) {
            // Get the English text (usually index 0)
            activeAlertMsg = alertEntity.alert.headerText.translation[0].text;
        }
    }

    // Toggle Visibility
    if (activeAlertMsg) {
        textSpan.innerText = activeAlertMsg;
        textSpan.classList.add('scrolling');
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
        textSpan.classList.remove('scrolling');
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

    const westTrains = [];
    const eastTrains = [];
    const processedTrips = new Set(); // For Deduplication

    for (const entity of feed.entity) {
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

        const trip = entity.tripUpdate;
        const tripId = trip.trip.tripId;

        // 1. Ghost Train Check: Skip if we've already seen this Trip ID
        if (processedTrips.has(tripId)) continue;

        const routeId = trip.trip.routeId || "";
        if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

        const lineColor = mapRouteColor(routeId);

        for (const stopUpdate of trip.stopTimeUpdate) {
            const stopId = stopUpdate.stopId;
            const arrival = stopUpdate.arrival || stopUpdate.departure; 

            if (!arrival || !arrival.time) continue;

            // 2. CRASH FIX: Safe Timestamp Conversion (Robust Duck Typing)
            let timeVal = arrival.time;
            
            // Check if it has a .toNumber() method (Standard Protobuf behavior)
            if (timeVal && typeof timeVal.toNumber === 'function') {
                timeVal = timeVal.toNumber();
            } 
            // Check if it looks like a Long object with low/high bits
            else if (typeof timeVal === 'object' && timeVal !== null && 'low' in timeVal) {
                 timeVal = timeVal.low;
            }
            // Otherwise, assume it's already a plain number

            const minutes = unixToMinutes(timeVal);

            // 3. Filter Invalid Times (-1 = departed, >60 = too far)
            if (minutes === -1 || minutes > 60) continue;

            // --- WESTBOUND MATCH ---
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

            // --- EASTBOUND MATCH ---
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
    console.log("🚀 Dashboard Engine Started");
    
    let failureCount = 0; // Track consecutive failures

    async function update() {
        // Toggle Heartbeat (Yellow = Loading)
        const liveDot = document.getElementById('live-indicator');
        if (liveDot) liveDot.classList.add('stale');

        try {
            // 1. Get Trains
            const { westTrains, eastTrains } = await buildTrainList();
            
            // 2. Check Alerts
            await updateAlertBanner();

            // 3. Empty State Check
            if (westTrains.length === 0 && eastTrains.length === 0) {
                 const msg = "<div style='opacity:0.5; padding:20px; font-size: 18px;'>No scheduled trains found.</div>";
                 const westCont = document.getElementById('westbound-container');
                 const eastCont = document.getElementById('eastbound-container');
                 
                 if (westCont) westCont.innerHTML = msg;
                 if (eastCont) eastCont.innerHTML = msg;
            }

            // 4. Render
            if (typeof window.renderColumn === "function") {
                if (westTrains.length > 0) window.renderColumn("westbound-container", westTrains);
                if (eastTrains.length > 0) window.renderColumn("eastbound-container", eastTrains);
            }

            // Success: Turn Heartbeat Green and Reset Failures
            if (liveDot) liveDot.classList.remove('stale');
            failureCount = 0; 
            console.log(`Updated: ${westTrains.length} West, ${eastTrains.length} East`);

        } catch (e) {
            console.error("Transit Engine Error:", e);
            
            // Leave Heartbeat Yellow/Orange to indicate stale data
            failureCount++;

            // SAFETY: If we fail 3 times (approx 90 seconds), clear the board
            // so we don't show old/incorrect times to students.
            if (failureCount >= 3) {
                const safeMessage = `<div style="font-size: 20px; opacity: 0.7; padding: 20px;">Updating connection...</div>`;
                const westCont = document.getElementById('westbound-container');
                const eastCont = document.getElementById('eastbound-container');
                
                if (westCont) westCont.innerHTML = safeMessage;
                if (eastCont) eastCont.innerHTML = safeMessage;
            }
        }
    }

    // Initial run
    update();
    
    // Refresh every 30 seconds
    setInterval(update, 30000); 
}
