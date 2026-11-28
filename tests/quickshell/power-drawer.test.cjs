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
    assert.match(power, /profiles:\s*PowerProfiles\.hasPerformanceProfile/);
    assert.match(power, /model:\s*profileGroup\.profiles/);
    assert.match(power, /Accessible\.role:\s*Accessible\.Grouping\s*Accessible\.name:\s*"Power mode"/);
    assert.match(power, /Accessible\.role:\s*Accessible\.RadioButton/);
    assert.match(power, /Accessible\.checked:\s*profileChoice\.on/);
    assert.match(power, /Accessible\.name:\s*I18n\.format\("%1 power profile", \[profileChoice\.modelData\.label\]\)/);
    assert.match(power, /Accessible\.onPressAction:\s*profileGroup\.choose\(profileChoice\.index\)/);
    assert.match(power,
        /onClicked:\s*\{\s*profileChoice\.forceActiveFocus\(\);\s*PowerProfiles\.profile = profileChoice\.modelData\.profile;/);
});

test("power profiles answer the keyboard like the shell's other segmented choices", () => {
    const choice = power.slice(power.indexOf("id: profileChoice"), power.indexOf("// ---- switches"));
    assert.ok(choice.length > 0, "the profile delegate is missing");
    // One Tab stop: the chosen profile, or the first while none is.
    assert.match(choice, /activeFocusOnTab:\s*on \|\| \(!profileGroup\.anyChosen && index === 0\)/);
    assert.match(power, /readonly property bool anyChosen:\s*profiles\.some\(\s*entry => entry\.profile === PowerProfiles\.profile\)/);
    // The shared focus ring, shown for keyboard modality only, and the
    // shared hover and press layer.
    assert.match(choice, /border\.width:\s*Theme\.focusWidth\(activeFocus\)\s*border\.color:\s*Theme\.focusRing/);
    assert.match(choice, /StateLayer\s*\{[\s\S]{0,240}?hovered:\s*profileMouse\.containsMouse\s*pressed:\s*profileMouse\.pressed/);
    // Keys go through DrawerFormat.segmentTarget; focus moves before the
    // profile does, so the old segment never stays a second Tab stop.
    assert.match(choice,
        /Keys\.onPressed:\s*event => \{\s*const next = DrawerFormat\.segmentTarget\(event\.key, index,\s*profileRepeater\.count\);\s*if \(next < 0\)\s*return;\s*if \(next !== index\)\s*profileRepeater\.itemAt\(next\)\.forceActiveFocus\(\);\s*else\s*profileState\.pulseCenter\(\);\s*profileGroup\.choose\(next\);\s*event\.accepted = true;/);
});

test("the Power tab's own text is translatable as whole sentences", () => {
    const raw = fs.readFileSync(path.join(shellDir, "Popovers/Drawer/DrawerPower.qml"), "utf8");
    assert.match(raw, /I18n\.tr\("Charge to 100%"\)/);
    assert.equal((raw.match(/I18n\.format\("%1 cycles", \[root\.cycleCountText\]\)/g) || []).length, 2);
    assert.doesNotMatch(raw, /" cycles"|" power profile"/, "no fragments glued onto a value");
    assert.match(raw, /accessibleName:\s*I18n\.tr\("Preserve battery health"\)/);
    assert.match(raw, /accessibleName:\s*I18n\.tr\("Stay awake"\)/);
});
