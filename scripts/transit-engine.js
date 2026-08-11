// ==========================================
// TRANSIT ENGINE v9 — Instrumented
// ==========================================
// Same rendering and layout as v8. Adds a diagnostic pass that reports
// exactly where trains are lost between the feed and the screen.
// ==========================================

const STOP_CITY_HALL_WEST = "6822";
const STOP_CITY_HALL_EAST = "6831";
const ROUTE_RED  = "201";
const ROUTE_BLUE = "202";

// ==========================================
// UTILITIES
// ==========================================

function getSafeLong(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseInt(val, 10) || 0;
    if (typeof val.toNumber === 'function') return val.toNumber();
    if (val.low !== undefined) return val.low;
    return 0;
}

function calculateMinutes(eta, referenceTime) {
    const diff = eta - referenceTime;
    if (diff < -180) return -1;
    return Math.max(0, Math.round(diff / 60));
}

function mapRouteColor(routeId) {
    if (routeId.indexOf(ROUTE_RED) > -1)  return "red";
    if (routeId.indexOf(ROUTE_BLUE) > -1) return "blue";
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
// (index.html overrides these after load; kept here as a fallback)
// ==========================================

window.createTrainCard = window.createTrainCard || function(train, index) {
    const lineColor = train.line === 'red' ? 'line-red' : 'line-blue';
    const lineName  = train.line === 'red' ? '201 Red Line' : '202 Blue Line';
    const timeText  = train.minutes === 0 ? 'Now' : train.minutes;
    const minLabel  = train.minutes === 0 ? '' : '<span>min</span>';
    const pulse     = train.minutes <= 1 ? 'pulse-text' : '';
    return '<div class="train-card fade-in" style="animation-delay: ' + (index * 0.08) + 's">' +
           '<div class="line-strip ' + lineColor + '"></div>' +
           '<div class="dest-info">' +
           '<div class="dest-name">' + train.destination + '</div>' +
           '<div class="line-name">' + lineName + '</div>' +
           '</div>' +
           '<div class="arrival-info">' +
           '<div class="minutes ' + pulse + '">' + timeText + minLabel + '</div>' +
           '<div class="status-badge">' + train.status + '</div>' +
           '</div></div>';
};

window.renderColumn = window.renderColumn || function(containerId, trains) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!trains || trains.length === 0) {
        container.innerHTML = '<div class="train-card" style="opacity:0.6; justify-content:center;">No departures scheduled</div>';
        return;
    }
    let html = '';
    for (let i = 0; i < trains.length; i++) {
        html += window.createTrainCard(trains[i], i);
    }
    container.innerHTML = html;
};

// ==========================================
// DIAGNOSTIC — run once per session
// ==========================================
// Reports the four facts that determine whether the filter can match:
//   1. every route_id present in the feed
//   2. how old the feed's own timestamp is
//   3. every stop_id served by trips on routes 201/202
//   4. the raw arrival times found at 6822 / 6831
// ==========================================

let diagnosticDone = false;

function runFeedDiagnostic(feed) {
    if (diagnosticDone || !feed || !feed.entity) return;
    diagnosticDone = true;

    const routes = {};
    const ctrainStops = {};
    const hits = [];
    const now = Math.floor(Date.now() / 1000);
    const feedTs = feed.header ? getSafeLong(feed.header.timestamp) : 0;

    for (let i = 0; i < feed.entity.length; i++) {
        const e = feed.entity[i];
        if (!e.tripUpdate || !e.tripUpdate.trip) continue;

        const rid = e.tripUpdate.trip.routeId || "(none)";
        routes[rid] = (routes[rid] || 0) + 1;

        if (rid.indexOf(ROUTE_RED) > -1 || rid.indexOf(ROUTE_BLUE) > -1) {
            const stops = e.tripUpdate.stopTimeUpdate || [];
            for (let j = 0; j < stops.length; j++) {
                const s = stops[j];
                if (!s.stopId) continue;
                ctrainStops[s.stopId] = true;
                if (s.stopId === STOP_CITY_HALL_WEST || s.stopId === STOP_CITY_HALL_EAST) {
                    const a = s.arrival || s.departure;
                    const t = a ? getSafeLong(a.time) : 0;
                    hits.push({
                        route: rid,
                        stop: s.stopId,
                        minsFromFeedClock: t && feedTs ? Math.round((t - feedTs) / 60) : "n/a",
                        minsFromLocalClock: t ? Math.round((t - now) / 60) : "n/a"
                    });
                }
            }
        }
    }

    const routeList = Object.keys(routes).sort();
    const stopList  = Object.keys(ctrainStops).sort();

    console.log("──────── FEED DIAGNOSTIC ────────");
    console.log("A. entities in feed:", feed.entity.length);
    console.log("B. feed timestamp age (s):", feedTs ? (now - feedTs) : "NO TIMESTAMP");
    console.log("C. distinct route_ids (" + routeList.length + "):", routeList.join(", "));
    console.log("D. 201/202 present?", routeList.indexOf(ROUTE_RED) > -1 || routeList.indexOf(ROUTE_BLUE) > -1);
    console.log("E. stop_ids on 201/202 trips (" + stopList.length + "):", stopList.join(", "));
    console.log("F. matches at 6822/6831:", hits.length ? JSON.stringify(hits.slice(0, 12)) : "NONE");
    console.log("─────────────────────────────────");
}

// ==========================================
// FEED PARSING
// ==========================================

