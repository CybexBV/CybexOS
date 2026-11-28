// Popovers/Drawer/DrawerFormat.js: how Overview's summary arranges the
// readings Common/SysInfoHelpers.js formats (docs/shell-states.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

const F = require(path.join(shellDir, "Popovers", "Drawer", "DrawerFormat.js"));

test("uptime keeps its two largest units", () => {
    assert.equal(F.shortUptime(0), "0m");
    assert.equal(F.shortUptime(35 * 60 + 20), "35m");
    assert.equal(F.shortUptime(4 * 3600 + 5 * 60), "4h 5m");
    assert.equal(F.shortUptime(4 * 3600), "4h");
    assert.equal(F.shortUptime(12 * 86400 + 23 * 3600 + 50 * 60), "12d 23h");
    assert.equal(F.shortUptime(2 * 86400 + 30 * 60), "2d");
    assert.equal(F.shortUptime(-1), "");
    assert.equal(F.shortUptime(NaN), "");
});

test("a process reads as people know it, not as its Nix wrapper", () => {
    assert.equal(F.processLabel(".quickshell-wra"), "quickshell", "cut to 15 characters by the kernel");
    assert.equal(F.processLabel(".firefox-wrapped"), "firefox");
    assert.equal(F.processLabel(".firefox-wrappe"), "firefox");
    assert.equal(F.processLabel("MainThread"), "MainThread");
    assert.equal(F.processLabel(".xdg-desktop-po"), ".xdg-desktop-po", "only a wrapper suffix is dropped");
    assert.equal(F.processLabel(".hidden"), ".hidden");
    assert.equal(F.processLabel(""), "");
});

test("the tab strip keeps every label whole: one row, then more rows", () => {
    // Six labels at the default 14 px in a monospace face (8.4 px a
    // character), icons 19 px, 5 px either side, in the 400 px drawer.
    const labels = ["Overview", "Sound", "Network", "Bluetooth", "Power", "Alerts"]
        .map(label => Math.ceil(label.length * 8.4));
    const stacked = labels.map(w => Math.max(19, w) + 10);
    const inline = labels.map(w => 19 + 7 + w + 10);
    const one = F.tabLayout(stacked, inline, 429, 2);
    assert.equal(one.rows, 1);
    assert.equal(one.stacked, true);
    assert.ok(one.widths.every((w, i) => w >= stacked[i]), "no tab narrower than its label");
    assert.ok(Math.abs(one.widths.reduce((a, b) => a + b, 0) + 2 * 5 - 429) < 0.01, "the row is filled");
    // Room for all at the widest: equal widths.
    const wide = F.tabLayout(stacked, inline, 800, 2);
    assert.ok(wide.widths.every(w => w === wide.widths[0]));
    // A narrow drawer wraps onto rows of equal cells, beside the icon if it fits.
    const narrow = F.tabLayout(stacked, inline, 335, 2);
    assert.ok(narrow.rows >= 2);
    assert.ok(narrow.widths.every(w => w === narrow.widths[0]));
    const cellNeeds = narrow.stacked ? Math.max(...stacked) : Math.max(...inline);
    assert.ok(narrow.widths[0] >= cellNeeds, "every label fits its cell");
    assert.equal(narrow.rows, Math.ceil(6 / narrow.columns));
    assert.deepEqual(F.tabLayout([], [], 400, 2).widths, []);
    // Nothing fits even one column: one column regardless, labels wrap there.
    assert.equal(F.tabLayout([500], [520], 300, 2).columns, 1);
});

test("a segmented choice answers keys the way a radio group does", () => {
    const K = F.KEYS;
    // Qt's own key codes, so QML can pass event.key straight through.
    assert.deepEqual([K.space, K.ret, K.enter, K.home, K.end, K.left, K.up, K.right, K.down],
        [0x20, 0x01000004, 0x01000005, 0x01000010, 0x01000011, 0x01000012, 0x01000013,
            0x01000014, 0x01000015]);
    // The arrows step and stop at the ends rather than wrap.
    assert.equal(F.segmentTarget(K.right, 0, 3), 1);
    assert.equal(F.segmentTarget(K.down, 1, 3), 2);
    assert.equal(F.segmentTarget(K.right, 2, 3), 2);
    assert.equal(F.segmentTarget(K.left, 2, 3), 1);
    assert.equal(F.segmentTarget(K.up, 1, 3), 0);
    assert.equal(F.segmentTarget(K.left, 0, 3), 0);
    assert.equal(F.segmentTarget(K.home, 2, 3), 0);
    assert.equal(F.segmentTarget(K.end, 0, 3), 2);
    assert.equal(F.segmentTarget(K.end, 0, 2), 1, "two profiles without Performance");
    // Enter and Space choose the focused segment.
    for (const key of [K.ret, K.enter, K.space])
        assert.equal(F.segmentTarget(key, 1, 3), 1);
    // Tab, Escape and letters are left to the drawer.
    for (const key of [0x01000001, 0x01000000, 0x41])
        assert.equal(F.segmentTarget(key, 1, 3), -1);
    assert.equal(F.segmentTarget(K.right, 0, 0), -1, "an empty choice takes no keys");
});

test("a quick toggle shows what is in effect, a change under way, then a failure", () => {
    // At rest it is the actual state, whatever was requested.
    assert.equal(F.togglePhase(true, true, false, false), "on");
    assert.equal(F.togglePhase(false, false, false, false), "off");
    assert.equal(F.togglePhase(false, true, false, false), "off",
        "a start that has not taken effect does not read as on");
    // A change under way names its direction and outranks a shown failure.
    assert.equal(F.togglePhase(false, true, true, false), "turningOn");
    assert.equal(F.togglePhase(true, false, true, false), "turningOff");
    assert.equal(F.togglePhase(false, true, true, true), "turningOn");
    // A failure shows while it is shown, then the actual state returns.
    assert.equal(F.togglePhase(false, true, false, true), "failedOn");
    assert.equal(F.togglePhase(true, false, false, true), "failedOff");
});

test("a press asks for the opposite of what shows, and retries a failed start", () => {
    assert.equal(F.toggleTarget(false, false, false), true);
    assert.equal(F.toggleTarget(true, true, false), false);
    // Shown off while still requested on: the press asks for on again,
    // which the caller treats as a retry rather than a withdrawal.
    assert.equal(F.toggleTarget(false, true, false), true);
    // While a change runs, a press reverses it.
    assert.equal(F.toggleTarget(false, true, true), false);
    assert.equal(F.toggleTarget(true, false, true), true);
});
