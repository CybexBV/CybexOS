const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, shellDir } = require("./shell.cjs");

const G = load("BarGeometry.js");

test("hug and attached reserve exactly the bar while floating retains its gap", () => {
    const base = { height: 46, gap: 10, exclusive: true, autoHide: false };
    assert.equal(G.exclusiveZone({ ...base, style: "hug" }), 46);
    assert.equal(G.exclusiveZone({ ...base, style: "attached" }), 46);
    assert.equal(G.exclusiveZone({ ...base, style: "floating" }), 54);
    assert.equal(G.exclusiveZone({ ...base, style: "hug", autoHide: true }), 0);
    assert.equal(G.exclusiveZone({ ...base, style: "floating", exclusive: false }), 0);
});

test("top and bottom placement, hide translation, and popout depth mirror", () => {
    const base = { style: "hug", gap: 10, height: 46, windowHeight: 90 };
    assert.equal(G.barY({ ...base, position: "top" }), 0);
    assert.equal(G.barY({ ...base, position: "bottom" }), 44);
    assert.equal(G.hideShift({ ...base, position: "top" }), -58);
    assert.equal(G.hideShift({ ...base, position: "bottom" }), 58);
    assert.equal(G.popoutAnchorDepth("hug", 10, 46), 46);
    assert.equal(G.popoutAnchorDepth("floating", 10, 46), 56);
});

test("hug rounds the opposite screen edge's corners like the bar's own", () => {
    const corners = fs.readFileSync(path.join(shellDir, "Bar/ScreenCorners.qml"), "utf8");
    const shell = fs.readFileSync(path.join(shellDir, "shell.qml"), "utf8");
    // Beside each output's bar, on the edge the bar is not on.
    assert.match(shell, /ScreenCorners \{\s*bar: barWindow\s*screen: barScope\.output/);
    assert.match(corners, /readonly property bool atTop: Settings\.position === "bottom"/);
    assert.match(corners, /readonly property bool shown: Theme\.barHug && !bar\.hidden/);
    // The bar's corner, at the bar corners' size, in black.
    assert.equal((corners.match(/HugCorner \{/g) || []).length, 2);
    assert.doesNotMatch(corners, /cornerSize:/, "the corners keep HugCorner's own size");
    assert.match(corners, /implicitHeight: Theme\.hugCornerSize/);
    assert.equal((corners.match(/fillColor: "#000000"/g) || []).length, 2);
    // Visual only: no pointer, no keyboard, no reserved space.
    assert.match(corners, /mask: Region \{\}/);
    assert.match(corners, /exclusionMode: ExclusionMode\.Ignore/);
    assert.match(corners, /keyboardFocus: WlrKeyboardFocus\.None/);
});

test("a bar tooltip stays 8 px inside both edges of the bar's window", () => {
    // Centred under the last module: 40 px past the right edge comes back.
    assert.equal(G.tooltipNudge(1880, 120, 1920, 8), -88);
    // Under the first module, left of the window: moves right.
    assert.equal(G.tooltipNudge(-45, 120, 1920, 8), 53);
    assert.equal(G.tooltipNudge(4, 120, 1920, 8), 4);
    // Already inside, or exactly at the margin: untouched.
    assert.equal(G.tooltipNudge(600, 120, 1920, 8), 0);
    assert.equal(G.tooltipNudge(8, 120, 1920, 8), 0);
    assert.equal(G.tooltipNudge(1792, 120, 1920, 8), 0);
    // Wider than the window: keeps its left margin. No window yet: no move.
    assert.equal(G.tooltipNudge(100, 2000, 1920, 8), -92);
    assert.equal(G.tooltipNudge(1880, 120, 0, 8), 0);
});

test("every bar tooltip clamps itself, so no caller can place one off screen", () => {
    const tip = fs.readFileSync(path.join(shellDir, "Bar/BarTooltip.qml"), "utf8");
    assert.match(tip, /BarGeometry\.tooltipNudge\(left, root\.width, window\.width, edgeMargin\)/);
    assert.match(tip, /Translate \{ x: root\.nudge \}/);
    assert.match(tip, /root\.keepOnScreen\(\);\s*root\.ready = root\.activeHover;/);
});
