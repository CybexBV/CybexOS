const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

const battery = untranslated(fs.readFileSync(
    path.join(shellDir, "Popovers/BatteryPopover.qml"), "utf8"));

test("battery health is a capability-driven accessible UPower control", () => {
    assert.match(battery,
        /id:\s*batteryHealthSection[\s\S]{0,140}?visible:\s*BatteryHealth\.known && BatteryHealth\.supported/);
    assert.match(battery, /text:\s*"Preserve battery health"/);
    assert.match(battery, /BatteryHealth\.enabled \? BatteryHealth\.limitText\s*:\s*"Charge to 100%"/);
    assert.match(battery,
        /id:\s*healthToggle[\s\S]{0,260}?checked:\s*BatteryHealth\.enabled[\s\S]{0,140}?accessibleName:\s*"Preserve battery health"[\s\S]{0,120}?BatteryHealth\.setEnabled\(value\)/);
    assert.match(battery, /BatteryHealth\.acquire\(\)/);
    assert.match(battery, /BatteryHealth\.release\(\)/);
});

test("battery telemetry is stable, aggregate, and cycle aware", () => {
    assert.match(battery, /displayDevice:\s*UPower\.displayDevice/);
    assert.match(battery, /displayDevice\.energyCapacity/);
    assert.match(battery, /displayDevice\.changeRate/);
    assert.match(battery, /displayDevice\.timeToFull/);
    assert.match(battery, /displayDevice\.timeToEmpty/);
    for (const label of ["Capacity", "Cycles", "Time to full", "Time remaining",
        "Charge rate", "Discharge rate"]) {
        assert.ok(battery.includes(`"${label}"`), `${label} telemetry is missing`);
    }
    assert.match(battery, /BAT\*\/cycle_count/);
    assert.match(battery, /LC_ALL=C sort/);
    assert.match(battery, /running:\s*true/,
        "cycle counts should be read once with the popover instance");
    assert.match(battery, /BatteryView\.parseCycleCounts\(text\)/);
});

test("power profiles form one accessible keyboard-operated segmented radio", () => {
    assert.match(battery,
        /id:\s*profileTrack[\s\S]*?id:\s*profileRow[\s\S]*?id:\s*profileRepeater/);
    for (const glyph of ["eco", "balance", "speed"])
        assert.match(battery, new RegExp(`glyph: "${glyph}"`));
    assert.match(battery, /available:\s*PowerProfiles\.hasPerformanceProfile/);
    assert.match(battery, /current \? Theme\.chipHover[\s\S]{0,100}?profileMouse\.containsMouse \? Theme\.tile/);
    assert.match(battery, /Accessible\.role:\s*Accessible\.RadioButton/);
    assert.match(battery, /Accessible\.name:/);
    assert.match(battery, /Accessible\.checked:\s*current/);
    assert.match(battery, /Accessible\.onPressAction:/);
    assert.match(battery, /activeFocusOnTab:/);
    assert.match(battery, /Keys\.onPressed:/);
    assert.match(battery, /Qt\.Key_Left/);
    assert.match(battery, /Qt\.Key_Right/);
    assert.match(battery, /Qt\.Key_Return/);
    assert.match(battery, /PowerProfiles\.profile =/);
});
