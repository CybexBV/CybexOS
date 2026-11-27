const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./shell.cjs");

const H = load("BatteryViewHelpers.js");

test("missing and malformed battery telemetry stays visibly unavailable", () => {
    for (const value of [undefined, null, "", "unknown", NaN, Infinity]) {
        assert.equal(H.formatWh(value), "—");
        assert.equal(H.formatW(value), "—");
        assert.equal(H.formatDuration(value), "—");
    }
    assert.equal(H.formatWh(0), "—");
    assert.equal(H.formatWh(-1), "—");
    assert.equal(H.formatDuration(0), "—");
    assert.equal(H.formatDuration(-60), "—");
});

test("missing and malformed cycle output uses stable placeholders", () => {
    assert.equal(H.parseCycleCounts(""), "—");
    assert.equal(H.parseCycleCounts(undefined), "—");
    assert.equal(H.parseCycleCounts("not-a-count\n"), "—");
    assert.equal(H.parseCycleCounts("42\nnot-a-count\n"), "42 · —");
});

test("a supported UPower battery exposes its current health limit", () => {
    const state = H.parseChargeThresholdStatus(
        "battery\t/org/freedesktop/UPower/devices/battery_BAT0"
        + "\ttrue\tfalse\t75\t80\t7\n");

    assert.deepEqual({
        batteryCount: state.batteryCount,
        supportedCount: state.supportedCount,
        supported: state.supported,
        enabled: state.enabled,
        mixed: state.mixed
    }, {
        batteryCount: 1,
        supportedCount: 1,
        supported: true,
        enabled: false,
        mixed: false
    });
    assert.equal(H.formatChargeLimit(state), "Charge between 75–80%");
});

test("multiple packs must all support charge limits", () => {
    const shared = H.parseChargeThresholdStatus([
        "battery\t/org/freedesktop/UPower/devices/battery_BAT0\ttrue\ttrue\t75\t80\t7",
        "battery\t/org/freedesktop/UPower/devices/battery_BAT1\ttrue\tfalse\t75\t80\t3"
    ].join("\n"));
    const partial = H.parseChargeThresholdStatus([
        "battery\t/org/freedesktop/UPower/devices/battery_BAT0\ttrue\tfalse\t75\t80\t7",
        "battery\t/org/freedesktop/UPower/devices/battery_BAT1\tfalse\tfalse\t-1\t-1\t0"
    ].join("\n"));

    assert.equal(shared.supported, true);
    assert.equal(shared.enabled, false);
    assert.equal(shared.mixed, true);
    assert.equal(H.formatChargeLimit(shared), "Charge between 75–80%");
    assert.equal(partial.supported, false);
    assert.equal(H.formatChargeLimit(partial), "—");
});

test("missing and malformed charge-threshold snapshots fail closed", () => {
    assert.deepEqual(H.parseChargeThresholdStatus(""), {
        batteryCount: 0,
        supportedCount: 0,
        supported: false,
        enabled: false,
        mixed: false,
        batteries: []
    });
    for (const value of [undefined, "garbage",
        "battery\t/not/a/upower/path\ttrue\tfalse\t75\t80\t7",
        "battery\t/org/freedesktop/UPower/devices/battery_BAT0\tyes\tfalse\t75\t80\t7",
        "battery\t/org/freedesktop/UPower/devices/battery_BAT0\ttrue\tfalse\t75\t101\t7"]) {
        assert.equal(H.parseChargeThresholdStatus(value), null);
    }
});
