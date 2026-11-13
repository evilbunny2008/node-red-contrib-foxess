"use strict";

// Minimal client for the FoxESS Cloud Open API.
// Ported from FreePowerMaximiser/bin/openapi.py (signed_header / signed_get / signed_post / get_result).

const crypto = require("crypto");

const DEFAULT_DOMAIN = "https://www.foxesscloud.com";
const USER_AGENT = "node-red-contrib-foxess";

class FoxESSError extends Error {
    constructor(message, errno, path) {
        super(message);
        this.name = "FoxESSError";
        this.errno = errno;
        this.path = path;
    }
}

// FoxESS signs requests with md5("<path>\r\n<token>\r\n<timestamp>") where "\r\n" is the
// literal four characters backslash-r-backslash-n, not CR LF (the Python source uses a raw string).
function sign(path, token, timestamp) {
    return crypto.createHash("md5").update(`${path}\\r\\n${token}\\r\\n${timestamp}`, "utf8").digest("hex");
}

class FoxESSClient {
    constructor({ apiKey, domain = DEFAULT_DOMAIN, timeZone, lang = "en", timeout = 30000 }) {
        if (!apiKey) {
            throw new FoxESSError("No API key configured. Generate one at foxesscloud.com (User Profile > API Management)");
        }
        if (apiKey.length !== 36) {
            throw new FoxESSError(`Invalid API key, length ${apiKey.length}, it should be 36`);
        }
        this.apiKey = apiKey;
        this.domain = (domain || DEFAULT_DOMAIN).replace(/\/+$/, "");
        this.timeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        this.lang = lang;
        this.timeout = timeout;
    }

    headers(path) {
        const timestamp = String(Date.now());
        return {
            "Token": this.apiKey,
            "Lang": this.lang,
            "User-Agent": USER_AGENT,
            "Timezone": this.timeZone,
            "Timestamp": timestamp,
            "Signature": sign(path, this.apiKey, timestamp),
            "Content-Type": "application/json"
        };
    }

    async request(method, path, { params, body } = {}) {
        let url = this.domain + path;
        if (params) {
            url += "?" + new URLSearchParams(params).toString();
        }

        let response;
        try {
            response = await fetch(url, {
                method,
                headers: this.headers(path),
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeout)
            });
        } catch (err) {
            throw new FoxESSError(`Request to ${path} failed: ${err.message}`, undefined, path);
        }

        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (err) {
            throw new FoxESSError(`HTTP ${response.status} from ${path}: ${text.slice(0, 200)}`, undefined, path);
        }

        if (json.errno !== 0) {
            const msg = json.msg || `HTTP ${response.status}`;
            throw new FoxESSError(`FoxESS error ${json.errno} from ${path}: ${msg}`, json.errno, path);
        }
        return json.result;
    }

    async getDeviceList() {
        const result = await this.request("POST", "/op/v0/device/list", { body: { currentPage: 1, pageSize: 100 } });
        return (result && result.data) || [];
    }

    // Returns [{ deviceSN, time, datas: [{ variable, name, unit, value }] }]
    async getReal(sns, variables) {
        const body = { sns: Array.isArray(sns) ? sns : [sns] };
        if (variables && variables.length > 0) {
            body.variables = variables;
        }
        return this.request("POST", "/op/v1/device/real/query", { body });
    }

    async getAccessCount() {
        return this.request("GET", "/op/v0/user/getAccessCount");
    }
}

module.exports = { FoxESSClient, FoxESSError, sign, DEFAULT_DOMAIN };
