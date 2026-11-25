const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, shellDir } = require("./shell.cjs");

const G = load("BarGeometry.js");

test("bar styles choose edge margins and outer radii", () => {
    assert.deepEqual(G.STYLES, ["hug", "floating", "attached"]);
    assert.equal(G.edgeMargin("hug", 10), 0);
    assert.equal(G.edgeMargin("attached", 10), 0);
    assert.equal(G.edgeMargin("floating", 10), 10);
    assert.equal(G.outerRadius("hug", 23), 0);
    assert.equal(G.outerRadius("attached", 23), 0);
    assert.equal(G.outerRadius("floating", 23), 23);
    assert.equal(G.styleIn("unknown"), "hug");
});

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

test("the live bar keeps borderless hug corners visual-only and attached square", () => {
    const bar = fs.readFileSync(path.join(shellDir, "Bar/Bar.qml"), "utf8");
    const corner = fs.readFileSync(path.join(shellDir, "Common/HugCorner.qml"), "utf8");
    assert.match(bar, /visible:\s*Theme\.barHug/g);
    assert.match(bar, /bottomCorner:\s*Settings\.position === "bottom"/);
    assert.match(bar, /height:\s*Theme\.barTopMargin \+ Theme\.barHeight\n/,
        "the interactive mask stops before the corner decorators");
    assert.match(bar, /radius:\s*Theme\.clusterRadius/);
    assert.match(corner, /import QtQuick\.Shapes/);
    assert.match(corner, /PathCubic/);
    assert.doesNotMatch(corner, /strokeWidth:\s*1/);
    assert.doesNotMatch(bar, /id:\s*barSlab[\s\S]{0,220}?border\.width/);
    assert.doesNotMatch(bar, /DropShadow/);
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

test("Hyprland and shell surfaces share the hug corner radius", () => {
    const theme = fs.readFileSync(path.join(shellDir, "Common/Theme.qml"), "utf8");
    const look = fs.readFileSync(
        path.resolve(shellDir, "../hypr/looknfeel.lua"), "utf8");
    const surfaceRadius = theme.match(/readonly property int surfaceRadius:\s*(\d+)/);
    const windowRadius = look.match(/decoration\s*=\s*\{[\s\S]*?rounding\s*=\s*(\d+)/);

    assert.ok(surfaceRadius, "Theme.surfaceRadius must remain a literal design token");
    assert.ok(windowRadius, "Hyprland decoration.rounding must remain explicit");
    assert.equal(Number(windowRadius[1]), Number(surfaceRadius[1]));
    // Only the Hug corners answer to the compositor. The shell's own dialogs
    // answer to the menubar instead: a panel takes the bar's corner, and
    // everything inside it takes the bar's chip corner.
    assert.match(theme, /readonly property int hugCornerSize:\s*surfaceRadius/,
        "the Hug corners must keep matching Hyprland's window rounding");
    assert.match(theme, /readonly property int popRadius:\s*panelRadius/);
    for (const alias of ["cardRadius", "rowRadius", "tileRadius"])
        assert.match(theme,
            new RegExp(`readonly property int ${alias}:\\s*chipRadius`),
            `Theme.${alias} must use the bar's chip corner`);
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
