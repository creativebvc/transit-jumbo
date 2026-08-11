// ==========================================
// GTFS-REALTIME DECODER
// ------------------------------------------
// Dependency-free protobuf reader. Decodes only the fields this board needs,
// which is why it fits in one file instead of pulling a 300 KB library.
//
// Replaces protobuf.min.js AND proto-loader.js AND gtfs-realtime.proto.
// That removes, in one go: the jsDelivr CDN dependency, the .proto file fetch,
// the "protobuf is not defined" failure, and the startup parse delay that made
// TV browsers miss the 1000ms engine deadline.
//
// Written to ES5 so it parses on older LG webOS / Samsung Tizen builds:
// no modules, no arrow functions, no optional chaining, no numeric separators,
// no exponent operator. A single unsupported token would stop the whole file
// from parsing and leave the board showing only its background.
// ==========================================

var GTFSDecoder = (function () {

    // TextDecoder is widely available but not universal on older TV firmware.
    var _td = (typeof TextDecoder !== "undefined") ? new TextDecoder("utf-8") : null;

    function utf8(bytes) {
        if (_td) {
            try { return _td.decode(bytes); } catch (e) { /* fall through */ }
        }
        // Manual UTF-8 decode fallback.
        var out = "", i = 0, c, c2, c3;
        while (i < bytes.length) {
            c = bytes[i++];
            if (c < 128) {
                out += String.fromCharCode(c);
            } else if (c > 191 && c < 224) {
                c2 = bytes[i++];
                out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
            } else if (c > 239 && c < 365) {
                c2 = bytes[i++]; c3 = bytes[i++];
                var c4 = bytes[i++];
                var u = (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
                out += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 1023));
            } else {
                c2 = bytes[i++]; c3 = bytes[i++];
                out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
            }
        }
        return out;
    }

    // Reads a base-128 varint as two 32-bit halves.
    //
    // A naive accumulator (value += byte * 2^shift) breaks on negative int32
    // fields: protobuf sign-extends them to a full 10-byte varint, which both
    // overflows a 7-bit shift guard and loses precision in a double. Since
    // GTFS-RT uses negative delays for early-running vehicles, that is a live
    // case, not a theoretical one.
    //
    // Returns [unsignedValue, nextPos, signedLow32].
    function readVarint(buf, start) {
        var pos = start, lo = 0, hi = 0, count = 0, byte;
        while (true) {
            if (pos >= buf.length) throw new Error("truncated varint");
            byte = buf[pos++];
            if (count < 4) {
                lo |= (byte & 0x7f) << (7 * count);
            } else if (count === 4) {
                lo |= (byte & 0x7f) << 28;
                hi |= (byte & 0x7f) >>> 4;
            } else if (count < 10) {
                hi |= (byte & 0x7f) << (7 * count - 32);
            }
            count++;
            if (byte < 0x80) break;
            if (count >= 10) throw new Error("oversized varint");
        }
        var unsigned = (hi >>> 0) * 4294967296 + (lo >>> 0);
        return [unsigned, pos, lo | 0];
    }

    // Splits a message into [fieldNumber, wireType, value] triples.
    function fields(buf) {
        var pos = 0, out = [], key, next, fieldNo, wireType, value, length;
        while (pos < buf.length) {
            next = readVarint(buf, pos);
            key = next[0]; pos = next[1];
            fieldNo = Math.floor(key / 8);
            wireType = key & 7;
            if (!fieldNo) throw new Error("invalid field number 0");

            var signedLow = null;
            if (wireType === 0) {
                next = readVarint(buf, pos); value = next[0]; pos = next[1]; signedLow = next[2];
            } else if (wireType === 1) {
                if (pos + 8 > buf.length) throw new Error("truncated fixed64");
                value = buf.subarray(pos, pos + 8); pos += 8;
            } else if (wireType === 2) {
                next = readVarint(buf, pos); length = next[0]; pos = next[1];
                if (pos + length > buf.length) throw new Error("truncated field");
                value = buf.subarray(pos, pos + length); pos += length;
            } else if (wireType === 5) {
                if (pos + 4 > buf.length) throw new Error("truncated fixed32");
                value = buf.subarray(pos, pos + 4); pos += 4;
            } else {
                throw new Error("unsupported wire type " + wireType);
            }
            out.push([fieldNo, wireType, value, signedLow]);
        }
        return out;
    }

    function subs(f, n) {
        var out = [], i;
        for (i = 0; i < f.length; i++) if (f[i][0] === n && f[i][1] === 2) out.push(f[i][2]);
        return out;
    }
    function oneSub(f, n) { var s = subs(f, n); return s.length ? s[0] : null; }
    function vari(f, n, fallback) {
        for (var i = 0; i < f.length; i++) if (f[i][0] === n && f[i][1] === 0) return f[i][2];
        return fallback === undefined ? null : fallback;
    }
    function text(f, n, fallback) {
        for (var i = 0; i < f.length; i++) {
            if (f[i][0] === n && f[i][1] === 2) {
                try { return utf8(f[i][2]); } catch (e) { return fallback || ""; }
            }
        }
        return fallback === undefined ? "" : fallback;
    }
    // Signed int32 accessor: uses the low word captured during varint reading,
    // which is exact even when the value was sign-extended across 10 bytes.
    function variSigned(f, n) {
        for (var i = 0; i < f.length; i++) {
            if (f[i][0] === n && f[i][1] === 0) {
                return f[i][3] === null || f[i][3] === undefined ? null : f[i][3];
            }
        }
        return null;
    }

    function tripDescriptor(raw) {
        if (!raw) return {};
        var f = fields(raw);
        return {
            tripId: text(f, 1),
            startTime: text(f, 2),
            startDate: text(f, 3),
            scheduleRelationship: vari(f, 4, 0),
            routeId: text(f, 5),
            directionId: vari(f, 6, null)
        };
    }

    function stopTimeEvent(raw) {
        if (!raw) return {};
        var f = fields(raw);
        return {
            delay: variSigned(f, 1),
            time: vari(f, 2, null),
            uncertainty: vari(f, 3, null)
        };
    }

    function parseTripUpdates(arrayBuffer) {
        var top = fields(new Uint8Array(arrayBuffer));
        var headerRaw = oneSub(top, 1);
        var header = {};
        if (headerRaw) {
            var hf = fields(headerRaw);
            header = { version: text(hf, 1), timestamp: vari(hf, 3, null) };
        }

        var updates = [];
        var entities = subs(top, 2);
        for (var i = 0; i < entities.length; i++) {
            var ef = fields(entities[i]);
            var tuRaw = oneSub(ef, 3);
            if (!tuRaw) continue;
            var tf = fields(tuRaw);

            var stopUpdates = [];
            var stus = subs(tf, 2);
            for (var j = 0; j < stus.length; j++) {
                var sf = fields(stus[j]);
                stopUpdates.push({
                    stopSequence: vari(sf, 1, null),
                    arrival: stopTimeEvent(oneSub(sf, 2)),
                    departure: stopTimeEvent(oneSub(sf, 3)),
                    stopId: text(sf, 4),
                    scheduleRelationship: vari(sf, 5, 0)
                });
            }

            updates.push({
                entityId: text(ef, 1),
                trip: tripDescriptor(oneSub(tf, 1)),
                stopTimeUpdates: stopUpdates,
                timestamp: vari(tf, 4, null),
                delay: variSigned(tf, 5)
            });
        }
        return { header: header, updates: updates };
    }

    function translatedString(raw) {
        if (!raw) return "";
        var f = fields(raw), best = "", trs = subs(f, 1), i;
        for (i = 0; i < trs.length; i++) {
            var tf = fields(trs[i]);
            var value = text(tf, 1);
            var lang = text(tf, 2).toLowerCase();
            if (!best) best = value;
            if (value && (lang === "" || lang === "en" || lang === "en-ca")) return value;
        }
        return best;
    }

    function parseAlerts(arrayBuffer) {
        var top = fields(new Uint8Array(arrayBuffer));
        var alerts = [];
        var entities = subs(top, 2);
        for (var i = 0; i < entities.length; i++) {
            var ef = fields(entities[i]);
            var alertRaw = oneSub(ef, 5);
            if (!alertRaw) continue;
            var af = fields(alertRaw);

            var selectors = [], sels = subs(af, 5), j;
            for (j = 0; j < sels.length; j++) {
                var sf = fields(sels[j]);
                selectors.push({
                    agencyId: text(sf, 1),
                    routeId: text(sf, 2),
                    trip: tripDescriptor(oneSub(sf, 4)),
                    stopId: text(sf, 5)
                });
            }

            var periods = [], ps = subs(af, 1);
            for (j = 0; j < ps.length; j++) {
                var pf = fields(ps[j]);
                periods.push({ start: vari(pf, 1, null), end: vari(pf, 2, null) });
            }

            alerts.push({
                entityId: text(ef, 1),
                activePeriods: periods,
                selectors: selectors,
                effect: vari(af, 7, null),
                header: translatedString(oneSub(af, 10)),
                description: translatedString(oneSub(af, 11))
            });
        }
        return { alerts: alerts };
    }

    return {
        parseTripUpdates: parseTripUpdates,
        parseAlerts: parseAlerts
    };
})();
