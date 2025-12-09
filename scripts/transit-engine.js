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
// ALERT LOGIC
// ==========================================

async function updateAlertBanner() {
    const footer = document.getElementById('service-footer');
    const textSpan = document.getElementById('service-text');
    if (!footer || !textSpan) return;

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
            textSpan.innerText = "⚠️ SERVICE ALERT: " + activeAlertMsg;
            footer.className = 'status-alert'; 
        } else {
            textSpan.innerText = "✅ Normal Service: All trains running on schedule.";
            footer.className = 'status-ok'; 
        }
    } catch(e) {
        console.warn("Alert fetch failed", e);
        textSpan.innerText = "✅ Normal Service: All trains running on schedule."; 
        footer.className = 'status-ok';
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

        const trip = entity.tripUpdate;
        const tripId = trip.trip.tripId;
        
        if (processedTrips.has(tripId)) continue;

        const routeId = trip.trip.routeId || "";
        if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

        const lineColor = mapRouteColor(routeId);

        for (const stopUpdate of trip.stopTimeUpdate) {
            const stopId = stopUpdate.stopId;
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

    return { 
        westTrains: westTrains.slice(0, 3), 
        eastTrains: eastTrains.slice(0, 3) 
    };
}

// ==========================================
// ENGINE START
// ==========================================

async function startTransitDashboard() {
    console.log("🚀 CLOCK-PROOF ENGINE v7 STARTED");
    
    let failureCount = 0;

    async function update() {
        const liveDot = document.getElementById('live-indicator');
        if (liveDot) liveDot.classList.add('stale');

        try {
            const { westTrains, eastTrains } = await buildTrainList();
            
            // Render
            const westCont = document.getElementById('westbound-container');
            const eastCont = document.getElementById('eastbound-container');

            // --- UX FIX: EMPTY STATE ---
            if (westTrains.length === 0 && eastTrains.length === 0) {
                 // Changed from "No trains found" to "Loading schedule..."
                 // Added 'train-card' class so it looks beautiful (Glass UI)
                 const msg = `<div class="train-card" style="opacity:0.6; justify-content:center;">Loading schedule...</div>`;
                 
                 if (westCont) westCont.innerHTML = msg;
                 if (eastCont) eastCont.innerHTML = msg;
            } else {
                // Normal Render
                if (typeof window.renderColumn === "function") {
                    window.renderColumn("westbound-container", westTrains);
                    window.renderColumn("eastbound-container", eastTrains);
                }
            }

            // Check Alerts
            await updateAlertBanner();

            if (liveDot) liveDot.classList.remove('stale');
            failureCount = 0; 

        } catch (e) {
            console.error("Transit Engine Error:", e);
            failureCount++;
            if (failureCount >= 3) {
                // This message also uses the card style now
                const safeMessage = `<div class="train-card" style="opacity:0.6; justify-content:center;">Reconnecting...</div>`;
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
