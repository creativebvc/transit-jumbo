// ==========================================
// ALBERTA TIME
// ------------------------------------------
// Alberta Time is UTC-6 all year, with no clock changes. It replaced Mountain
// Time on Sunday Nov 1, 2026 (the old Mountain Daylight Time, kept permanently).
//
// WHY THIS FILE EXISTS
// Anything that reads the TV's own time zone (getHours, getDate, getDay,
// toLocaleTimeString, Intl with a timeZone) trusts the time zone database
// baked into the TV firmware. TVs with older firmware still believe Alberta
// falls back to UTC-7 on Nov 1, so they show an hour early (8:38 instead of
// 9:38). Passing "America/Edmonton" to Intl does not help, because it reads
// that same outdated database.
//
// This helper uses only the UTC epoch (Date.now(), correct on every TV
// regardless of its time zone setting) plus the fixed offset below, so the
// TV's zone setting and firmware cannot change the result.
//
// IF ALBERTA'S RULES EVER CHANGE, edit ALBERTA_UTC_OFFSET_MIN and nothing else.
//
// ES5 only for WebOS/Tizen: no Intl, no arrow functions, no template literals.
// ==========================================

var ALBERTA_UTC_OFFSET_MIN = -360;   // UTC-6

// A Date whose getUTC*() fields read as Alberta wall-clock time for instant ms.
function _albertaShifted(ms) {
    return new Date(ms + ALBERTA_UTC_OFFSET_MIN * 60000);
}

// "9:38 AM"
function albertaClockText(ms) {
    var a = _albertaShifted(ms === undefined ? Date.now() : ms);
    var h = a.getUTCHours();
    var m = a.getUTCMinutes();
    var suffix = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + suffix;
}

// "20261102" (YYYYMMDD, the same format the GTFS schedule uses)
function albertaYmd(ms) {
    var a = _albertaShifted(ms);
    var mo = a.getUTCMonth() + 1;
    var d = a.getUTCDate();
    return "" + a.getUTCFullYear() + (mo < 10 ? "0" : "") + mo + (d < 10 ? "0" : "") + d;
}

// Day of week in Alberta, 0 = Sunday ... 6 = Saturday (same as Date.getDay)
function albertaDow(ms) {
    return _albertaShifted(ms).getUTCDay();
}

// Epoch ms of 00:00 Alberta time on the Alberta calendar day containing ms
function albertaMidnightMs(ms) {
    var a = _albertaShifted(ms);
    return Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
         - ALBERTA_UTC_OFFSET_MIN * 60000;
}
