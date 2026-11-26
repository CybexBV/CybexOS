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
