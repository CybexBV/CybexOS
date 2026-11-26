// "Show me where": where Settings' guide puts the small Wiz beside a row
// (Common/SettingsGuide.js), and how the pieces around it are wired: the
// assistant's settings_show tool, the guide's state in Settings and the row
// that stays marked while he points.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, shellDir } = require("./shell.cjs");

const G = load("SettingsGuide.js");
const W = load("WizRig.js");
const tips = G.tips(W);
const read = name => fs.readFileSync(path.join(shellDir, name), "utf8");

const SIZE = 48;
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
// The tip of his wand in layer pixels, for a placed spot.
function tipOf(spot) {
    const t = spot.aside ? tips.aside : spot.boxAbove ? tips.up : tips.down;
    const fx = spot.facing > 0 ? t.x : 1 - t.x;
    return { x: spot.x + fx * spot.width, y: spot.y + t.y * spot.height };
}

// A switch row as Settings lays it out: the label at the gutter's edge, the
// switch at the right, the reset column after it.
function switchRow(x, y, width, labelWidth = 84) {
    return {
        row: { x, y, width, height: 44 },
        label: { x: x + 18, y: y + 12, width: labelWidth, height: 20 },
        controls: [{ x: x + width - 28 - 50, y: y + 8, width: 48, height: 28 }]
    };
}

function place(row, area, extra = {}) {
    return G.place(Object.assign({ size: SIZE, tips, area }, row, extra));
}

function assertClear(spot, row) {
    for (const rect of [row.label].concat(row.controls).filter(Boolean))
        assert.ok(!intersects(spot, rect), `${spot.name} covers ${JSON.stringify(rect)}`);
}

test("the wand's tip comes from the rig's own pointing pose", () => {
    // Straight out to his right, about three quarters down his box.
    assert.ok(tips.aside.x > 0.85 && tips.aside.x < 0.95, JSON.stringify(tips.aside));
    assert.ok(tips.aside.y > 0.7 && tips.aside.y < 0.82, JSON.stringify(tips.aside));
    // Down: at his feet, in front of him. Up: beside his head.
    assert.ok(tips.down.y > 0.88 && tips.down.x > 0.7, JSON.stringify(tips.down));
    assert.ok(tips.up.y < 0.6 && tips.up.x > 0.75, JSON.stringify(tips.up));
    const pose = W.POSES.pointing;
    assert.ok(Math.abs(pose.wandA) < 20, "the pose itself points sideways");
});

test("with room before the row he stands there and points at the label", () => {
    const row = switchRow(120, 200, 640);
    const spot = place(row, { x: 0, y: 0, width: 900, height: 600 });
    assert.equal(spot.name, "left");
    assert.equal(spot.fits, true);
    assert.deepEqual([spot.facing, spot.aside], [1, true]);
    assertClear(spot, row);
    const tip = tipOf(spot);
    assert.ok(tip.x < row.label.x && tip.x > row.label.x - 12, JSON.stringify(tip));
    assert.ok(Math.abs(tip.y - (row.label.y + row.label.height / 2)) <= 1, JSON.stringify(tip));
    // His box stays before the label: the gutter, not the words.
    assert.ok(Math.abs(spot.x + spot.width - (row.label.x - G.GAP)) <= 1);
});

test("without room before it he stands between the label and its control", () => {
    const row = switchRow(0, 200, 400);
    const spot = place(row, { x: 0, y: 0, width: 400, height: 600 });
    assert.equal(spot.name, "gap");
    assertClear(spot, row);
    const tip = tipOf(spot);
    assert.ok(tip.x < row.controls[0].x && tip.x > row.controls[0].x - 12, "he points at the switch");
});

test("a changed row's mark and reset chip are kept clear too", () => {
    const row = switchRow(30, 200, 400);
    row.controls.push({ x: 30, y: 219, width: 6, height: 6 }, { x: 30 + 400 - 28, y: 208, width: 28, height: 28 });
    const spot = place(row, { x: 0, y: 0, width: 460, height: 600 });
    assertClear(spot, row);
    assert.equal(spot.fits, true);
});

