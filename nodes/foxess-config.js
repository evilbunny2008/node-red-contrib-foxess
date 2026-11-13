"use strict";

const { FoxESSClient, FoxESSError } = require("../lib/api");

module.exports = function (RED) {
    function FoxESSConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.sn = (config.sn || "").trim();
        this.domain = config.domain;
        this.timeZone = config.timeZone;

        let client = null;
        let snPromise = null;

        this.getClient = () => {
            if (!client) {
                client = new FoxESSClient({
                    apiKey: (this.credentials.apiKey || "").trim(),
                    domain: this.domain,
                    timeZone: this.timeZone
                });
            }
            return client;
        };

        // Uses the configured serial number, otherwise the only inverter on the account.
        // The lookup is cached so it costs one API call per deploy.
        this.getDeviceSN = () => {
            if (this.sn) {
                return Promise.resolve(this.sn);
            }
            if (!snPromise) {
                snPromise = this.getClient().getDeviceList().then((devices) => {
                    if (devices.length === 0) {
                        throw new FoxESSError("No inverters found on this FoxESS account");
                    }
                    if (devices.length > 1) {
                        const sns = devices.map((d) => d.deviceSN).join(", ");
                        throw new FoxESSError(`Multiple inverters found (${sns}), set the serial number in the config node`);
                    }
                    return devices[0].deviceSN;
                }).catch((err) => {
                    snPromise = null;
                    throw err;
                });
            }
            return snPromise;
        };
    }

    RED.nodes.registerType("foxess-config", FoxESSConfigNode, {
        credentials: {
            apiKey: { type: "password" }
        }
    });
};
