"use strict";

// Numeric strings come back as numbers, anything else (e.g. WorkMode "SelfUse") is left alone.
function toValue(v) {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return Number.isFinite(n) ? n : v;
}

module.exports = function (RED) {
    function FoxESSSettingNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const server = RED.nodes.getNode(config.server);
        const action = config.action === "set" ? "set" : "get";
        const key = (config.key || "").trim();

        if (!server) {
            node.status({ fill: "red", shape: "ring", text: "not configured" });
            return;
        }

        node.on("input", async (msg, send, done) => {
            const name = (typeof msg.key === "string" && msg.key.trim()) || key;
            const act = msg.action === "get" || msg.action === "set" ? msg.action : action;
            try {
                if (!name) {
                    throw new Error("No setting name, set it on the node or in msg.key");
                }
                node.status({ fill: "blue", shape: "dot", text: `${act} ${name}` });
                const sn = msg.sn || await server.getDeviceSN();
                const client = server.getClient();

                if (act === "set") {
                    const value = msg.payload;
                    if (value === undefined || value === null || value === "" || typeof value === "object") {
                        throw new Error(`msg.payload must be the value to set ${name} to`);
                    }
                    await client.setSetting(sn, name, value);
                    msg.payload = toValue(String(value));
                } else {
                    const result = await client.getSetting(sn, name) || {};
                    if (result.value === undefined || result.value === null) {
                        throw new Error(`No value returned for ${name}`);
                    }
                    msg.payload = toValue(result.value);
                    msg.setting = result;
                }
                msg.key = name;
                msg.deviceSN = sn;
                msg.topic = msg.topic || `foxess/${sn}/${name}`;
                send(msg);
                node.status({ fill: "green", shape: "dot", text: `${name} = ${msg.payload} @ ${new Date().toLocaleTimeString()}` });
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: err.message.slice(0, 60) });
                done(err);
            }
        });
    }

    RED.nodes.registerType("foxess-setting", FoxESSSettingNode);
};

module.exports.toValue = toValue;
