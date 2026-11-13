# node-red-contrib-foxess

Node-RED nodes that poll the [FoxESS Cloud](https://www.foxesscloud.com) Open API for real-time inverter data.
They also work out how much power is going to the grid, so you can automate loads (e.g. an air conditioner) around your solar surplus.

It only reads data. It doesn't change inverter settings or schedules.

## Install

```sh
cd ~/.node-red
npm install /path/to/node-red-contrib-foxess
```

Restart Node-RED. The **real-time** node appears under the *FoxESS* palette category.

## Setup

1. In FoxESS Cloud go to *User Profile > API Management* and generate an API key (36 characters).
2. Add a **real-time** node, and create a **FoxESS Cloud** config node with your API key.
   Leave *Inverter SN* blank if your account has only one inverter.

## real-time node

Polls `/op/v1/device/real/query` every *n* seconds (default 300, minimum 60), or whenever it gets a message.

Output:

```js
msg.payload = {
  pvPower: 5.1,               // kW
  loadsPower: 1.2,            // kW
  feedinPower: 3.4,           // kW exported
  gridConsumptionPower: 0,    // kW imported
  SoC: 92,                    // %
  gridPower: 3.4              // feedinPower - gridConsumptionPower: + exporting, - importing
}
msg.units    = { pvPower: "kW", SoC: "%", ... }
msg.time     = "2026-11-13 14:05:12 AEDT+1100"   // when the inverter last reported
msg.deviceSN = "..."
```

Leave *Variables* blank to get everything your inverter reports.

### Only polling while the sun is up

Set **Sun above** (e.g. `20`) to only poll on the timer while the sun is at least that many degrees above the horizon.
The location is read from an environment variable, `location` by default (*Settings > Environment*, or on the flow or group).
It accepts `-33.86,151.21`, `-33.86 151.21`, `[-33.86,151.21]` or `{"lat":-33.86,"lon":151.21}`.

Each output message then includes `msg.sun = { elevation, up }`. When the sun drops below the threshold the node sends
one message with an empty `payload` and `msg.sun.up = false`, so a flow can switch things off, then stops polling until
the sun is back above the threshold. Messages sent to the node's input always poll, whatever the sun is doing.

### Rate limits and data freshness

The Open API allows about 1440 calls per inverter per day, which is one a minute.
Most data loggers only upload every few minutes, so polling faster than about 5 minutes mostly returns the same values.
Use `msg.time` to see how old the data is.

## Example: air conditioner on surplus

Import `examples/ac-control-by-surplus.json` (*Menu > Import > Examples > node-red-contrib-foxess*).
It feeds `gridPower` into a function node with hysteresis:

- **on** after 2 polls in a row exporting ≥ 2.5 kW
- **off** after 2 polls in a row importing ≥ 0.3 kW, or when the sun drops below 20° and polling stops

It sends `"on"` or `"off"` only when the state changes. Swap the final debug node for whatever controls your AC
(Home Assistant service call, Tasmota/MQTT, a Broadlink IR blaster, etc.).

Once the AC is running, its draw comes out of the export. Set `ON_EXPORT` above the AC's draw, otherwise it will
turn on, use up the surplus, and turn straight off again. The thresholds are at the top of the function node.

## Development

```sh
npm test
```

The API signing is ported from FreePowerMaximiser's `openapi.py`. The signature is
`md5(path + "\r\n" + apiKey + "\r\n" + timestampMs)`, where `\r\n` is the literal four characters, not CR LF.
