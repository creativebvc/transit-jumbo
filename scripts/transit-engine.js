// ==========================================
// TRANSIT ENGINE v8 — Instant-Load Edition
// ==========================================

const STOP_CITY_HALL_WEST = "6822";
const STOP_CITY_HALL_EAST = "6831";
const ROUTE_RED  = "201";
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
    // Keep trains for up to 3 min past scheduled time (feed updates every 30s,
    // so a train can appear "past" while still boarding at the platform).
    if (diff < -180) return -1;
    return Math.max(0, Math.round(diff / 60));
}

function mapRouteColor(routeId) {
    if (routeId.includes(ROUTE_RED))  return "red";
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
// RENDERING
// ==========================================

window.createTrainCard = function(train, index) {
    const lineColor = train.line === 'red' ? 'line-red' : 'line-blue';
    const lineName  = train.line === 'red' ? '201 Red Line' : '202 Blue Line';
    const timeText  = train.minutes === 0 ? 'Now' : train.minutes;
    const minLabel  = train.minutes === 0 ? '' : '<span>min</span>';
    const pulse     = train.minutes <= 1 ? 'pulse-text' : '';
    return `
        <div class="train-card fade-in" style="animation-delay: ${index * 0.08}s">
            <div class="line-strip ${lineColor}"></div>
            <div class="dest-info">
                <div class="dest-name">${train.destination}</div>
                <div class="line-name">${lineName}</div>
            </div>
            <div class="arrival-info">
                <div class="minutes ${pulse}">${timeText}${minLabel}</div>
                <div class="status-badge">${train.status}</div>
            </div>
        </div>`;
};

window.renderColumn = function(containerId, trains) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!trains || trains.length === 0) {
        container.innerHTML = `<div class="train-card" style="opacity:0.6; justify-content:center;">No departures scheduled</div>`;
        return;
    }
    container.innerHTML = trains.map((t, i) => window.createTrainCard(t, i)).join('');
};

// ==========================================
// FEED PARSING
// ==========================================

function parseTrainsFromFeed(feed) {
    if (!feed || !feed.entity) return { westTrains: [], eastTrains: [] };

    // Use the feed's own timestamp as the reference clock.
    // This keeps arrival times in the same time domain as the feed data,
    // preventing trains from being incorrectly filtered out when the feed
    // is slightly stale or there's local clock drift.
    // Fall back to local time only if the feed has no timestamp.
    const feedTs = feed.header ? getSafeLong(feed.header.timestamp) : 0;
    const now = feedTs > 0 ? feedTs : Math.floor(Date.now() / 1000);
    const westTrains = [];
    const eastTrains = [];
    const processedTrips = new Set();

    for (const entity of feed.entity) {
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

        const trip   = entity.tripUpdate;
        const tripId = trip.trip.tripId;
        if (processedTrips.has(tripId)) continue;

        const routeId = trip.trip.routeId || "";
        if (!routeId.includes(ROUTE_RED) && !routeId.includes(ROUTE_BLUE)) continue;

        const lineColor = mapRouteColor(routeId);

        for (const stopUpdate of trip.stopTimeUpdate) {
            const stopId  = stopUpdate.stopId;
            const arrival = stopUpdate.arrival || stopUpdate.departure;
            if (!arrival || !arrival.time) continue;

            const timeVal = getSafeLong(arrival.time);
            const minutes = calculateMinutes(timeVal, now);
            if (minutes === -1 || minutes > 60) continue;

            if (stopId === STOP_CITY_HALL_WEST) {
                westTrains.push({
                    destination: getDestinationName(lineColor, 'WEST'),
                    line: lineColor, minutes,
                    status: minutes <= 1 ? "Boarding" : "On Time",
                    tripId
                });
                processedTrips.add(tripId);
                break;
            }

            if (stopId === STOP_CITY_HALL_EAST) {
                eastTrains.push({
                    destination: getDestinationName(lineColor, 'EAST'),
                    line: lineColor, minutes,
                    status: minutes <= 1 ? "Boarding" : "On Time",
                    tripId
                });
                processedTrips.add(tripId);
                break;
            }
        }
    }

    westTrains.sort((a, b) => a.minutes - b.minutes);
    eastTrains.sort((a, b) => a.minutes - b.minutes);

    return {
        westTrains: westTrains.slice(0, 4),
        eastTrains: eastTrains.slice(0, 4)
    };
}