function parseTrainsFromFeed(feed) {
    if (!feed || !feed.entity) return { westTrains: [], eastTrains: [] };

    // Reference clock: prefer the feed's own timestamp so arrival times are
    // compared within the same time domain. Fall back to local time, and also
    // fall back if the feed timestamp is absurdly stale (>10 min), which would
    // otherwise push every train into the future and break the >60 min filter.
    const feedTs = feed.header ? getSafeLong(feed.header.timestamp) : 0;
    const localNow = Math.floor(Date.now() / 1000);
    const feedAge = feedTs > 0 ? (localNow - feedTs) : 999999;
    const now = (feedTs > 0 && Math.abs(feedAge) < 600) ? feedTs : localNow;

    const westTrains = [];
    const eastTrains = [];
    const processedTrips = {};

    for (let i = 0; i < feed.entity.length; i++) {
        const entity = feed.entity[i];
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue;

        const trip = entity.tripUpdate;
        if (!trip.trip) continue;

        const tripId = trip.trip.tripId || ("idx" + i);
        if (processedTrips[tripId]) continue;

        const routeId = trip.trip.routeId || "";
        if (routeId.indexOf(ROUTE_RED) === -1 && routeId.indexOf(ROUTE_BLUE) === -1) continue;

        const lineColor = mapRouteColor(routeId);

        for (let j = 0; j < trip.stopTimeUpdate.length; j++) {
            const stopUpdate = trip.stopTimeUpdate[j];
            const stopId  = stopUpdate.stopId;
            if (stopId !== STOP_CITY_HALL_WEST && stopId !== STOP_CITY_HALL_EAST) continue;

            const arrival = stopUpdate.arrival || stopUpdate.departure;
            if (!arrival || !arrival.time) continue;

            const timeVal = getSafeLong(arrival.time);
            const minutes = calculateMinutes(timeVal, now);
            if (minutes === -1 || minutes > 60) continue;

            const train = {
                destination: getDestinationName(lineColor, stopId === STOP_CITY_HALL_WEST ? 'WEST' : 'EAST'),
                line: lineColor,
                minutes: minutes,
                status: minutes <= 1 ? "Boarding" : "On Time",
                tripId: tripId
            };

            if (stopId === STOP_CITY_HALL_WEST) westTrains.push(train);
            else eastTrains.push(train);

            processedTrips[tripId] = true;
            break;
        }
    }

    westTrains.sort(function (a, b) { return a.minutes - b.minutes; });
    eastTrains.sort(function (a, b) { return a.minutes - b.minutes; });

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
    for (let i = 0; i < feed.entity.length; i++) {
        const e = feed.entity[i];
        if (!e.alert || !e.alert.informedEntity) continue;
        let relevant = false;
        for (let j = 0; j < e.alert.informedEntity.length; j++) {
            const rid = e.alert.informedEntity[j].routeId;
            if (rid && (rid.indexOf('201') > -1 || rid.indexOf('202') > -1)) { relevant = true; break; }
        }
        if (relevant && e.alert.headerText && e.alert.headerText.translation &&
            e.alert.headerText.translation.length) {
            return e.alert.headerText.translation[0].text;
        }
    }
    return null;
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
    console.log("🚀 TRANSIT ENGINE v9 — Instrumented");

    const liveDot = document.getElementById('live-indicator');

    // ── STEP 1: Render cached data immediately, if it is fresh enough ─────────
    const FEED_MAX_AGE_S = 35;
    const cachedTrips  = getCachedFeed(URL_TRIP_UPDATES);
    const cachedAlerts = getCachedFeed(URL_ALERTS);

    if (cachedTrips) {
        const feedTs = cachedTrips.header ? getSafeLong(cachedTrips.header.timestamp) : 0;
        const ageSeconds = feedTs > 0 ? (Math.floor(Date.now() / 1000) - feedTs) : 999;

        if (ageSeconds <= FEED_MAX_AGE_S) {
            const cachedResult = parseTrainsFromFeed(cachedTrips);
            window.renderColumn("westbound-container", cachedResult.westTrains);
            window.renderColumn("eastbound-container", cachedResult.eastTrains);
            console.log("📦 Cached trains rendered (feed age: " + ageSeconds + "s)");
        } else {
            console.log("⏭️ Cache skipped — feed age " + ageSeconds + "s, waiting for live data");
        }
    }
    if (cachedAlerts) {
        renderAlertBanner(parseAlertFromFeed(cachedAlerts));
    }

    // ── STEP 2: Live fetch, both feeds in parallel ───────────────────────────
    async function update() {
        if (liveDot) liveDot.classList.add('stale');

        try {
            const results = await Promise.all([
                getTripUpdates(),
                fetchGTFSRT(URL_ALERTS)
            ]);
            const tripFeed  = results[0];
            const alertFeed = results[1];

            runFeedDiagnostic(tripFeed);

            const parsed = parseTrainsFromFeed(tripFeed);
            window.renderColumn("westbound-container", parsed.westTrains);
            window.renderColumn("eastbound-container", parsed.eastTrains);
            renderAlertBanner(parseAlertFromFeed(alertFeed));

            if (liveDot) liveDot.classList.remove('stale');
            console.log("✅ Live data rendered — " + parsed.westTrains.length + "W / " +
                        parsed.eastTrains.length + "E trains");

        } catch (err) {
            console.error("Engine update error:", err);
            if (liveDot) liveDot.classList.add('stale');
        }
    }

    update();
    setInterval(update, 30000);
}
