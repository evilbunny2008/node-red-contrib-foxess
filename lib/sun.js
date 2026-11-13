"use strict";

const suncalc = require("suncalc2");

// Accepts "lat,lon", "lat lon", '{"lat":..,"lon":..}', [lat, lon] or {lat|latitude, lon|lng|long|longitude}.
// Returns { lat, lon } or null if it can't be parsed.
function parseLocation(loc) {
    let lat, lon;
    try {
        if (typeof loc === "string") {
            loc = loc.trim();
            if (loc.startsWith("{") || loc.startsWith("[")) {
                loc = JSON.parse(loc);
            } else {
                const parts = loc.split(/[,\s;]+/).map(Number);
                loc = { lat: parts[0], lon: parts[1] };
            }
        }
        if (Array.isArray(loc)) {
            lat = Number(loc[0]);
            lon = Number(loc[1]);
        } else if (loc && typeof loc === "object") {
            lat = Number(loc.lat ?? loc.latitude);
            lon = Number(loc.lon ?? loc.lng ?? loc.long ?? loc.longitude);
        }
    } catch (e) {
        return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return null;
    }
    return { lat, lon };
}

// Sun elevation in degrees above the horizon
function sunElevation(date, lat, lon) {
    return suncalc.getPosition(date, lat, lon).altitude * 180 / Math.PI;
}

module.exports = { parseLocation, sunElevation };