// ==========================================
// ALERT LOGIC
// ==========================================

function parseAlertFromFeed(feed) {
    if (!feed || !feed.entity) return null;
    const alertEntity = feed.entity.find(e =>
        e.alert?.informedEntity?.some(ie =>
            ie.routeId && (ie.routeId.includes('201') || ie.routeId.includes('202'))
        )
    );
    return alertEntity?.alert?.headerText?.translation?.[0]?.text || null;
}

function renderAlertBanner(alertMsg) {
    const footer   = document.getElementById('service-footer');
    const textSpan = document.getElementById('service-text');
    if (!footer || !textSpan) return;
    if (alertMsg) {
        textSpan.innerText = "⚠️ SERVICE ALERT: " + alertMsg;
        footer.className   = 'status-alert';
    } else {
        textSpan.innerText = "✅ Normal Service: All trains running on schedule.";
        footer.className   = 'status-ok';
    }
}

// ==========================================
// ENGINE START
// ==========================================

async function startTransitDashboard() {
    console.log("🚀 TRANSIT ENGINE v8 — Instant-Load");

    const liveDot = document.getElementById('live-indicator');

    // ── STEP 1: Render cached data IMMEDIATELY (zero network wait) ────────────
    // Only render cache if the feed itself is fresh enough that its arrival
    // timestamps are still valid. If the cache is stale, rendering it produces
    // an empty board (all trains calculate as already departed).
    const FEED_MAX_AGE_S = 35; // feed updates every 30s, so 35s is a safe ceiling
    const cachedTrips  = getCachedFeed(URL_TRIP_UPDATES);
    const cachedAlerts = getCachedFeed(URL_ALERTS);

    if (cachedTrips) {
        const feedTs = cachedTrips.header ? getSafeLong(cachedTrips.header.timestamp) : 0;
        const ageSeconds = feedTs > 0 ? (Math.floor(Date.now() / 1000) - feedTs) : 999;

        if (ageSeconds <= FEED_MAX_AGE_S) {
            const { westTrains, eastTrains } = parseTrainsFromFeed(cachedTrips);
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
            console.log(`📦 Cached trains rendered (feed age: ${ageSeconds}s)`);
        } else {
            console.log(`⏭️ Cache skipped — feed too old (${ageSeconds}s), waiting for live data`);
        }
    }
    if (cachedAlerts) {
        renderAlertBanner(parseAlertFromFeed(cachedAlerts));
    }

    // ── STEP 2: Fetch live data, update display when ready ───────────────────
    async function update() {
        if (liveDot) liveDot.classList.add('stale');

        try {
            // Fetch both feeds in parallel — not one after the other
            const [tripFeed, alertFeed] = await Promise.all([
                getTripUpdates(),
                fetchGTFSRT(URL_ALERTS)
            ]);

            const { westTrains, eastTrains } = parseTrainsFromFeed(tripFeed);
            window.renderColumn("westbound-container", westTrains);
            window.renderColumn("eastbound-container", eastTrains);
            renderAlertBanner(parseAlertFromFeed(alertFeed));

            if (liveDot) liveDot.classList.remove('stale');
            console.log(`✅ Live data rendered — ${westTrains.length}W / ${eastTrains.length}E trains`);

        } catch (err) {
            console.error("Engine update error:", err);
            if (liveDot) liveDot.classList.add('stale');
            // Don't wipe the screen — cached data stays visible
        }
    }

    update();
    setInterval(update, 30000);
}
