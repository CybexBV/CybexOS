const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./shell.cjs");

const H = load("EthernetHelpers.js");

function record(device, type, connection, state, addresses = []) {
    return [
        `GENERAL.DEVICE:${device}`,
        `GENERAL.TYPE:${type}`,
        `GENERAL.CONNECTION:${connection}`,
        `GENERAL.STATE:${state}`,
        ...addresses.map((address, index) => `IP4.ADDRESS[${index + 1}]:${address}`),
    ].join("\n");
}

test("multiline nmcli output yields every Ethernet device, connected first", () => {
    const output = [
        record("enp9s0", "ethernet", "", "30 (disconnected)"),
        record("docker0", "bridge", "docker0", "100 (connected (externally))",
            ["172.17.0.1/16"]),
        record("enp2s0", "ethernet", "Dock", "100 (connected)",
            ["192.0.2.20/24", "198.51.100.7/24"]),
        record("enp1s0", "ethernet", "Office", "100 (connected)",
            ["192.0.2.10/24"]),
    ].join("\n\n") + "\n";

    const devices = H.parseDevices(output);
    assert.deepEqual(devices.map(device => device.device),
        ["enp1s0", "enp2s0", "enp9s0"]);
    assert.deepEqual(devices[1], {
        device: "enp2s0",
        connection: "Dock",
        stateCode: 100,
        status: "Connected",
        connected: true,
        ipv4: "192.0.2.20",
    });
    assert.equal(devices[2].ipv4, "");
    assert.equal(devices[2].connected, false);
});

test("escaped separators and backslashes survive in device and profile names", () => {
    const output = String.raw`GENERAL.DEVICE:enp0s1\:dock
GENERAL.TYPE:ethernet
GENERAL.CONNECTION:Lab\: Dock\\East
GENERAL.STATE:100 (connected)
IP4.ADDRESS[1]:203.0.113.8/24
`;
    assert.deepEqual(H.parseDevices(output), [{
        device: "enp0s1:dock",
        connection: "Lab: Dock\\East",
        stateCode: 100,
        status: "Connected",
        connected: true,
        ipv4: "203.0.113.8",
    }]);
});

test("only state 100 is connected and a -- profile is normalized to empty", () => {
    const states = [40, 50, 60, 70, 80, 90, 100, 110, 120];
    for (const state of states) {
        const [device] = H.parseDevices(record("eth0", "ethernet", "--", `${state} (state)`));
        assert.equal(device.connected, state === 100, `state ${state}`);
        assert.equal(device.connection, "");
    }
});

test("malformed output is distinct from a no-device snapshot", () => {
    const malformed = [
        undefined,
        "GENERAL.TYPE:ethernet\n",
        "GENERAL.DEVICE:eth0\nGENERAL.TYPE:ethernet\n",
        "GENERAL.DEVICE:eth0\nGENERAL.TYPE:ethernet\nGENERAL.CONNECTION:x\nGENERAL.STATE:connected\n",
        "GENERAL.DEVICE:eth0\\\n",
        "not a field\n",
        "GENERAL.DEVICE:eth0\nGENERAL.TYPE:ethernet\nGENERAL.CONNECTION:x\nGENERAL.STATE:100\nEXTRA:value\n",
    ];
    for (const output of malformed)
        assert.equal(H.parseDevices(output), null, JSON.stringify(output));
});

test("an unusable first address does not hide a later valid IPv4 address", () => {
    const [device] = H.parseDevices(record("eth0", "ethernet", "Office",
        "100 (connected)", ["not-an-address", "198.51.100.42/24"]));
    assert.equal(device.ipv4, "198.51.100.42");
});
