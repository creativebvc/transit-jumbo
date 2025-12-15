// ==========================================
// CONFIGURATION
// ==========================================
// 1. PRIMARY: The Standard Stop IDs you want to use
const STOP_WEST_ID = "6822"; 
const STOP_EAST_ID = "6831";

// 2. BACKUP: City Hall Coordinates for GPS Radar
const CITY_HALL_LAT = 51.04625; 
const CITY_HALL_LON = -114.05694; 

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
    return Math.max(0, Math.round(diff / 60)); 
}

// Haversine: Distance between GPS points in KM
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of earth in km
  var dLat = deg2rad(lat2-lat1);  
  var dLon = deg2rad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

function deg2rad(deg) { return deg * (Math.PI/180); }

function estimateGPSMinutes(distKm) {
    if (distKm < 0.2) return 0; // At station
    // Approx 2.5 mins per km in downtown traffic
    return Math.ceil(distKm * 2.5); 
}

function mapRouteColor(routeId) {
    if (!routeId) return "blue";
    if (routeId.includes("201") || routeId.includes("Red") || routeId.includes("156")) return "red";
    if (routeId.includes("202") || routeId.includes("Blue")) return "blue";
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
// 1. ALERT LOGIC
// ==========================================
async function updateAlerts() {
    const footer = document.getElementById('service-footer');
    const textSpan = document.getElementById('service-text');
    if (!footer || !textSpan) return;

    const feed = await getServiceAlerts(); // Uses URL_ALERTS from your API file
    
    let alertMsg = "";
    if (feed && feed.entity) {
        for (const entity of feed.entity) {
            if (!entity.alert) continue;
            
            // Filter: Only show alerts for Route 201/202
            const affectsTrain = entity.alert.informedEntity && entity.alert.informedEntity.some(e => {
                const r = e.routeId || "";
                return r.includes("201") || r.includes("202");
            });

            if (affectsTrain) {
                const header = entity.alert.headerText;
                if (header && header.translation) {
                    const english = header.translation.find(t => t.language === "en" || !t.language);
                    if (english) {
                        alertMsg = english.text;
                        break; // Show first train alert found
                    }
                }
            }
        }
    }

    if (alertMsg) {
        textSpan.innerText = "⚠️ SERVICE ALERT: " + alertMsg;
        footer.className = 'status-alert'; // Ensure CSS has .status-alert { background: red; }
    } else {
        textSpan.innerText = "✅ Normal Service";
        footer.className = 'status-ok';
    }
}

// ==========================================
// 2. MAIN ENGINE
// ==========================================
async function startTransitDashboard() {
    console.log("🚀 ENGINE ONLINE: HYBRID (6822/6831 -> GPS Fallback)");

    async function update() {
        let westTrains = [];
        let eastTrains = [];
        let sourceUsed = "SCHEDULE";

        // --- TRY 1: STANDARD STOPS (6822 / 6831) ---
        const feed = await getTripUpdates();
        let serverTime = Math.floor(Date.now() / 1000);
        
        // We track if we found ANY data for our specific stops
        let foundPrimaryData = false;

        if (feed && feed.entity) {
             for (const entity of feed.entity) {
                if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;
                
                const trip = entity.tripUpdate.trip;
                const routeId = trip.routeId || "";
                const lineColor = mapRouteColor(routeId);

                for (const stopUpdate of entity.tripUpdate.stopTimeUpdate) {
                    const stopId = stopUpdate.stopId;
                    const arrival = stopUpdate.arrival || stopUpdate.departure; 
                    if (!arrival || !arrival.time) continue;

                    const timeVal = getSafeLong(arrival.time);
                    const minutes = calculateMinutes(timeVal, serverTime);
                    if (minutes > 60) continue;

                    // CHECK WEST (6822)
                    if (stopId === STOP_WEST_ID) {
                        westTrains.push({
                            destination: getDestinationName(lineColor, 'WEST'),
                            line: lineColor,
                            minutes: minutes,
                            status: minutes <= 1 ? "Boarding" : "On Time",
                            tripId: trip.tripId
                        });
                        foundPrimaryData = true;
                    }
                    // CHECK EAST (6831)
                    if (stopId === STOP_EAST_ID) {
                        eastTrains.push({
                            destination: getDestinationName(lineColor, 'EAST'),
                            line: lineColor,
                            minutes: minutes,
                            status: minutes <= 1 ? "Boarding" : "On Time",
                            tripId: trip.tripId
                        });
                        foundPrimaryData = true;
                    }
                }
            }
        }

        // --- TRY 2: GPS BACKUP (If Schedule is Empty) ---
        // If we found NO trains for our stops, assume data disruption and switch to GPS
        if (!foundPrimaryData || (westTrains.length === 0 && eastTrains.length === 0)) {
            console.warn("⚠️ No data for Stops 6822/6831. Switching to GPS RADAR.");
            sourceUsed = "GPS";
            
            const gpsFeed = await getVehiclePositions();
            
            if (gpsFeed && gpsFeed.entity) {
                // Reset arrays to ensure no duplicates/garbage
                westTrains = []; 
                eastTrains = [];

                for (const entity of gpsFeed.entity) {
                    if (!entity.vehicle || !entity.vehicle.position) continue;
                    
                    const v = entity.vehicle;
                    const rId = v.trip ? (v.trip.routeId || "") : "";
                    
                    // Filter: Only Red (201) and Blue (202)
                    if (!rId.includes("201") && !rId.includes("202") && !rId.includes("156")) continue;

                    // 1. Calc Distance
                    const dist = getDistanceFromLatLonInKm(
                        CITY_HALL_LAT, CITY_HALL_LON, 
                        v.position.latitude, v.position.longitude
                    );

                    // 2. Filter: Only trains within 8km
                    if (dist > 8.0) continue;

                    const minutes = estimateGPSMinutes(dist);
                    const lineColor = mapRouteColor(rId);
                    
                    // 3. Determine Direction based on Bearing
                    let direction = "WEST"; 
                    const bearing = v.position.bearing || 0;
                    
                    // 45-135 deg = EAST
                    // 225-315 deg = WEST
                    if (bearing > 45 && bearing < 135) direction = "EAST";
                    else if (bearing > 225 && bearing < 315) direction = "WEST";
                    else continue; 

                    const trainData = {
                        destination: getDestinationName(lineColor, direction),
                        line: lineColor,
                        minutes: minutes,
                        status: minutes <= 1 ? "Boarding" : "On Time",
                        tripId: v.trip ? v.trip.tripId : "gps-" + v.vehicle.id
                    };

                    if (direction === "WEST") westTrains.push(trainData);
                    else eastTrains.push(trainData);
                }
            }
        }

        // Sort by time
        westTrains.sort((a, b) => a.minutes - b.minutes);
        eastTrains.sort((a, b) => a.minutes - b.minutes);

        console.log(`✅ Update (${sourceUsed}): ${westTrains.length} West, ${eastTrains.length} East`);

        if (typeof window.renderColumn === "function") {
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
        }
        
        // Update Ticker
        await updateAlerts();
    }

    update();
    setInterval(update, 30000);
}
