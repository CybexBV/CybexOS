const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

// The Control Dashboard's Power tab (Popovers/Drawer/DrawerPower.qml).
const power = untranslated(fs.readFileSync(
    path.join(shellDir, "Popovers/Drawer/DrawerPower.qml"), "utf8"));

test("battery health is a capability-driven accessible UPower control", () => {
    assert.match(power,
        /visible:\s*Battery\.isLaptop && \(BatteryHealth\.supported \|\| !BatteryHealth\.known\)/);
    assert.match(power, /text:\s*"Preserve battery health"/);
    assert.match(power, /BatteryHealth\.enabled\s*\? BatteryHealth\.limitText : "Charge to 100%"/);
    assert.match(power,
        /id:\s*healthToggle[\s\S]{0,260}?checked:\s*BatteryHealth\.enabled[\s\S]{0,200}?accessibleName:\s*"Preserve battery health"[\s\S]{0,120}?BatteryHealth\.setEnabled\(value\)/);
    assert.match(power, /BatteryHealth\.acquire\(\)/);
    assert.match(power, /BatteryHealth\.release\(\)/);
});

test("power profiles are one accessible segmented radio", () => {
    for (const glyph of ["eco", "balance", "speed"])
        assert.match(power, new RegExp(`glyph: "${glyph}"`));
    assert.match(power, /model:\s*PowerProfiles\.hasPerformanceProfile/);
    assert.match(power, /Accessible\.role:\s*Accessible\.RadioButton/);
    assert.match(power, /Accessible\.checked:\s*profileChoice\.on/);
    assert.match(power, /onClicked:\s*PowerProfiles\.profile = profileChoice\.modelData\.profile/);
});
