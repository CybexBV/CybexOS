const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

function read(relative) {
    return fs.readFileSync(path.join(shellDir, relative), "utf8");
}

const moduleSource = read("Bar/Modules/Notifications.qml");

test("notification history is an always-eligible reorderable widget", () => {
    const settings = load("SettingsHelpers.js");
    const catalog = load("WidgetCatalog.js");
    const defaults = settings.defaultMods();
    const rightIds = defaults.right.map(entry => entry.id);

    // The assistant's button sits between the tray and the notification
    // history, ahead of the status widgets (schema 30).
    assert.equal(rightIds[rightIds.indexOf("tray") + 1], "assistant");
    assert.equal(rightIds[rightIds.indexOf("assistant") + 1], "notifications");
    assert.equal(rightIds[rightIds.indexOf("notifications") + 1], "vol");
    assert.equal(defaults.right.find(entry => entry.id === "notifications").on, true);
    assert.equal(settings.moduleGroup("notifications", settings.defaultModOpts()), "status");
    assert.equal(settings.moduleGroup("notifications",
        { notifications: { group: "solo" } }), "solo");
    assert.equal(catalog.WIDGETS.notifications.name, "Notifications");
    assert.equal(catalog.WIDGETS.notifications.detail, true);
    assert.match(read("Bar/Bar.qml"),
        /notifications:\s*"Modules\/Notifications\.qml"/);
    assert.match(read("Settings/ModulesPage.qml"),
        /hasDetail:\s*page\.selected \? page\.selected\.detail : false/,
        "a detail-only widget must still expose its compaction policy");
});

test("notification widget shows an unread mark and compact glyph state", () => {
    assert.match(moduleSource, /moduleId:\s*"notifications"/);
    assert.match(moduleSource, /panelName:\s*"notifications"/);
    // The edge-drawer design trades the bar count for an accent unread dot;
    // the count lives in the tooltip and the drawer's Notifications tab.
    assert.match(moduleSource, /visible:\s*Notifs\.count > 0/);
    assert.match(moduleSource,
        /color:\s*Notifs\.hasUrgent \? Theme\.barRedText : Theme\.barAccent/);
    assert.doesNotMatch(moduleSource, /label:\s*Notifs\.count/,
        "the bell carries a dot, not a number");
    assert.match(moduleSource, /I18n\.format\("%1 notifications", \[Notifs\.count\]\)/,
        "the tooltip still says how many");
    // One name for Do Not Disturb everywhere (2026-11): Focus.
    assert.match(moduleSource, /I18n\.format\("Notifications · Focus · %1", \[Notifs\.count\]\)/);
    assert.doesNotMatch(moduleSource, /"[^"\n]*Do Not Disturb[^"\n]*"/);
    assert.match(moduleSource, /alert:\s*Notifs\.hasUrgent/);
});

test("Focus has one calm mark on the menubar", () => {
    // 2026-11-24 review: the clock-side Focus action and an accent-filled
    // bell both lit up. The clock-side action keeps the mark while it is on
    // show; otherwise the bell carries it as a slashed accent glyph.
    const bar = read("Bar/Bar.qml");
    assert.match(bar, /readonly property bool focusOnClockSide: \{[\s\S]*?Settings\.modOpts\.indicators\.enabled\.indexOf\("dnd"\) === -1[\s\S]*?candidate\.id === "indicators"[\s\S]*?return moduleShown\(entry\);/);
    assert.match(moduleSource,
        /readonly property bool showsFocus: Notifs\.dnd\s*&& !\(root\.host !== null && root\.host\.focusOnClockSide\)/);
    assert.match(moduleSource,
        /glyph:\s*root\.showsFocus \? "notifications_off" : "notifications"/);
    assert.match(moduleSource, /idleColor:\s*root\.showsFocus \? Theme\.barAccent : Theme\.barIcon/);
    assert.doesNotMatch(moduleSource, /^\s*active:/m, "Focus is a state, not a pressed bell");
    // The clock-side action is the one that says when Focus ends.
    const indicators = read("Bar/Modules/Indicators.qml");
    assert.match(indicators, /case "dnd": return Notifs\.dnd;/);
    assert.match(indicators, /"Turn off Focus · " \+ Notifs\.dndStatus/);
});

test("opening notification history does not consume its retained entries", () => {
    const notifs = read("Common/Notifs.qml");
    assert.match(notifs, /readonly property int count:\s*entries\.length/);
    assert.match(notifs, /function dismiss\(entry\)[\s\S]{0,100}?removeEntry\(entry\.key\)/);
    assert.match(notifs, /function clearAll\(\)[\s\S]*?entries = \[\]/);
    assert.doesNotMatch(moduleSource, /Notifs\.(?:dismiss|clearAll|removeEntry)\(/,
        "opening the panel must not mark retained session history as read");
});

test("the retired bell id is not reused for the new widget", () => {
    const settings = load("SettingsHelpers.js");
    assert.ok(settings.RETIRED_MODULE_IDS.includes("bell"));
    assert.ok(!settings.MODULE_IDS.includes("bell"));
    assert.ok(settings.MODULE_IDS.includes("notifications"));
    assert.equal(fs.existsSync(path.join(shellDir, "Bar/Modules/Bell.qml")), false);
});

test("an empty notification centre shows Wiz, asleep while Focus is on", () => {
    const centre = read("Popovers/Drawer/DrawerNotifications.qml");
    const empty = centre.slice(centre.indexOf("Nothing kept at all"),
        centre.indexOf("I18n.tr(\"EARLIER\")"));

    assert.match(centre, /import "\.\.\/\.\.\/Assistant"/);
    // Created only while nothing is kept, and still: idle blinks, asleep
    // does not even do that; neither loops.
    assert.match(empty, /Loader \{\s*active: Notifs\.count === 0/);
    assert.match(empty, /Wiz \{[\s\S]*?width: Theme\.scaled\(64\)[\s\S]*?pose: Notifs\.dnd \? "asleep" : "idle"/);
    assert.doesNotMatch(empty, /recording:|animated:|"thinking"|"working"/);
    assert.doesNotMatch(empty, /Sym \{/, "Wiz replaces the bell");
    // One message per state (2026-11-24 review: "All clear", "Nothing new"
    // and "You're all caught up." used to stack): Wiz's one line when nothing
    // is kept, the header's "Nothing new" over older notifications only.
    assert.equal((empty.match(/I18n\.tr\("/g) || []).length, 1, "one line under Wiz");
    assert.match(empty, /I18n\.tr\("You're all caught up\."\)/);
    assert.match(centre,
        /text: root\.recent\.length > 0\s*\? I18n\.format\("%1 new", \[root\.recent\.length\]\)\s*: Notifs\.count > 0 \? I18n\.tr\("Nothing new"\) : ""/);
    assert.doesNotMatch(centre, /"All clear"|"Quiet hour"|notifications_off/);
    assert.equal((centre.match(/I18n\.tr\("Nothing new"\)/g) || []).length, 1);
});
