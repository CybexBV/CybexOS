const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

function read(relative) {
    return untranslated(fs.readFileSync(path.join(shellDir, relative), "utf8"));
}

test("the settings IPC target is declared exactly once shell-wide", () => {
    const qmlFiles = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "tests")
                walk(path.join(dir, entry.name));
            else if (entry.name.endsWith(".qml"))
                qmlFiles.push(path.join(dir, entry.name));
        }
    };
    walk(shellDir);
    const declaring = qmlFiles.filter(file =>
        /target:\s*"settings"/.test(untranslated(fs.readFileSync(file, "utf8"))));
    assert.deepEqual(declaring.map(file => path.relative(shellDir, file)),
        ["shell.qml"]);
});

test("every connected output keeps a bar while popouts stay single-hosted", () => {
    const shell = read("shell.qml");
    const screens = read("Common/Screens.qml");
    const bar = read("Bar/Bar.qml");
    const window = read("Bar/BarPopoutWindow.qml");
    const popouts = read("Common/Popouts.qml");
    const barPage = read("Settings/BarLayoutGroups.qml");

    assert.match(shell, /Variants\s*\{[\s\S]*?model:\s*Screens\.layerSurfaceModel[\s\S]*?Bar\s*\{/,
        "bars must still be created from the live screen model");
    assert.match(shell, /visible:\s*barScope\.output !== null/,
        "each connected output's bar must remain mapped independently of focus");
    assert.match(screens,
        /layerSurfaceModel:\s*Quickshell\.screens\.map\([\s\S]*?screen\.x[\s\S]*?screen\.y[\s\S]*?screen\.width[\s\S]*?screen\.height/,
        "persistent layer surfaces must be recreated when a surviving output moves");
    assert.equal((shell.match(/model:\s*(?:OmarchyPlugins\.replacementActive \? \[\] : )?Screens\.layerSurfaceModel/g) ?? []).length, 3,
        "wallpaper, bar and dock surfaces must use geometry-sensitive identities");
    assert.doesNotMatch(shell, /onFocusedScreen|barEnabled|Settings\.monitor/,
        "focus and the retired monitor picker must not gate a bar window");

    assert.match(popouts, /property string hostScreenName/);
    assert.match(popouts,
        /target:\s*Screens[\s\S]{0,180}?onLayerSurfaceModelChanged[\s\S]{0,180}?!Screens\.byName\(root\.hostScreenName\)[\s\S]{0,100}?root\.close\(\)/,
        "a popout must close before its removed output becomes a fallback surface");
    assert.match(bar, /Popouts\.toggle\(name, isle, anchorOf\(item\), outputName\)/,
        "pointer opens must identify the clicked bar's output");
    assert.match(window, /readonly property bool live:\s*bar\.visible && bar\.popoutHost/,
        "only the originating output may map the shared popout");
    const anchorSync = bar.slice(
        bar.indexOf("// IPC opens and transitions initiated inside a popout"),
        bar.indexOf("// Input region for the bar strip itself."));
    assert.equal((anchorSync.match(/if \(!barWindow\.popoutActive\)/g) ?? []).length, 2,
        "only the owning bar may reconcile the shared popout anchor, including after callLater");
    assert.doesNotMatch(anchorSync, /!barWindow\.visible/,
        "all connected bars are visible, so visibility cannot select the popout owner");
    const popoutHost = read("Bar/PopoutHost.qml");
    assert.match(popoutHost,
        /id:\s*closeTimer[\s\S]{0,500}?if \(host\.live && Popouts\.open\)\s*return;/,
        "an inactive host must release its stale surface during a handoff");
    assert.doesNotMatch(barPage, /settingKey:\s*"monitor"|Follow focus/,
        "settings must not advertise the removed single-monitor behavior");
});

test("settings uses an independent floating window with compatibility routes", () => {
    const shell = read("shell.qml");
    const settings = read("Common/Settings.qml");
    const window = read("SettingsWindow.qml");
    const popouts = read("Common/Popouts.qml");

    assert.match(shell, /SettingsWindow\s*\{/);
    assert.match(window, /AppWindow\s*\{/);
    assert.match(read("AppWindow.qml"), /FloatingWindow\s*\{/);
    assert.match(window, /open: Settings\.panelOpen/);
    assert.match(window, /onClosed: Settings\.closePanel\(\)/);
    assert.match(window, /view\.handleEscape\(\)/);
    assert.match(window, /startSystemMove\(\)/);
    assert.doesNotMatch(settings, /Popouts\.openPanel/);
    assert.doesNotMatch(settings, /target: Popouts/);
    assert.match(popouts, /Settings\.showPanel\(undefined, targetScreenName\)/);
    assert.match(popouts, /Settings\.togglePanel\(undefined, targetScreenName\)/);
});

test("settings exposes responsive output and keyboard contracts", () => {
    const view = read("Settings/SettingsView.qml");
    const host = read("Bar/PopoutHost.qml");
    const modules = read("Settings/ModulesPage.qml");
    const picker = read("Settings/PickerRow.qml");

    // The envelope is declared once, on the contract both the settings view
    // and every popover surface inherit; the view only overrides defaults.
    const contract = read("Popovers/PopoutPanel.qml");
    assert.match(contract, /property real availableWidth/);
    assert.match(contract, /property real availableHeight/);
    assert.match(contract, /function handleEscape\(\): bool/);
    assert.match(view, /^PopoutPanel \{/m,
        "the settings view must inherit the popout contract");
    assert.match(read("Popovers/Surface.qml"), /^PopoutPanel \{/m,
        "every popover surface must inherit it too");
    assert.match(view, /availableWidth\s*<\s*Theme\.scaled\(860, Theme\.typeScale\)/);
    assert.match(view, /function handleEscape\(\): bool/);
    // The host holds its loaded item as the contract type now, so these are
    // plain property writes rather than existence checks.
    assert.match(host, /item as PopoutPanel/,
        "the host must hold its panel as the contract type");
    assert.match(host, /panel\.availableWidth = /);
    assert.match(host, /panel\.availableHeight = /);
    assert.doesNotMatch(host, /!== undefined/,
        "the panel contract must not be probed for at runtime any more");
    // Every panel lays out once at its own implicit size and is revealed by
    // the animating card; binding one to the card would relayout the whole
    // tree on every morph frame.
    assert.match(host, /width:\s*Math\.max\(1, implicitWidth\)/);
    assert.match(host, /height:\s*Math\.max\(1, implicitHeight\)/);
    assert.doesNotMatch(host, /width:\s*fillBody \? parent\.width/,
        "the settings surface must not track the animating clip size");
    assert.match(host, /nameFor\(frontSlot\) !== Popouts\.currentName/,
        "an outgoing popover must not overwrite Settings geometry during a morph");
    assert.match(read("Settings/WidgetPill.qml"), /Qt\.Key_Space/);
    assert.match(read("Settings/WidgetPill.qml"), /Qt\.Key_Escape/);
    assert.match(picker, /readonly property real captionWidth/);
    assert.doesNotMatch(picker, /width:\s*root\.narrow \? parent\.width : implicitWidth/,
        "picker flows need a concrete lane width or every pill wraps");
});

test("popout height cannot feed back into its own required envelope", () => {
    const host = read("Bar/PopoutHost.qml");
    const window = read("Bar/BarPopoutWindow.qml");

    assert.match(window, /implicitHeight:\s*Math\.max\(1, popout\.requiredHeight\)/);
    assert.doesNotMatch(host, /onHeightChanged:\s*retargetFront\(\)/,
        "requiredHeight drives native height, so native height cannot retarget requiredHeight");
    assert.match(host, /onOutputAvailableHeightChanged:\s*retargetFront\(\)/,
        "screen-height changes still need to recompute the panel envelope");
    // The envelope reads a stable surfaceH, never the animating renderedH:
    // tracking the morph per frame resizes the blurred Wayland surface on
    // every animation frame, while shrinking after the morph produces one
    // conspicuous compositor reconfigure after the card has already settled.
    assert.match(host, /requiredHeight:\s*presented\s*\?\s*bodyTop \+ Math\.max\(1, surfaceH\)/,
        "the surface envelope must come from the settled height");
    assert.match(host, /surfaceH = Math\.max\(surfaceH, geometry\.bodyH\)/,
        "the surface must grow to the morph's target before the springs start");
    assert.doesNotMatch(host, /surfaceH\s*=\s*(?:host\.)?targetH/,
        "the mapped surface must not shrink after a shorter panel settles");
    assert.doesNotMatch(host, /id:\s*settleTimer/,
        "a post-animation timer must not trigger a second layer-shell configure");
    assert.match(host, /host\.presented = false;\s*host\.surfaceH = 0;/,
        "the surface envelope resets only after the close animation unmaps it");
    // Quickshell 0.2.1 sends this region in the wrong coordinate space on a
    // scaled output. It is only a rendering optimisation, but at 2x it becomes
    // a hard visual clip through the panel sides and bottom.
    assert.doesNotMatch(window, /^\s*HyprlandWindow\.visibleMask\s*:/m,
        "a HiDPI popout must not be clipped by Hyprland's visible-mask hint");
    assert.doesNotMatch(host, /visualItem/,
        "the host must not retain a dead visual-mask contract");
    // The input mask holds still too — it binds to the morph's target, so the
    // compositor hears about it once per switch instead of once per frame.
    assert.match(host, /id: cardHitRegion[\s\S]{0,80}?x: host\.targetX/,
        "the input region must not follow the animating rendered geometry");
});

test("a newly fronted popout remeasures after nested content settles", () => {
    const host = read("Bar/PopoutHost.qml");

    assert.match(host,
        /frontSlot = slot;[\s\S]*?Qt\.callLater\(\(\) => \{[\s\S]*?retargetFront\(\);\s*animateToTargets\(\);/,
        "the final implicit-size change must not fall between presentation and resize listeners");
});

test("declared overflow paints and receives input outside the panel card", () => {
    const contract = read("Popovers/PopoutPanel.qml");
    const host = read("Bar/PopoutHost.qml");
    const window = read("Bar/BarPopoutWindow.qml");

    assert.match(contract, /property real detachedOverflowHeight:\s*0/);
    assert.match(contract, /property Item detachedOverflowItem:\s*null/);
    assert.match(host,
        /cardH:\s*contentH - overflowH[\s\S]*?targetCardH = geometry\.cardH/,
        "native extent and painted-card height must be separate geometry");
    assert.match(host,
        /id:\s*surface[\s\S]*?height:\s*Math\.max\(1, host\.renderedCardH\)/,
        "the shared background must stop before the transparent overflow tail");
    assert.match(host,
        /id:\s*cardHitRegion[\s\S]*?height:\s*Math\.max\(0, host\.targetCardH\)/);
    assert.match(window,
        /mask:\s*Region\s*\{[\s\S]*?item:\s*popout\.cardMaskItem[\s\S]*?item:\s*popout\.overflowMaskItem/,
        "the input mask is the union of the card and detached control");
});

test("the retired bell, idle, and usage modules leave nothing behind", () => {
    const helpers = read("Common/SettingsHelpers.js");
    const modules = read("Settings/ModulesPage.qml");
    const bar = read("Bar/Bar.qml");

    for (const [id, file] of [["bell", "Bell"], ["idle", "Idle"], ["usage", "Usage"]]) {
        assert.ok(!fs.existsSync(path.join(shellDir, `Bar/Modules/${file}.qml`)),
            `Bar/Modules/${file}.qml is still on disk`);
        // Word-bounded, so a `modelusage` id would not count as `usage`.
        assert.doesNotMatch(bar, new RegExp(`\\b${id}:\\s*"Modules/`),
            `the bar still maps a source for ${id}`);
        assert.doesNotMatch(modules, new RegExp(`^\\s*${id}:\\s*\\{ name:`, "m"),
            `the settings module list still names ${id}`);
    }
    assert.match(helpers, /RETIRED_MODULE_IDS = \["bell", "idle", "usage",/);
    // The Model Usage plugin replaced the built-in widget wholesale: its
    // singleton, chips, popover, drawer tab and fetch scripts went with it.
    // Schema 36 retired the six connected-service widgets the same way:
    // they are Cybex OS plugins now.
    for (const [id, file] of [["modelusage", "ModelUsage"], ["fusebox", "Fusebox"],
            ["gh", "GitHub"], ["t3", "T3"], ["hermes", "Hermes"], ["remote", "Remote"]]) {
        assert.ok(!fs.existsSync(path.join(shellDir, `Bar/Modules/${file}.qml`)),
            `Bar/Modules/${file}.qml is still on disk`);
        assert.doesNotMatch(bar, new RegExp(`\\b${id}:\\s*"Modules/`),
            `the bar still maps a source for ${id}`);
    }
    for (const file of ["ModelUsage", "Common/T3Code.qml", "Common/Hermes.qml",
                        "Common/GitHub.qml", "Common/Fusebox.qml", "Common/RemoteServer.qml",
                        "Settings/GitHubWatchList.qml", "scripts/fusebox.py",
                        "scripts/remote-server.py", "scripts/t3-cloud.mjs"])
        assert.ok(!fs.existsSync(path.join(shellDir, file)), `${file} is still on disk`);
    for (const file of ["Common/Usage.qml", "Common/UsageHelpers.js", "Bar/UsageChips.qml",
                        "Popovers/UsagePopover.qml", "Popovers/Drawer/DrawerUsage.qml",
                        "scripts/usage-fetch.py", "scripts/usage-credential.py"])
        assert.ok(!fs.existsSync(path.join(shellDir, file)), `${file} is still on disk`);
});

test("schema twenty-three keeps safe defaults and exposes accessibility preferences", () => {
    const helpers = read("Common/SettingsHelpers.js");
    assert.match(helpers, /var VERSION = 36/);
    // Schema 17: the drawer becomes configurable (turn-3 settings design).
    assert.match(helpers, /drawerHover: "open"/);
    assert.match(helpers, /drawerWidth: 400/);
    assert.match(helpers, /function normalizeDrawerTabs\(raw\)/);
    assert.match(helpers, /function normalizeDrawerOverview\(raw\)/);
    assert.match(helpers, /id === "overview" \? true/,
        "the Overview tab can be reordered but never disabled");
    assert.match(helpers, /highContrast: false/);
    assert.match(helpers, /reducedMotion: false/);
    assert.match(helpers, /textScale: "default"/);
    assert.match(helpers, /interfaceDensity: "default"/);
    assert.match(helpers, /"media", "indicators", "clock"/);
    assert.match(helpers, /nightLight:\s*false/);
    assert.match(helpers, /idleInhibitMode:\s*"off"/);
    assert.match(helpers, /idleInhibitUntilMs:\s*0/);
    assert.match(helpers, /"notes", "updates",\s*"tray"/);
    assert.match(helpers,
        /notes:\s*\{[\s\S]*?titleProvider:\s*"off"[\s\S]*?codexModel:\s*"gpt-5\.6-luna"[\s\S]*?codexEffort:\s*"none"[\s\S]*?claudeModel:\s*"fable"[\s\S]*?claudeEffort:\s*"low"/);
    assert.match(helpers, /mod\("tray", false\), mod\("assistant", true\), mod\("notifications", true\), mod\("vol", true\)/);
    assert.match(helpers, /notifications:\s*\{ group: "status" \}/);
    assert.match(helpers, /warmth:\s*3400/);
    assert.match(helpers, /osd:\s*"bottom"/);
    assert.match(helpers, /themeMode:\s*"dark"/);
    assert.match(helpers, /barHeight:\s*36/);
    assert.match(helpers, /barRadius:\s*11/);
    assert.match(helpers, /glassEnabled:\s*false/);
    assert.match(helpers, /barColorMode:\s*"default"/);
    assert.match(helpers, /paletteMode:\s*"wallpaper"/);
    assert.match(helpers, /barStyle:\s*"hug"/);
    assert.match(helpers, /function migrateBarStyle\(parsed, defaultsValue\)/);
    assert.match(helpers, /function migratePaletteMode\(parsed, defaultsValue\)/);
    assert.doesNotMatch(helpers, /function adoptSofterTypography\(parsed\)/);
    assert.match(helpers, /mod\("media", true\)/);
    assert.match(helpers, /mod\("bt", true\)/);
    assert.match(helpers, /wallDir:\s*"~\/Pictures\/Wallpapers"/);
    assert.match(helpers, /DETAIL_POLICIES/);
    // Stored legacy defaults are indistinguishable from explicit choices.
    assert.doesNotMatch(helpers, /function adoptRedesign|function adoptClassicMenubar/);
    assert.match(helpers, /function serializeDocument/);

});

test("settings improvements expose fitting, embedded folders, undo, and shortcut", () => {
    const bar = read("Bar/Bar.qml");
    const modules = read("Settings/ModulesPage.qml");
    const wallpaper = read("Settings/WallpaperPage.qml");
    const folder = read("Settings/FolderDialog.qml");
    const settings = read("Common/Settings.qml");
    const bindings = untranslated(fs.readFileSync(path.resolve(shellDir, "../hypr/bindings.lua"), "utf8"));

    assert.match(bar, /LayoutHelpers\.fitBar/);
    assert.doesNotMatch(bar, /width\s*>=\s*Theme\.breakpoint/);
    assert.match(modules, /Editor\.dropPlan/,
        "the editor maps visible gaps to configured indices");
    assert.match(modules, /LayoutHelpers\.moveWidget/,
        "both surfaces preserve the same move semantics");
    assert.match(wallpaper, /WallpaperPicker\s*\{/);
    assert.match(folder, /popupType:\s*Controls\.Popup\.Item/);
    assert.match(settings, /interval:\s*8000/);
    assert.match(settings, /function retrySave/);
    assert.match(settings,
        /migrationPending = parsed !== null && parsed\.v !== SettingsHelpers\.VERSION/);
    assert.match(settings,
        /if \(!ready \|\| migrationPending \|\| corruptBackupPending \|\| loadError\)/,
        "older files must wait for the next user mutation before a current-schema write");
    assert.match(bindings, /mainMod \..*" \+ comma".*settings toggle/);
});

test("touchpad scroll speed defaults to Hyprland's factor and applies live", () => {
    const settings = read("Common/Settings.qml");
    const helpers = read("Common/SettingsHelpers.js");
    const system = read("Settings/TouchpadPage.qml");
    const input = untranslated(fs.readFileSync(
        path.resolve(shellDir, "../hypr/input.lua"), "utf8"));

    assert.match(helpers, /scrollFactor:\s*1\.0/);
    assert.match(helpers, /realIn\(parsed\.scrollFactor, 0\.2, 2\.0, 0\.1/);
    assert.match(settings,
        /"hyprctl", "eval",\s*"hl\.config\(\{ input = \{ touchpad = \{ scroll_factor = "\s*\+ root\.scrollFactor\.toFixed\(1\) \+ " \} \} \}\)"\]/);
    assert.doesNotMatch(settings, /"hyprctl", "keyword"/,
        "a Lua-configured Hyprland refuses keyword with exit status 0");
    assert.match(system, /min:\s*0\.2[\s\S]*max:\s*2\.0[\s\S]*step:\s*0\.1/);
    assert.match(input, /persisted_scroll_factor\(\)/);
    assert.match(input, /"scrollFactor"%s\*:%s\*\(\[%d%\.\]\+\)/);
    assert.doesNotMatch(input, /scroll_factor\s*=\s*0\.4/);
});

test("swipe between workspaces is one touchpad switch in the saved input preferences", () => {
    const page = read("Settings/TouchpadPage.qml");
    const backend = read("scripts/system_settings_input.py");
    const loader = untranslated(fs.readFileSync(path.resolve(shellDir, "../hypr/input_preferences.lua"), "utf8"));
    const rows = load("SettingsSearchData.js").ROWS;

    // Drafted behind Apply with the other switches; on unless saved off.
    const drafts = read("Settings/InputDrafts.qml");
    assert.match(page, /editState: InputDrafts\.touchpad/);
    assert.match(drafts, /draft: \(\{[^}]*workspaceSwipe: true/);
    assert.match(drafts, /original: \(\{[^}]*workspaceSwipe: true/);
    assert.match(drafts, /fields: \[[^\]]*"workspaceSwipe"/);
    assert.match(page,
        /SwitchRow \{[\s\S]{0,120}?label: "Swipe between workspaces"[\s\S]{0,200}?checked: page\.draft\.workspaceSwipe[\s\S]{0,120}?onToggled: value => page\.edit\("workspaceSwipe", value\)/);
    assert.equal((page.match(/SwitchRow \{/g) || []).length, 3, "one new switch, no more");
    assert.match(backend, /for key in \('tap', 'naturalScroll', 'workspaceSwipe'\):/);
    assert.match(backend, /'touchpad': \{'tap', 'naturalScroll', 'workspaceSwipe', 'sensitivity'\}/);
    assert.match(loader, /gestures\.remove\("workspace"\)/);
    const row = rows.find(entry => entry.label === "Swipe between workspaces");
    assert.ok(row, "the switch is searchable");
    assert.equal(row.page, "touchpad");
    assert.match(row.terms, /gesture/);
});

test("the rail is Home and three labeled groups of six, and the palette searches them", () => {
    const view = read("Settings/SettingsView.qml");
    const settings = read("Common/Settings.qml");

    // Pages are grouped by task (2026-09): Personalize, Devices, System;
    // the 2026-10 redesign puts Home above them and six pages in each.
    assert.match(settings, /pageGroups: \["Personalize", "Devices", "System"\]/);
    assert.match(view, /model: Settings\.pageGroups/);
    assert.match(view, /NavItem \{\s*id: homeItem\s*modelData: Settings\.pages\[0\]/);
    const entries = [...settings.matchAll(/\{ id: "([a-z]+)", (?:group: "([A-Za-z]+)", )?label: "[^"]+", glyph: /g)]
        .map(m => [m[1], m[2] || ""]);
    assert.deepEqual(entries.map(e => e[0]), ["home", "appearance", "wallpaper", "bar", "workspaces",
        "notifications", "plugins", "displays", "sound", "network", "touchpad", "keyboard", "power",
        "security", "accounts", "assistant", "applications", "region", "backup"]);
    for (const group of ["Personalize", "Devices", "System"])
        assert.equal(entries.filter(e => e[1] === group).length, 6, group);
    const glyphs = [...settings.slice(settings.indexOf("readonly property var pages: ["),
        settings.indexOf("readonly property var pageGroups")).matchAll(/glyph: "([a-z_]+)"/g)].map(m => m[1]);
    assert.equal(new Set(glyphs).size, glyphs.length, "every page has its own glyph");
    // The rail scrolls when the window is shorter than its pages.
    assert.match(view, /Flickable \{\s*id: navFlick[\s\S]{0,300}?interactive: contentHeight > height/);
    // The save state speaks only while saving, briefly after, after a reset
    // and on an error; it lives in the header now, beside the Changes chip.
    assert.doesNotMatch(view, /Saved · applies live/);
    assert.match(view, /visible: root\.statusShown/);
    assert.match(view, /ChangesChip \{/);
    // The rail's dot means a draft waiting for Apply, never "changed from
    // its default": those read as unread badges.
    assert.doesNotMatch(view, /Settings\.sectionDirty\(navItem/);
    assert.match(view, /readonly property bool pending: SettingsChanges\.pages\.indexOf\(modelData\.id\) !== -1/);
    assert.match(view, /case "notifications": return notificationsPage;/);
    assert.doesNotMatch(view, /id: "drawer"|case "drawer"|id: drawerPage/);
    for (const id of ["touchpad", "power", "region", "home"])
        assert.match(view, new RegExp(`case "${id}": return ${id}Page;`));
    // Old ids keep working from IPC and scripts.
    assert.match(settings, /legacyPages: \(\{\s*modules: "bar", widgets: "bar", system: "power", drawer: "bar",\s*shortcuts: "keyboard", storage: "backup", about: "home"/);

    // "/", Ctrl+K and Ctrl+F open the palette; Escape backs out of it before
    // anything else; Alt+Left goes back.
    assert.match(view, /Qt\.Key_Slash/);
    assert.match(view, /event\.key === Qt\.Key_K \|\| event\.key === Qt\.Key_F/);
    assert.match(view, /function handleEscape[\s\S]{0,120}?palette\.hide\(\)/,
        "Escape closes the palette before anything else");
    assert.match(view, /event\.key === Qt\.Key_Left && event\.modifiers & Qt\.AltModifier/);
    assert.match(read("Settings/SettingsPalette.qml"), /SearchData\.search\(q, I18n\.tr\)/);
    assert.match(settings, /property string highlightKey/);

    // The index is hand-maintained; hold it against the schema and the tabs
    // so a renamed key, page or tab cannot leave a row jumping nowhere.
    const schemaKeys = Object.keys(load("SettingsHelpers.js").defaults());
    const tabs = { keyboard: ["layouts", "shortcuts"], backup: ["backups", "recovery", "storage"],
        assistant: ["wiz", "dictation"] };
    const { ROWS, ACTIONS } = load("SettingsSearchData.js");
    assert.ok(ROWS.length >= 30, "the search index must cover the workspace");
    for (const row of ROWS.concat(ACTIONS.filter(entry => entry.page))) {
        assert.ok(entries.some(e => e[0] === row.page),
            `search entry "${row.label}" names unknown page "${row.page}"`);
        if (tabs[row.page])
            assert.ok(tabs[row.page].includes(row.tab), `"${row.label}" names no tab of ${row.page}`);
        else
            assert.ok(!row.tab, `"${row.label}" names a tab on an untabbed page`);
        if (row.key)
            assert.ok(schemaKeys.includes(row.key),
                `search row "${row.label}" names unknown key "${row.key}"`);
    }
});

// The menubar separates one run of modules from the next with a hairline and a
// gap. A settings page says the same thing the same way: nothing in it is a
// filled, bordered container, and the one accent stays a mark rather than
// becoming a field behind a 176px navigation row.
test("dialog chrome carries the menubar's grammar rather than a card stack", () => {
    const group = read("Settings/SettingsGroup.qml");
    const header = read("Settings/SectionHeader.qml");
    const pills = read("Settings/PillRow.qml");
    const view = read("Settings/SettingsView.qml");

    assert.match(group, /^Item \{$/m,
        "a settings group is a layout, not a Rectangle to paint");
    for (const banned of [/\bcolor:\s*Theme\.cardFill/, /\bborder\.color:/, /\bradius:/])
        assert.doesNotMatch(group, banned,
            "the group card is gone; the section header and its rule replace it");

    assert.match(header, /height:\s*Math\.max\(Theme\.sectionHeaderHeight/);
    assert.match(header, /color:\s*Theme\.hairlineSoft/,
        "a section label runs a hairline to the page edge, as T3's inbox groups do");

    assert.match(pills, /: root\.segmented \? Theme\.segmentSelected : Theme\.chipHover/,
        "the taken option is raised out of its track, not an accent tint");
    assert.match(pills, /visible: root\.segmented\s+radius:[^\n]*\n\s+color: Theme\.chip/,
        "settings choices share one track so they read as a single control");
    assert.match(pills, /trackRadius: Theme\.chipRadius \+ inset/);
    assert.match(pills, /radius: root\.segmented \? Theme\.concentricRadius\(root\.trackRadius, root\.inset\) : Theme\.chipRadius/,
        "segments take the bar's chip corner, concentric with their track, rather than a pill");
    // Keyboard focus is the shared ring, not a 1 px accent border or a tint.
    assert.match(pills, /border\.width: ringShown \? Theme\.focusRingWidth/);
    assert.match(pills, /border\.color: ringShown \? Theme\.focusRing : Theme\.hairline/);
    assert.doesNotMatch(pills, /focused: pill\.activeFocus|activeFocus \? Theme\.accentText/);
    assert.doesNotMatch(pills, /Theme\.accentAlpha/,
        "broad selected controls must not paint the accent");

    // The current page is the state system's selected row (2026-11,
    // docs/shell-states.md): a calm accent tint apart from the neutral hover,
    // a 3 px edge and the accent icon, never a saturated accent field.
    assert.doesNotMatch(view, /Theme\.accentBg/,
        "the rail's selection is the calm selectedFill tint, never an accent field");
    assert.match(view, /color:\s*current \? Theme\.selectedFill : "transparent"/);
    assert.match(view, /visible: navItem\.current[\s\S]{0,200}?width: Theme\.selectedEdgeWidth[\s\S]{0,200}?color: Theme\.selectedMark/,
        "the current page carries the 3 px edge");
    assert.match(view, /color: navItem\.current \? Theme\.accentText : Theme\.icon/);
    assert.match(view, /surfaceColor:\s*Theme\.panelSurface/,
        "a dialog sits on the shell's deepest surface, not on a lighter card");
});

test("progressive disclosure hides inactive controls without discarding latent values", () => {
    const appearance = read("Settings/AppearancePage.qml");
    const bar = read("Settings/BarLayoutGroups.qml");
    const reveal = read("Common/Revealer.qml");
    const picker = read("Settings/PickerRow.qml");

    const fixedAt = appearance.indexOf("id: fixedColorReveal");
    const paletteAt = appearance.indexOf("id: paletteContent");
    const sizingAt = appearance.indexOf('title: "Panels"');
    assert.ok(fixedAt > 0 && paletteAt > fixedAt && sizingAt > paletteAt,
        "Fixed must reveal its accent controls immediately below the mode picker");
    const fixed = appearance.slice(fixedAt, paletteAt);
    const barColors = read("Settings/BarBackgroundGroup.qml");
    assert.match(fixed, /reveal:\s*page\.fixedPalette/);
    assert.match(fixed, /\baccent\b/, "the manual accent choice belongs to fixed mode");
    assert.match(appearance,
        /onPicked:\s*value => \{[\s\S]{0,120}?page\.revealFixedColors\(\)/,
        "selecting Fixed must bring the newly revealed accent controls into view");
    assert.match(appearance,
        /id:\s*fixedColorScrollTimer[\s\S]{0,120}?page\.revealFixedColorsNow\(\)/,
        "the scroll must wait for the fixed-color reveal before measuring it");
    // The presets come first and the hue row closes the revealed block, so
    // bringing the hue row's foot into view brings both.
    assert.match(fixed, /id: swatchRepeater[\s\S]*id: accentHueRow/,
        "the accent presets lead the revealed rows and the hue row closes them");
    assert.match(appearance,
        /function revealFixedColorsNow\(\) \{[\s\S]{0,200}?page\.revealFocus\(accentHueRow\)/,
        "Fixed must bring the revealed accent controls into view");
    assert.doesNotMatch(appearance, /Component\.onCompleted:/,
        "opening Appearance must not scroll past typography or override a search jump");
    assert.match(appearance, /label: "Interface font"\s+settingKey: "font"/,
        "the interface font must support the shared settings search and persistence");
    // A dropdown that draws every face in itself, not six pills over two lines.
    assert.match(appearance, /SelectRow \{\s*width: parent\.width\s*label: "Interface font"/);
    assert.match(appearance, /fontFor: value => page\.fontFamily\(value\)/);
    assert.match(appearance, /function fontFamily\(id\)[\s\S]{0,200}?Settings\.fontChoices\.find/);
    // Three size controls stay in view under a live preview; the base size
    // they multiply is an advanced option that a search jump still opens.
    const sizing = appearance.slice(appearance.indexOf('title: "Text & size"'),
        appearance.indexOf('title: "Colors"'));
    assert.match(sizing, /^\s*TextSizePreview \{/m);
    assert.doesNotMatch(sizing, /Text renders at/);
    for (const [label, key] of [["Text size", "textScale"], ["Interface scale", "shellScale"],
            ["Density", "interfaceDensity"], ["Base font size", "shellFontSize"]])
        assert.match(sizing, new RegExp(`label: "${label}"\\s+settingKey: "${key}"`));
    const advanced = sizing.slice(sizing.indexOf("SettingsDisclosure {"));
    assert.match(advanced, /text: "Advanced text options"\s+keys: \["shellFontSize"\]/);
    assert.match(advanced, /settingKey: "shellFontSize"/);
    assert.doesNotMatch(sizing.slice(0, sizing.indexOf("SettingsDisclosure {")), /shellFontSize/,
        "the base size is not also in view above the disclosure");
    const preview = read("Settings/TextSizePreview.qml");
    assert.match(preview, /"Preview · text renders at " \+ Theme\.metrics\.fontBase \+ " px"/);
    assert.match(preview, /SystemClock \{\s*id:\s*clock\s*precision:\s*SystemClock\.Minutes\s*enabled:\s*root\.visible/,
        "the preview clock ticks on the minute and only while shown");
    assert.match(read("Settings/qmldir"), /^TextSizePreview TextSizePreview\.qml$/m);
    assert.ok(appearance.indexOf('title: "Text & size"') < fixedAt,
        "typography must be reachable before the long color controls");
    for (const key of ["barColorMode", "barCustomHue", "barCustomSaturation",
        "barCustomLightness"])
        assert.match(barColors, new RegExp(key),
            `${key} must remain available independently of the accent source`);
    assert.match(barColors,
        /id:\s*customColorReveal[\s\S]*?reveal:\s*Settings\.barColorMode === "custom"/);

    // 2026-09: floating-only geometry appears under Style for Floating
    // instead of sitting there disabled, and its values survive other styles.
    const styleAt = bar.indexOf('settingKey: "barStyle"');
    const floatingAt = bar.indexOf("id: floatingReveal");
    const heightAt = bar.indexOf('label: "Height"');
    assert.ok(styleAt > 0 && floatingAt > styleAt && heightAt > floatingAt,
        "Edge gap and Corner radius are revealed directly under Style");
    const floating = bar.slice(floatingAt, heightAt);
    assert.match(floating, /reveal:\s*page\.floating/);
    assert.match(floating, /settingKey:\s*"gap"/);
    assert.match(floating, /settingKey:\s*"barRadius"/);
    assert.doesNotMatch(bar, /Only applies to the Floating style/);
    assert.match(bar, /settingKey: "barStyle"\s+resetKeys: \["barStyle", "gap", "barRadius"\]/,
        "resetting Style restores the values it hides");
    assert.equal((bar.match(/settingKey:\s*"(?:gap|barRadius)"/g) ?? []).length, 2,
        "floating-only controls must not have a second focusable copy");

    // Height is named presets; Custom reveals the slider and keeps the value.
    const height = bar.slice(heightAt, bar.indexOf("BarBackgroundGroup {"));
    for (const preset of ['value: 30, label: "Compact"', 'value: 34, label: "Classic"',
            'value: Settings.defaults.barHeight, label: "Default"', 'value: 42, label: "Roomy"'])
        assert.ok(bar.includes(preset), preset);
    assert.match(height, /value: "custom", label: "Custom"/);
    // The bar never draws shorter than its controls, so the picker offers
    // only the presets it can actually draw at the current text size.
    assert.match(bar, /drawableFloor: Theme\.chipHeight \+ 8/);
    assert.match(read("Common/Theme.qml"), /barHeight: Math\.max\(Settings\.barHeight, chipHeight \+ 8\)/,
        "the picker's floor must match the bar's own");
    assert.match(height, /model: page\.drawablePresets\.concat/);
    assert.match(height, /current: page\.showCustomHeight \? "custom" : Settings\.barHeight/);
    assert.match(height, /page\.customHeight = true;[\s\S]*?Settings\.set\("barHeight", value\)/,
        "Custom keeps the value; a preset writes it");
    assert.match(bar, /readonly property bool showCustomHeight: customHeight \|\| !heightIsPreset/,
        "a height no preset names shows Custom");
    assert.match(height, /id: customHeightReveal[\s\S]*?reveal: page\.showCustomHeight[\s\S]*?settingKey: "barHeight"\s+min: 28; max: 60/);
    const row = read("Settings/SettingsRow.qml");
    assert.match(row, /enabled: !unavailable/, "a disabled row must not accept input");
    assert.match(row, /text: root\.unavailable \? root\.disabledReason : root\.hint/);
    assert.match(read("Settings/SliderRow.qml"), /dimmed: root\.unavailable/);

    assert.match(reveal, /enabled:\s*root\.reveal/);
    assert.match(reveal, /Accessible\.ignored:\s*!root\.reveal/);
    assert.match(picker, /root\.commit\(value\)/,
        "mode pickers mutate only their own key, preserving hidden companion values");
});

test("bar geometry reset ownership moves from Appearance to Bar", () => {
    const settings = read("Common/Settings.qml");
    const appearance = read("Settings/AppearancePage.qml");
    const bar = read("Settings/BarLayoutGroups.qml");
    const appearanceKeys = settings.match(/appearance:\s*\[([^\]]+)\]/s)?.[1] ?? "";
    const barKeys = settings.match(/bar:\s*\[([^\]]+)\]/s)?.[1] ?? "";

    for (const key of ["barHeight", "barRadius"]) {
        assert.doesNotMatch(appearanceKeys, new RegExp(`"${key}"`));
        assert.match(barKeys, new RegExp(`"${key}"`));
        assert.doesNotMatch(appearance, new RegExp(`settingKey:\\s*"${key}"`));
        assert.match(bar, new RegExp(`settingKey:\\s*"${key}"`));
    }
    for (const key of ["barColorMode", "barCustomHue", "mods", "modOpts"]) {
        assert.doesNotMatch(appearanceKeys, new RegExp(`"${key}"`));
        assert.match(barKeys, new RegExp(`"${key}"`));
    }
    assert.match(settings, /\{ id: "bar", group: "Personalize", label: "Bar & Control Center"/,
        "the reset announcement uses the page's visible name");
    assert.match(settings, /pageInfo\(section\)\.label/);
});

test("notification settings drive the toasts and the notification center", () => {
    const toasts = read("NotificationToasts.qml");
    const notifs = read("Common/Notifs.qml");
    const page = read("Settings/NotificationsPage.qml");

    assert.match(toasts, /Settings\.notifPosition/);
    assert.match(toasts, /Settings\.notifDensity/);
    assert.match(toasts, /Settings\.notifIcons/);
    assert.match(toasts, /Settings\.notifBodyLines/);
    assert.match(toasts, /showProgress:\s*Settings\.notifProgress && !critical/);
    // A plain array model recreates every delegate when one toast expires,
    // resetting the survivors' countdowns; ScriptModel diffs by identity.
    assert.match(toasts, /model:\s*ScriptModel\s*\{\s*values:\s*root\.groupKeys\s*\}/);
    assert.doesNotMatch(toasts, /model:\s*Notifs\.toasts/);
    assert.match(notifs, /readonly property bool dnd:\s*Settings\.notifDnd/);
    assert.match(notifs, /toastsSuppressed:\s*dnd \|\| quietActive/);
    assert.match(notifs, /Settings\.notifDuration \* 1000/);
    assert.match(page, /Send test notification/);
    assert.match(page, /Critical alerts ignore the timer/);
    // The preview heads the Style group as a block in the page's one column
    // (2026-09), not a second column beside the rows.
    const style = page.slice(page.indexOf('title: "Style"'), page.indexOf('title: "On-screen display"'));
    assert.ok(style.indexOf("id: previewBlock") >= 0
        && style.indexOf("id: previewBlock") < style.indexOf('label: "Density"'),
        "the sample toast sits above the style rows");
    assert.doesNotMatch(page, /sideBySide/);
    assert.match(style, /id: sampleToast[\s\S]*id: sendTest/, "Send test sits at the preview's foot");
    // Body preview offers exactly the line counts the store keeps.
    const clamp = read("Common/SettingsHelpers.js")
        .match(/notifBodyLines: intIn\(parsed\.notifBodyLines, (\d+), (\d+), 1,/);
    assert.ok(clamp, "the body-lines clamp moved");
    const body = style.slice(style.indexOf('label: "Body preview"'));
    assert.match(body, /^\s*settingKey: "notifBodyLines"/m);
    const values = [...body.slice(0, body.indexOf("]")).matchAll(/value: (\d+)/g)].map(m => Number(m[1]));
    assert.deepEqual(values, Array.from({ length: Number(clamp[2]) - Number(clamp[1]) + 1 },
        (_, i) => Number(clamp[1]) + i));
    assert.doesNotMatch(body.slice(0, body.indexOf("]")), /SliderRow \{/, "four line counts are choices, not a slider");
    // DND writers must go through the persisted setting, never the singleton.
    for (const name of ["Popovers/Drawer/DrawerNotifications.qml", "Popovers/Drawer/DrawerOverview.qml"])
        assert.doesNotMatch(read(name), /Notifs\.dnd\s*=/,
            `${name} must use Notifs.setDnd`);
});

test("per-module options live under one validated modOpts key", () => {
    const helpers = read("Common/SettingsHelpers.js");
    const settings = read("Common/Settings.qml");

    assert.match(helpers, /function defaultModOpts/);
    assert.match(helpers, /function normalizeModOpts/);
    assert.match(helpers,
        /modOpts:\s*migrateModOpts\(parsed\.modOpts, parsed\.v, parsed\)/);
    assert.match(settings, /"mods", "modOpts"/);
    assert.match(settings, /function setModuleOption/);
    assert.match(settings, /onModOptsChanged:\s*scheduleSave/);
    // The QS_WEATHER_* env vars survive exactly one upgrade as a seed; a file
    // that already carries modOpts must never take them again.
    assert.match(settings, /function seedWeatherFromEnv/);
    assert.match(settings, /parsed\.modOpts !== undefined/);
    assert.doesNotMatch(read("Common/Weather.qml"), /Quickshell\.env\("QS_WEATHER/,
        "Weather must read its location from Settings, not the environment");
});

test("the settings store keeps its fixed user-owned config path", () => {
    const settings = read("Common/Settings.qml");
    assert.match(settings,
        /Quickshell\.env\("HOME"\) \+ "\/\.config\/cybexos\/shell\.json"/);
    assert.match(settings, /path:\s*root\.filePath/);
    assert.doesNotMatch(settings, /:\s*Quickshell\.statePath\(/,
        "Settings must not use statePath — it forks per config directory");
});

test("an unreadable settings file is preserved before anything saves over it", () => {
    // Regression guard for silent data loss: parse() used to answer null for
    // both "no file yet" and "file we could not read", so applyLoaded treated
    // damage as a first run and the next debounced save replaced the user's
    // only copy with defaults.
    const settings = read("Common/Settings.qml");

    assert.match(settings, /firstRun = result\.status === "empty"/,
        "only an absent file counts as a first run");

    // The backup has to be triggered ahead of applyLoaded's no-op early
    // return, or a corrupt file that merges to the running state slips past.
    const applyLoaded = settings.slice(settings.indexOf("function applyLoaded"));
    const backupAt = applyLoaded.indexOf("backUpCorruptFile()");
    const earlyReturnAt = applyLoaded.indexOf("serialize(snapshot())");
    assert.ok(backupAt > 0, "applyLoaded must back up a corrupt file");
    assert.ok(backupAt < earlyReturnAt,
        "the backup must happen before the unchanged-settings early return");

    assert.match(settings, /"mv", filePath, corruptBackupProc\.backupPath/,
        "the original bytes are moved aside, not rewritten");
    assert.match(settings, /\.corrupt-" \+ Math\.floor\(Date\.now\(\) \/ 1000\)/);

    // Both save paths stay shut until the move has succeeded, and the failure
    // branch must not clear the guard.
    assert.match(settings,
        /function saveNow\(\) \{\s*\n\s*if \(!ready \|\| migrationPending \|\| corruptBackupPending \|\| loadError/);
    assert.match(settings,
        /function scheduleSave\(\) \{[\s\S]{0,300}?if \(!ready \|\| migrationPending \|\| corruptBackupPending \|\| loadError\)/);
    const onExited = settings.slice(settings.indexOf("id: corruptBackupProc"));
    const clears = onExited.slice(0, onExited.indexOf("console.warn"))
        .match(/corruptBackupPending = false/g) ?? [];
    assert.equal(clears.length, 1,
        "corruptBackupPending clears only on a successful move");

    assert.match(settings, /root\.announcement = I18n\.format\("The settings file could not be read\. It was kept as %1/,
        "the user is told the file was kept rather than lost");
});

test("FileView failures cannot become empty settings or false save success", () => {
    const settings = read("Common/Settings.qml");

    assert.match(settings,
        /if \(error === FileViewError\.FileNotFound\) \{[\s\S]*?applyLoaded\(""\);[\s\S]*?return;/,
        "only a confirmed missing file may initialize first-run defaults");
    assert.match(settings,
        /function handleLoadFailure\(error\)[\s\S]*?ready = false;[\s\S]*?loadError = true;/,
        "other read errors must retain memory state and disable writes");
    assert.doesNotMatch(settings, /onLoadFailed:\s*root\.applyLoaded\(""\)/);
    assert.match(settings, /root\.handleSaveSucceeded\(result\.text\)/);
    assert.match(settings, /root\.handleSaveFailure\(FileViewError\.Unknown\)/);
    assert.match(settings, /CommandRequest \{\s*id: settingsWriter/);
});

test("settings use the verified atomic writer and production document queue", () => {
    const source = read("Common/Settings.qml");
    assert.match(source, /if \(!document\.begin\(\)\)/);
    assert.match(source, /candidate: writeSnapshot, version: SettingsHelpers\.VERSION/);
    assert.match(source, /sameContent\(next, lastPersistedText\)/);
    assert.doesNotMatch(source, /store\.setText/);
    // Real QML asynchronous transitions are exercised in tst_settings_document,
    // and settings-ownership.py exercises the actual atomic filesystem writer.
});
