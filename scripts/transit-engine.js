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
    // Filter: Allow trains that departed up to 90 seconds ago (buffer)
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
            const alertEntity = feed.entity.find(e => {
                const alert = e.alert;
                if (!alert) return false;
                const entities = alert.informedEntity || alert.informed_entity || [];
                return entities.some(ie => {
                    const rId = ie.routeId || ie.route_id || "";
                    return rId.includes('201') || rId.includes('202');
                });
            });

            if (alertEntity) {
                const alert = alertEntity.alert;
                const headerText = alert.headerText || alert.header_text;
                if (headerText && headerText.translation && headerText.translation[0]) {
                    activeAlertMsg = headerText.translation[0].text;
                }
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
    }
}

// ==========================================
// MAIN TRAIN LOGIC
// ==========================================

async function buildTrainList() {
    const feed = await getTripUpdates();
    
    // Safety check: If feed is null/undefined, return null so we can retry
    if (!feed || !feed.entity) {
        return null;
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
        // Handle potentially different capitalization from protobuf
        const tripUpdate = entity.tripUpdate || entity.trip_update;
        if (!tripUpdate) continue;

        const stopTimeUpdate = tripUpdate.stopTimeUpdate || tripUpdate.stop_time_update;
        if (!stopTimeUpdate) continue;

        const tripDescriptor = tripUpdate.trip;
        const tripId = tripDescriptor.tripId || tripDescriptor.trip_id;
        
        if (processedTrips.has(tripId)) continue;

        const routeId = tripDescriptor.routeId || tripDescriptor.route_id || "";
        if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

        const lineColor = mapRouteColor(routeId);

        for (const stopUpdate of stopTimeUpdate) {
            const stopId = stopUpdate.stopId || stopUpdate.stop_id;
            const arrival = stopUpdate.arrival || stopUpdate.departure; 
            if (!arrival || !arrival.time) continue;

            const timeVal = getSafeLong(arrival.time);
            const minutes = calculateMinutes(timeVal, serverTime);

            // STRICT FILTER: Only show trains arriving within 60 minutes
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
        // LIMIT: 4 Trains
        westTrains: westTrains.slice(0, 4), 
        eastTrains: eastTrains.slice(0, 4) 
    };
}

// ==========================================
// ENGINE START (SMART SCHEDULER)
// ==========================================

async function startTransitDashboard() {
    console.log("🚀 CLOCK-PROOF ENGINE v15 STARTED (FAST RETRY MODE)");
    
    let isFirstLoad = true;

    async function update() {
        const liveDot = document.getElementById('live-indicator');
        if (liveDot) liveDot.classList.add('stale');

        try {
            const data = await buildTrainList();
            
            // Logic: Determine when the next update should happen
            // Default to 30 seconds
            let nextUpdateDelay = 30000; 

            if (!data) {
                // CASE 1: Download Failed (likely 429 or Network)
                console.warn("⚠️ Data fetch failed. Retrying in 5 seconds...");
                nextUpdateDelay = 5000; // Wait 5s to let Cloudflare cool down
            } else {
                // CASE 2: Success!
                const { westTrains, eastTrains } = data;
                
                // Render
                const westCont = document.getElementById('westbound-container');
                const eastCont = document.getElementById('eastbound-container');

                if (westTrains.length === 0 && eastTrains.length === 0) {
                     // Empty State
                     const msg = `<div class="train-card" style="opacity:0.6; justify-content:center;">Loading schedule...</div>`;
                     if (westCont) westCont.innerHTML = msg;
                     if (eastCont) eastCont.innerHTML = msg;
                     
                     // If we are just starting and found nothing, check again soon
                     if (isFirstLoad) nextUpdateDelay = 5000; 
                } else {
                    isFirstLoad = false; 
                    if (typeof window.renderColumn === "function") {
                        window.renderColumn("westbound-container", westTrains);
                        window.renderColumn("eastbound-container", eastTrains);
                    }
                }
            }

            await updateAlertBanner();

            if (liveDot) liveDot.classList.remove('stale');
            
            // Schedule the next update safely
            setTimeout(update, nextUpdateDelay);

        } catch (e) {
            console.error("Transit Engine Crash:", e);
            // If the engine crashes, wait 5s and try again
            setTimeout(update, 5000); 
        }
    }

    // Start
    update();
}
