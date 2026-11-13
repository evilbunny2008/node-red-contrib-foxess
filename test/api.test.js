"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { FoxESSClient, sign } = require("../lib/api");
const { flatten, parseVariables } = require("../nodes/foxess-real");

const KEY = "0123456789abcdef0123456789abcdef0123";

test("signature uses literal backslash-r-backslash-n separators", () => {
    const expected = crypto.createHash("md5").update("/op/v1/device/real/query\\r\\n" + KEY + "\\r\\n1700000000000").digest("hex");
    assert.strictEqual(sign("/op/v1/device/real/query", KEY, "1700000000000"), expected);
});

test("rejects bad API keys", () => {
    assert.throws(() => new FoxESSClient({ apiKey: "" }));
    assert.throws(() => new FoxESSClient({ apiKey: "short" }));
});

test("getReal posts signed request and returns result", async (t) => {
    let captured;
    t.mock.method(global, "fetch", async (url, opts) => {
        captured = { url, opts };
        return new Response(JSON.stringify({ errno: 0, result: [{ deviceSN: "SN1", datas: [] }] }));
    });
    const client = new FoxESSClient({ apiKey: KEY, timeZone: "Australia/Sydney" });
    const result = await client.getReal("SN1", ["pvPower"]);
    assert.strictEqual(captured.url, "https://www.foxesscloud.com/op/v1/device/real/query");
    assert.deepStrictEqual(JSON.parse(captured.opts.body), { sns: ["SN1"], variables: ["pvPower"] });
    const h = captured.opts.headers;
    assert.strictEqual(h.Signature, sign("/op/v1/device/real/query", KEY, h.Timestamp));
    assert.strictEqual(h.Timezone, "Australia/Sydney");
    assert.strictEqual(result[0].deviceSN, "SN1");
});

test("API errors are thrown with errno", async (t) => {
    t.mock.method(global, "fetch", async () => new Response(JSON.stringify({ errno: 40400, msg: "Request too frequent" })));
    const client = new FoxESSClient({ apiKey: KEY });
    await assert.rejects(client.getReal("SN1"), (err) => err.errno === 40400 && /too frequent/.test(err.message));
});

test("flatten computes gridPower", () => {
    const { values, units } = flatten([
        { variable: "feedinPower", unit: "kW", value: 3.2 },
        { variable: "gridConsumptionPower", unit: "kW", value: 0.1 },
        { variable: "SoC", unit: "%", value: "87" },
        { variable: "runningState", value: "normal" }
    ]);
    assert.strictEqual(values.gridPower, 3.1);
    assert.strictEqual(values.SoC, 87);
    assert.strictEqual(values.runningState, "normal");
    assert.strictEqual(units.gridPower, "kW");
    assert.strictEqual(flatten([{ variable: "feedinPower", value: 0 }, { variable: "gridConsumptionPower", value: 1.5 }]).values.gridPower, -1.5);
});

test("parseVariables splits commas and whitespace", () => {
    assert.deepStrictEqual(parseVariables(" pvPower, SoC  loadsPower,,"), ["pvPower", "SoC", "loadsPower"]);
    assert.deepStrictEqual(parseVariables(""), []);
});

const { parseLocation, sunElevation } = require("../lib/sun");

test("parseLocation accepts the usual formats", () => {
    const want = { lat: -33.86, lon: 151.21 };
    for (const v of ["-33.86,151.21", " -33.86 151.21 ", "-33.86;151.21", "[-33.86,151.21]",
        '{"lat":-33.86,"lon":151.21}', [-33.86, 151.21], { latitude: -33.86, longitude: 151.21 }, { lat: "-33.86", lng: "151.21" }]) {
        assert.deepStrictEqual(parseLocation(v), want, JSON.stringify(v));
    }
    for (const v of [undefined, "", "abc", "100,0", "{bad json", { lat: 1 }]) {
        assert.strictEqual(parseLocation(v), null, JSON.stringify(v));
    }
});

test("sunElevation is high at Sydney midday and negative at midnight", () => {
    // 2026-12-21 is midsummer in Sydney (UTC+11)
    assert.ok(sunElevation(new Date("2026-12-21T02:00:00Z"), -33.86, 151.21) > 70);
    assert.ok(sunElevation(new Date("2026-12-21T13:00:00Z"), -33.86, 151.21) < 0);
});