test("a label that runs into a wide control sends him over or under the row", () => {
    // A slider from the end of the label column to the reset column.
    const row = {
        row: { x: 0, y: 300, width: 400, height: 44 },
        label: { x: 18, y: 312, width: 130, height: 20 },
        controls: [{ x: 150, y: 308, width: 222, height: 28 }]
    };
    const area = { x: 0, y: 0, width: 400, height: 600 };
    const above = place(row, area);
    assert.equal(above.name, "above");
    assert.equal(above.boxAbove, false, "he points down at the row");
    assertClear(above, row);
    // Near the top of the page there is no room above it: under it, pointing up.
    const top = { row: Object.assign({}, row.row, { y: 4 }), label: Object.assign({}, row.label, { y: 16 }),
        controls: [Object.assign({}, row.controls[0], { y: 12 })] };
    const below = place(top, area);
    assert.equal(below.name, "below");
    assert.equal(below.boxAbove, true);
    assertClear(below, top);
    assert.ok(below.y >= top.row.y + top.row.height);
});

test("a destination that is not a settings row is kept clear whole", () => {
    const group = { row: { x: 100, y: 100, width: 500, height: 160 }, label: null,
        controls: [{ x: 100, y: 100, width: 500, height: 160 }] };
    const spot = place(group, { x: 0, y: 0, width: 800, height: 600 });
    assert.equal(spot.name, "left");
    assertClear(spot, group);
    assert.ok(Math.abs(tipOf(spot).y - (100 + SIZE / 2)) <= 1, "he points at its first line");
});

test("the right-hand margin is used when only it has room", () => {
    const row = switchRow(0, 200, 400);
    // A label that reaches the switch, and room after the row.
    row.label.width = 300;
    const spot = place(row, { x: 0, y: 220, width: 520, height: 60 });
    assert.equal(spot.name, "right");
    assert.equal(spot.facing, -1);
    assertClear(spot, row);
    const tip = tipOf(spot);
    assert.ok(tip.x > 400 && tip.x < 412, JSON.stringify(tip));
});

test("when nothing fits he covers as little as he can and stays in the area", () => {
    // A label across the whole row, and less than his height above and below it.
    const row = { row: { x: 0, y: 30, width: 200, height: 40 }, label: { x: 0, y: 30, width: 200, height: 40 },
        controls: [] };
    const area = { x: 0, y: 0, width: 200, height: 100 };
    const spot = place(row, area);
    assert.equal(spot.fits, false);
    assert.ok(spot.x >= 0 && spot.y >= 0 && spot.x + spot.width <= 200 && spot.y + spot.height <= 100);
    // Over or under the row, where he covers only an edge of it.
    assert.ok(["above", "below"].includes(spot.name), spot.name);
    assert.ok(spot.overlap <= 18 * 48, String(spot.overlap));
});

test("settings_show is a shell tool the assistant service lists and the shell carries out", () => {
    const service = fs.readFileSync(path.join(shellDir, "../assistant/cybexos_assistant/desktop.py"), "utf8");
    assert.match(service, /"settings_show": \{\s*"kind": ACT, "where": "shell"/);
    const tools = read("Common/AssistantTools.qml");
    assert.match(tools, /case "settings_show": return showSetting\(/);
    assert.match(tools, /function showSetting\(key, respond, fail\) \{[\s\S]*?Settings\.showGuide\(row\);/);
    // Nothing is written: no Settings.set or save on this path.
    const body = tools.match(/function showSetting[\s\S]*?\n    \}/)[0];
    assert.doesNotMatch(body, /Settings\.set\(|saveNow/);
});

test("a guide ends on a change, a page or tab left, Settings closed, another jump or its time", () => {
    const settings = read("Common/Settings.qml");
    assert.match(settings, /property int guideTimeout: 30000/);
    assert.match(settings, /onPageChanged: \{[\s\S]*?endGuide\("page"\);/);
    assert.match(settings, /onTabChanged: \{[\s\S]*?endGuide\("page"\);/);
    assert.match(settings, /onPanelOpenChanged: \{[\s\S]*?endGuide\("closed"\);/);
    assert.match(settings, /onRevisionChanged: \{[\s\S]*?endGuide\("changed"\);/);
    assert.match(settings, /onHighlightKeyChanged: \{[\s\S]*?endGuide\("other"\);/);
    assert.match(settings, /onTriggered: root\.endGuide\("time"\)/);
    // The row stays lit while he points, after the search flash has gone.
    assert.match(read("Settings/SettingsRow.qml"),
        /highlighted: settingKey !== ""\s*&& \(Settings\.highlightKey === settingKey \|\| Settings\.guideKey === settingKey\)/);
    // Still once settled, and only there while a guide is.
    const guide = read("Settings/SettingsGuide.qml");
    assert.match(guide, /animated: root\.motion && \(lively\.running/);
    assert.match(guide, /active: root\.shown/);
    assert.match(guide, /pose: "pointing"/);
});
