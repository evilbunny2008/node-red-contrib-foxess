"use strict";

const { parseLocation, sunElevation } = require("../lib/sun");

// FoxESS Open API allows roughly 1440 calls per inverter per day, i.e. one a minute.
const MIN_INTERVAL = 60;

// Needed to work out gridPower, so always requested.
const GRID_VARS = ["feedinPower", "gridConsumptionPower"];

function parseVariables(text) {
    return (text || "").split(/[\s,]+/).map((v) => v.trim()).filter((v) => v.length > 0);
}

// Turns the API's [{variable, unit, value}] list into { variable: value } plus a units map.
function flatten(datas) {
    const values = {};
    const units = {};
    for (const d of datas || []) {
        const n = typeof d.value === "string" && d.value.trim() !== "" ? Number(d.value) : d.value;
        values[d.variable] = Number.isFinite(n) ? n : d.value;
        units[d.variable] = d.unit || "";
    }
    if (typeof values.feedinPower === "number" && typeof values.gridConsumptionPower === "number") {
        // Positive = exporting to the grid, negative = importing from it (kW)
        values.gridPower = Math.round((values.feedinPower - values.gridConsumptionPower) * 1000) / 1000;
        units.gridPower = units.feedinPower || "kW";
    }
    return { values, units };
}

module.exports = function (RED) {
    function FoxESSRealNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const server = RED.nodes.getNode(config.server);

        const interval = Number(config.interval) || 0;
        // Blank = poll around the clock, otherwise only poll on the timer while the sun is above this
        const minElevation = config.minElevation === undefined || String(config.minElevation).trim() === ""
            ? null : Number(config.minElevation);
        const locationEnv = (config.locationEnv || "location").trim();
        const variables = parseVariables(config.variables);
        if (variables.length > 0) {
            for (const v of GRID_VARS) {
                if (!variables.includes(v)) variables.push(v);
            }
        }

        let timer = null;
        let startTimer = null;
        let busy = false;
        let sunUp = null;
        let sunError = null;
        let lastSN = null;

        // Returns { elevation, up } or null when sun gating is off or the location can't be read
        function checkSun() {
            if (minElevation === null) {
                return null;
            }
            const raw = RED.util.getSetting(node, locationEnv);
            const loc = parseLocation(raw);
            if (!loc) {
                const text = `Could not parse env var "${locationEnv}": ${JSON.stringify(raw)}`;
                if (sunError !== text) {
                    node.error(text);
                    sunError = text;
                }
                node.status({ fill: "red", shape: "ring", text: `bad '${locationEnv}' env var` });
                return null;
            }
            sunError = null;
            const elevation = Math.round(sunElevation(new Date(), loc.lat, loc.lon) * 100) / 100;
            return { elevation, up: elevation >= minElevation };
        }

        if (!server) {
            node.status({ fill: "red", shape: "ring", text: "not configured" });
            return;
        }

        async function poll(msg, send, done) {
            if (busy) {
                // A request is already in flight; don't double up on the rate limit.
                if (done) done();
                return;
            }
            busy = true;
            node.status({ fill: "blue", shape: "dot", text: "polling" });
            try {
                const sn = (msg && msg.sn) || await server.getDeviceSN();
                const result = await server.getClient().getReal(sn, variables);
                const device = (result || []).find((r) => r.deviceSN === sn) || (result || [])[0];
                if (!device) {
                    throw new Error("No real-time data returned");
                }
                const { values, units } = flatten(device.datas);
                lastSN = device.deviceSN;

                const out = msg || {};
                out.topic = out.topic || `foxess/${device.deviceSN}`;
                out.payload = values;
                out.units = units;
                out.deviceSN = device.deviceSN;
                out.time = device.time;
                const sun = checkSun();
                if (sun) out.sun = sun;
                send(out);

                const text = typeof values.gridPower === "number"
                    ? (values.gridPower >= 0 ? `export ${values.gridPower} kW` : `import ${-values.gridPower} kW`)
                    : "ok";
                node.status({ fill: "green", shape: "dot", text: `${text} @ ${new Date().toLocaleTimeString()}` });
                if (done) done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: err.message.slice(0, 60) });
                if (done) {
                    done(err);
                } else {
                    node.error(err.message, msg || {});
                }
            } finally {
                busy = false;
            }
        }

        node.on("input", (msg, send, done) => {
            poll(msg, send, done);
        });

        if (interval > 0) {
            const seconds = Math.max(interval, MIN_INTERVAL);
            if (seconds !== interval) {
                node.warn(`Interval raised to ${MIN_INTERVAL}s to stay within the FoxESS API rate limit`);
            }
            const tick = () => {
                if (minElevation !== null) {
                    const sun = checkSun();
                    if (!sun) {
                        return;
                    }
                    if (!sun.up) {
                        // Tell downstream flows once that polling has stopped, so they can switch things off
                        if (sunUp !== false) {
                            node.send({ topic: `foxess/${lastSN || server.sn}`, payload: {}, sun, deviceSN: lastSN || server.sn });
                        }
                        sunUp = false;
                        node.status({ fill: "grey", shape: "ring", text: `paused, sun ${sun.elevation}° < ${minElevation}°` });
                        return;
                    }
                    sunUp = true;
                }
                poll(null, node.send.bind(node));
            };
            startTimer = setTimeout(tick, 2000);
            timer = setInterval(tick, seconds * 1000);
        } else {
            node.status({});
        }

        node.on("close", () => {
            clearTimeout(startTimer);
            clearInterval(timer);
        });
    }

    RED.nodes.registerType("foxess-real", FoxESSRealNode);
};

module.exports.flatten = flatten;
module.exports.parseVariables = parseVariables;
