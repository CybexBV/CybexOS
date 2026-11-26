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
    assert.match(tools, /case "settings_show": return showSetting\(String\(args\.row \|\| ""\), respond, fail\);/);
    assert.match(tools, /function showSetting\(text, respond, fail\) \{[\s\S]*?Settings\.showGuide\(row\);/);
    // Nothing is written: no Settings.set or save on this path.
    const body = tools.match(/function showSetting[\s\S]*?\n    \}/)[0];
    assert.doesNotMatch(body, /Settings\.set\(|saveNow/);
});

// The assistant's view of the search index: settings_search's answer and the
// one string per row that settings_show takes.
const { ROWS } = load("SettingsSearchData.js");
const DEFAULTS = load("SettingsHelpers.js").defaults();
const TOOLS = read("Common/AssistantTools.qml");
// The assistant's own settings, as AssistantTools.blockedKey says.
const BLOCKED = new RegExp(TOOLS.match(/function blockedKey\(key\) \{\s*return \/(.*?)\/\.test\(key\);/)[1]);
const blocked = key => BLOCKED.test(key);
const searchFor = query => G.searchResult(ROWS, query, DEFAULTS, key => DEFAULTS[key], blocked).results;

test("every row of the index has one handle, and the handle finds it again", () => {
    const handles = ROWS.map(G.handle);
    assert.equal(new Set(handles).size, ROWS.length, "no two rows share a handle");
    for (const row of ROWS) {
        assert.equal(G.rowFor(ROWS, G.handle(row)), row, G.handle(row));
        if (row.key)
            assert.equal(G.handle(row), row.key);
        else if (row.anchor)
            assert.equal(G.handle(row), row.anchor);
        else
            assert.match(G.handle(row), new RegExp(`^${row.page}:[a-z0-9]+(-[a-z0-9]+)*$`));
    }
    assert.equal(G.handle(ROWS.find(row => row.label === "Keyboard layouts")), "keyboard:keyboard-layouts");
    assert.equal(G.rowFor(ROWS, ""), null);
    assert.equal(G.rowFor(ROWS, "glass"), null);
    assert.equal(G.rowFor(ROWS, "assistantShown"), null, "a key no row shows names no row");
});

test("settings_search gives every row of the index a handle settings_show takes", () => {
    let pointing = 0, pageOnly = 0;
    for (const row of ROWS) {
        const hit = searchFor(row.label).find(entry => G.rowFor(ROWS, entry.row) === row);
        assert.ok(hit, `searching "${row.label}" finds ${G.handle(row)}`);
        assert.equal(hit.row, G.handle(row));
        assert.deepEqual([hit.label, hit.page, hit.group], [row.label, row.pageLabel, row.group || ""]);
        if (G.pointable(row))
            pointing++;
        else
            pageOnly++;
    }
    assert.equal(pointing + pageOnly, ROWS.length);
    assert.ok(pointing > 0 && pageOnly > 0);
    // Rows the old search hid: an anchor, the assistant's own and one with neither.
    for (const [query, row] of [["terminal", "applications-terminal"], ["speak replies", "assistantSpeak"],
        ["keyboard layouts", "keyboard:keyboard-layouts"], ["add shortcut", "shortcuts-add"]])
        assert.equal(searchFor(query)[0].row, row, query);
    assert.equal(searchFor("").length, 12, "no words: the index from the top");
    assert.deepEqual(searchFor("zzzz-nothing"), []);
});

test("only a known key that is not the assistant's own can be changed", () => {
    for (const row of ROWS) {
        const hit = searchFor(row.label).find(entry => entry.row === G.handle(row));
        const own = row.key !== "" && blocked(row.key);
        if (row.key && !own) {
            // The fields settings_search always gave, and the new ones.
            assert.deepEqual(Object.keys(hit), ["key", "label", "page", "group", "current", "default", "type",
                "row", "changeable"], row.key);
            assert.equal(hit.changeable, true);
            assert.equal(hit.key, row.key);
            assert.equal(hit.type, G.valueType(DEFAULTS[row.key]));
        } else {
            assert.deepEqual(Object.keys(hit), ["key", "label", "page", "group", "row", "changeable"], hit.row);
            assert.equal(hit.changeable, false, hit.row);
            // What settings_set would be handed for it is refused there: not a
            // known key, or the assistant's own.
            for (const name of [hit.key, hit.row].filter(Boolean))
                assert.ok(!Object.prototype.hasOwnProperty.call(DEFAULTS, name) || blocked(name), name);
        }
    }
    assert.ok(ROWS.some(row => row.key && blocked(row.key)), "the index holds some of the assistant's own");
    const answer = G.searchResult(ROWS, "glass", DEFAULTS, () => true, blocked);
    assert.match(answer.note, /Only a result with changeable true\s+can be changed, with settings_set/);
    assert.equal(answer.results[0].current, true, "current comes from the shell's settings");
    // settings_set itself refuses an unknown key and the assistant's own.
    const set = TOOLS.match(/function setValue\(key, value, respond, fail\) \{[\s\S]*?\n    \}/)[0];
    assert.match(set, /if \(!known\(key\)\)\s*return fail\(/);
    assert.match(set, /if \(blockedKey\(key\)\)\s*return fail\(/);
    assert.match(TOOLS, /return Guide\.searchResult\(SearchData\.ROWS, query, SettingsHelpers\.defaults\(\), key => Settings\[key\],\s*key => blockedKey\(key\)\);/);
});

test("a row Wiz cannot point at opens its page and says so", () => {
    const show = TOOLS.match(/function showSetting\(text, respond, fail\) \{[\s\S]*?\n    \}/)[0];
    assert.match(show, /const row = Guide\.rowFor\(SearchData\.ROWS, text\);/);
    assert.match(show, /if \(!Guide\.pointable\(row\)\) \{\s*Settings\.showGuide\(row\);[\s\S]*?return respond\(Object\.assign\(place, \{ shown: false,\s*note: "Settings is open on " \+ page/);
    const guide = read("Common/Settings.qml").match(/function showGuide\(row\) \{[\s\S]*?\n    \}/)[0];
    // The page opens first, then a row with neither key nor anchor ends any guide and stops there.
    assert.match(guide, /showPanel\(row\.page, "", key, row\.tab \|\| ""\);\s*\}\s*if \(key === ""\) \{\s*guideStarting = false;\s*endGuide\("other"\);\s*return false;/);
});

test("the guide opens the row's own tab, not the one the page would choose", () => {
    const settings = read("Common/Settings.qml");
    // showPanel takes the tab a caller knows; resolveTab only fills in for
    // callers that do not (a page's first tab for most keys).
    assert.match(settings, /function showPanel\(targetPage, targetScreenName, key, targetTab\) \{[\s\S]*?const tab = targetTab && tabsOf\(resolved\)\.some\(entry => entry\.id === targetTab\)\s*\? targetTab : resolveTab\(targetPage, key\);/);
    const guide = settings.match(/function showGuide\(row\) \{[\s\S]*?\n    \}/)[0];
    assert.match(guide, /showPanel\(row\.page, "", key, row\.tab \|\| ""\);/);
    assert.doesNotMatch(guide, /setTab\(/, "no tab set before showPanel, which would set it again");
    // Every row on a tabbed page names one of its tabs, so the guide never
    // falls back to the first.
    const { ROWS } = load("SettingsSearchData.js");
    const tabbed = { keyboard: ["layouts", "shortcuts"], assistant: ["wiz", "dictation"],
        backup: ["backups", "recovery", "storage"] };
    for (const entry of ROWS.filter(entry => !entry.widget && tabbed[entry.page]))
        assert.ok(tabbed[entry.page].includes(entry.tab), `${entry.label} names its tab`);
    for (const id of Object.keys(tabbed))
        assert.match(settings, new RegExp(`\\{ id: "${id}",[\\s\\S]*?tabs: \\[[\\s\\S]*?\\{ id: "${tabbed[id].join('"[\\s\\S]*?\\{ id: "')}"`));
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
    // The row stays lit while he points, after the search flash has gone,
    // whether Settings finds it by its key or by its search anchor.
    const row = read("Settings/SettingsRow.qml");
    assert.match(row, /highlighted: \(settingKey !== ""\s*&& \(Settings\.highlightKey === settingKey \|\| Settings\.guideKey === settingKey\)\)/);
    assert.match(row, /\|\| \(searchAnchor !== ""\s*&& \(Settings\.highlightKey === searchAnchor \|\| Settings\.guideKey === searchAnchor\)\)/);
    // Still once settled, and only there while a guide is.
    const guide = read("Settings/SettingsGuide.qml");
    assert.match(guide, /animated: root\.motion && \(lively\.running/);
    assert.match(guide, /active: root\.shown/);
    assert.match(guide, /pose: "pointing"/);
});
