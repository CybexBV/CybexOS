// Settings under the 2026-11 state system (docs/shell-states.md,
// docs/settings.md): where you are, where the keyboard is, what is on, and
// what to do next each have one look, and a narrow window reflows rather than
// elides. These guard the outcomes the real-engine captures were checked for.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, untranslated } = require("./shell.cjs");

function read(relative) {
    return untranslated(fs.readFileSync(path.join(shellDir, relative), "utf8"));
}

test("the shared switch draws off, on, focus and disabled apart", () => {
    const toggle = read("Common/Toggle.qml");
    assert.match(toggle, /color: root\.checked \? \(root\.enabled \? Theme\.accent : Theme\.textDisabled\)\s+: Theme\.switchOffTrack/);
    assert.match(toggle, /border\.width: root\.checked \? 0 : 1\s+border\.color: root\.enabled \? Theme\.switchOffBorder : Theme\.textDisabled/,
        "an off track carries its own 1 px boundary");
    assert.match(toggle, /color: root\.checked \? \(root\.enabled \? Theme\.accentFg : Theme\.background\)\s+: root\.enabled \? Theme\.switchOffKnob : Theme\.textDisabled/);
    assert.doesNotMatch(toggle, /Qt\.rgba\(1, 1, 1, 0\.12\)/, "the off track comes from the pack's tokens");
    // Focus is a ring of its own, never the track's border or a tint on it.
    assert.match(toggle, /border\.width: Theme\.focusWidth\(root\.activeFocus\)\s+border\.color: Theme\.focusRing/);
    assert.doesNotMatch(toggle, /focused: root\.activeFocus/);
    // A disabled switch is dimmed in the readable disabled ink (about 3:1,
    // state-tokens.test.cjs), not faded: a 45 % fade took its boundary below
    // 2:1 (2026-11 review).
    assert.doesNotMatch(toggle, /opacity:/);
    // Its rows no longer fade it a second time.
    assert.doesNotMatch(read("Settings/SwitchRow.qml"), /opacity:/);
    assert.doesNotMatch(read("Settings/PluginRow.qml"), /opacity: enabled \? 1 : 0\.45/);
    // A row inside a disabled group fades its control too; the reason stays.
    assert.match(read("Settings/SettingsRow.qml"), /controlOpacity: enabled \? 1 : 0\.45/);
});

test("every shared switch is at least 24 px tall with a 32 px target", () => {
    // Claude Fable, 2026-11 review: "switches are about 32×18".
    const theme = read("Common/Theme.qml");
    const metrics = {};
    for (const name of ["switchPopover", "switchRow", "switchCompact"]) {
        const block = theme.match(new RegExp(`readonly property var ${name}: \\(\\{([\\s\\S]*?)\\}\\)`))[1];
        const track = block.match(/track: Qt\.size\((\d+), (\d+)\)/);
        metrics[name] = { width: Number(track[1]), height: Number(track[2]) };
        const box = block.match(/box: Qt\.size\((\d+),/);
        assert.ok(Number(box[1]) >= metrics[name].width + 6, `${name}: the box holds the track and its ring`);
    }
    for (const [name, track] of Object.entries(metrics)) {
        assert.ok(track.height >= 24, `${name} track is ${track.height} px tall`);
        const ratio = track.width / track.height;
        assert.ok(ratio >= 1.6 && ratio <= 1.8, `${name} keeps the switch proportions (${ratio.toFixed(2)})`);
    }
    assert.match(theme, /readonly property int switchHitMin: 32/);
    const toggle = read("Common/Toggle.qml");
    assert.match(toggle, /width: Math\.max\(root\.width, root\.ringWidth, Theme\.switchHitMin\)/);
    assert.match(toggle, /height: Math\.max\(root\.height, root\.ringHeight, Theme\.switchHitMin\)/);
    // The plugin kit's switch follows the same floor.
    const kit = read("Ui/ToggleSwitch.qml");
    assert.match(kit, /property int trackHeight: Math\.max\(24,/);
    assert.match(kit, /width: Math\.max\(parent\.width, 32\)\s+height: Math\.max\(parent\.height, 32\)/);
});

test("settings actions come in three tiers with a 32 px target", () => {
    const action = read("Settings/SettingsAction.qml");
    assert.match(action, /property bool secondary: false/);
    assert.match(action, /readonly property bool accentFill: primary && enabled/);
    assert.match(action, /readonly property bool chipFill: secondary \|\| \(primary && !enabled\)/);
    assert.match(action, /color: accentFill \? Theme\.accent : chipFill \? Theme\.chip : "transparent"/);
    assert.match(action, /border\.width: ringShown \? Theme\.focusRingWidth : chipFill \? 1 : 0/);
    assert.match(action, /border\.color: ringShown \? \(accentFill \? Theme\.textHi : Theme\.focusRing\) : Theme\.hairline/);
    // Disabled reads as unavailable but stays readable: the textDisabled
    // token (about 3:1), never a fade of the accent fill.
    assert.match(action, /readonly property color ink: !enabled \? Theme\.textDisabled/);
    assert.doesNotMatch(action, /opacity: enabled \? 1 : 0\.4/);
    assert.match(action, /hitInsetY: Math\.min\(0, \(height - Theme\.inlineActionHeight\) \/ 2\)/);
    assert.match(action, /anchors\.topMargin: root\.hitInsetY/);
});

test("the rail shows the current page, the keyboard and the icon rail's names apart", () => {
    const view = read("Settings/SettingsView.qml");
    assert.match(view, /component NavItem: Rectangle \{[\s\S]*?color: current \? Theme\.selectedFill : "transparent"/);
    assert.doesNotMatch(view.slice(view.indexOf("component NavItem"), view.indexOf("component NavGroup")),
        /focused: navItem\.activeFocus/, "keyboard focus on the rail is the ring alone");
    // Names beside the icon rail answer to the keyboard as well as the pointer.
    assert.match(view, /visible: root\.compactNav && \(navMouse\.containsMouse\s*\|\| Theme\.focusWidth\(navItem\.activeFocus\) > 0\)/);
    assert.match(view, /text: "Search settings \(\/\)"/);
    // Focus follows a selection that changed from elsewhere.
    assert.match(view, /function onPageChanged\(\) \{[\s\S]{0,400}?as NavItem;[\s\S]{0,200}?Theme\.focusVisible[\s\S]{0,200}?item\.forceActiveFocus\(\)/);
});

test("Home reflows and keeps its formats, tiers and static memory", () => {
    const home = read("Settings/HomePage.qml");
    assert.match(read("Settings/SettingsPage.qml"),
        /compactWidth: Theme\.scaled\(560, Theme\.typeScale\)\s+readonly property bool compact: columnWidth < compactWidth/);
    // Four across, or two by two; values wrap and never elide.
    assert.match(home, /readonly property int columns: page\.compact \? 2 : 4/);
    const cell = home.slice(home.indexOf("component GlanceCell"), home.indexOf("    Column {\n        anchors.left"));
    assert.doesNotMatch(cell, /elide:/);
    assert.equal((cell.match(/wrapMode: Text\.Wrap/g) || []).length, 3);
    // Storage decimal, memory in whole GiB, one percent format.
    assert.match(home, /"%1 free", \[SysInfoHelpers\.formatStorageBytes\(SysInfo\.rootFsAvailableBytes\)\]/);
    assert.match(home, /SysInfoHelpers\.formatIecBytes\(Math\.round\(SysInfo\.memTotalBytes \/ 1073741824\) \* 1073741824\)/);
    assert.doesNotMatch(home, /BackupHelpers\.formatBytes|" GB"|" %"/);
    // Memory has no page: no button semantics.
    assert.match(home, /interactive: Battery\.isLaptop/);
    assert.match(cell, /activeFocusOnTab: interactive\s+Accessible\.role: interactive \? Accessible\.Button : Accessible\.StaticText/);
    // The hero's state stacks under the identity in a narrow column.
    assert.match(home, /height: page\.compact \? identityHeight \+ Theme\.scaled\(12\) \+ heroSide\.height/);
    assert.match(home, /StatusPill \{\s+id: updatePill/);
    assert.match(home, /id: updateAction[\s\S]{0,400}?secondary: true/);
    // One primary in Needs attention: the most urgent item whose action is
    // needed. A suggestion never leads (2026-11-24 review).
    assert.match(home, /leadAttention: attention\.findIndex\(item => item\.action !== "" && item\.needed\)/);
    assert.match(home, /needed: check\.state === "problem"/);
    assert.match(home, /primary: attentionRow\.index === page\.leadAttention\s+secondary: !primary/);
    for (const status of ["Restart needed", "Ready", "In progress", "Not set up"])
        assert.ok(home.includes(`status: "${status}"`), status);
    // At most one pill a row, coloured only when something is asked of the
    // person: waiting changes say so in their title, and suggestions, work
    // in progress and the check's verdict stay neutral.
    assert.match(home, /id: "changes", tone: "neutral", status: ""/);
    assert.match(home, /id: "preparing", tone: "neutral"/);
    // A finding keeps Welcome Ready's colours: red problem, amber suggestion.
    assert.match(home, /tone: check\.state === "problem" \? "red" : "amber"/);
    assert.doesNotMatch(home, /"Not applied"/);
    assert.doesNotMatch(home, /: "ok"/);
    assert.match(home, /"Updates not checked yet"/);
    assert.equal((home.match(/primary: true/g) || []).length, 0);
});

test("waiting changes have one status, one Apply and headings that say what Apply does", () => {
    const view = read("Settings/SettingsView.qml");
    // No unqualified "Saved" beside "1 change waiting".
    assert.match(view, /\|\| \(\(Settings\.savePending \|\| justSaved\) && !changesChip\.pending\)/);
    assert.match(view, /ChangesChip \{\s+id: changesChip/);
    // One Review at a time: Home lists the waiting changes with their own
    // Review, so the chip steps back there; elsewhere its action is a
    // secondary beside the page's one primary (2026-11-24 review).
    assert.match(view, /hidden: Settings\.page === "home"/);
    const chip = read("Settings/ChangesChip.qml");
    assert.match(chip, /readonly property bool shown: pending && !hidden/);
    assert.doesNotMatch(chip, /color: Theme\.accent\n/);
    assert.doesNotMatch(chip, /Theme\.textOnAccent/);
    const sheet = read("Settings/ChangesSheet.qml");
    assert.doesNotMatch(sheet, /title: "Applies now"/);
    assert.match(sheet, /title: "Takes effect when you apply"/);
    assert.match(sheet, /title: "Takes effect after a restart"\s+\/\/[^\n]*\n\s+changeTag: "admin"/);
    // The scrim spans the whole window, rail included.
    assert.match(view, /ChangesSheet \{\s+id: changesSheet\s+objectName: "changesSheet"\s+anchors\.fill: parent/);
    assert.match(sheet, /Rectangle \{\s+anchors\.fill: parent\s+color: Theme\.scrim/);
    // The page's Apply bar steps back under the sheet; a trial stays.
    assert.match(sheet, /onOpenChanged: SettingsChanges\.reviewOpen = open/);
    assert.match(read("Settings/SettingsChanges.qml"), /property bool reviewOpen: false/);
    assert.match(read("Settings/ApplyBar.qml"), /visible: shown && \(trial \|\| !SettingsChanges\.reviewOpen\)/);
    // The rail's tip and name say what its dot means, in the chip's words.
    assert.match(view, /I18n\.format\("%1: changes waiting", \[navItem\.modelData\.label\]\)|"%1: changes waiting"/);
    assert.match(view, /Accessible\.name: navItem\.spokenName[\s\S]{0,800}?text: navItem\.spokenName/);
});

test("theme and pointer cards mark the choice apart from keyboard focus", () => {
    for (const rel of ["Settings/ThemeGallery.qml", "Settings/PointerGallery.qml"]) {
        const gallery = read(rel);
        assert.match(gallery, /border\.width: tile\.selected \? Theme\.selectedBorderWidth : 1\s+border\.color: tile\.selected \? Theme\.textHi : Theme\.hairline/, rel);
        assert.match(gallery, /anchors\.margins: -root\.edge[\s\S]{0,200}?border\.width: Theme\.focusWidth\(tile\.activeFocus\)\s+border\.color: Theme\.focusRing/, rel);
        // The check is haloed in the window surface.
        assert.match(gallery, /color: Theme\.accent\s+border\.width: 2\s+border\.color: Theme\.panelSurface/, rel);
        assert.doesNotMatch(gallery, /Theme\.accentText : Theme\.hairline/, rel);
    }
    const themes = read("Settings/ThemeGallery.qml");
    assert.match(themes, /thumbHeight: root\.compact \? Theme\.scaled\(72\)/);
    assert.match(themes, /property bool compact: width < Theme\.scaled\(560, Theme\.typeScale\)/);
});

// 2026-11-24 council review: one way back, one primary, one name per thing,
// and focus rings that are the shared ring with concentric corners.
test("Back shows only when the trail has a page to return to", () => {
    const view = read("Settings/SettingsView.qml");
    assert.match(view, /id: backAction[\s\S]{0,200}?visible: root\.canGoBack/);
    assert.doesNotMatch(view, /enabled: root\.canGoBack/, "a dimmed arrow on the first page went nowhere");
    // The title keeps the arrow's slot, so it never jumps when Back hides.
    assert.match(view, /anchors\.left: backAction\.right\s*anchors\.leftMargin: Theme\.scaled\(6\)/);
    // A keyboard Back to the first page hands focus to the rail.
    assert.match(view, /if \(fromBack && !root\.canGoBack\)/);
});

test("Settings tiles mark the choice with the selected tile and focus with the shared ring", () => {
    const icons = read("Settings/ControlIconGroup.qml");
    assert.match(icons, /color: tile\.selected \? Theme\.selectedFill : Theme\.cardFill/);
    assert.match(icons, /border\.color: tile\.selected \? Theme\.selectedMark : Theme\.hairline/);
    assert.match(icons, /radius: Theme\.concentricRadius\(root\.tileRadius, root\.ringInset\)/);
    assert.match(icons, /radius: Theme\.concentricRadius\(cell\.radius, anchors\.margins\)/);
    assert.equal((icons.match(/border\.width: Theme\.focusWidth\((tile|cell)\.activeFocus\)\s+border\.color: Theme\.focusRing/g) || []).length, 2);
    assert.doesNotMatch(icons, /activeFocus \? (Theme\.accentText|1)|focused: (tile|cell)\.activeFocus/);
    // The prompt preview draws the mark without a tint effect.
    assert.match(icons, /Qt\.fontFamilies\(\)\.indexOf\("Cybex OS Symbols"\)/);
    assert.doesNotMatch(icons, /colorized: true/);
    const grid = read("Settings/WallpaperGrid.qml");
    assert.doesNotMatch(grid, /border\.width: cell\.chosen \|\| cell\.activeFocus/);
    assert.match(grid, /visible: cell\.chosen\s+border\.width: Theme\.selectedBorderWidth\s+border\.color: Theme\.selectedMark/);
    assert.match(grid, /radius: Theme\.concentricRadius\(tile\.radius, inset\)[\s\S]{0,160}?border\.width: Theme\.focusWidth\(cell\.activeFocus\)\s+border\.color: Theme\.focusRing/);
    // The check marks the wallpaper in use; the preview's button rests on it.
    assert.match(grid, /readonly property bool inUse: \(modelData\.fileName \|\| ""\) !== "" && modelData\.fileName === Settings\.wall/);
    assert.match(grid, /visible: cell\.inUse/);
    const preview = read("Settings/WallpaperPreviewPanel.qml");
    assert.match(preview, /readonly property bool applied: item !== null && \(item\.fileName \|\| ""\) !== ""\s+&& Settings\.wall === item\.fileName/);
    assert.match(preview, /root\.applied \? "In use"/);
    assert.match(preview, /enabled: root\.item !== null && !root\.busy && !root\.applied/);
    // Tags wrap to two whole lines; the metadata fades at the button's edge.
    assert.match(preview, /maximumLineCount: 2/);
    assert.match(preview, /ScrollChrome \{\s+anchors\.fill: scroll\s+target: scroll/);
});

test("technical detail waits behind Details and missing features say how to add them", () => {
    const hint = read("Settings/SettingsHint.qml");
    assert.match(hint, /onDetailChanged: detailOpen = false/);
    assert.match(hint, /id: detailToggle[\s\S]{0,900}?Accessible\.name: root\.detailOpen \? "Hide details" : "Show details"/);
    assert.match(hint, /visible: root\.detail !== "" && root\.detailOpen/);
    const appearance = read("Settings/AppearancePage.qml");
    assert.match(appearance, /"Couldn't download %1\. Check your connection and try again\."/);
    assert.match(appearance, /return page\.pointerFailureText;/);
    assert.match(appearance, /hintDetail: Pointer\.downloading === "" && Pointer\.failure !== "" \? Pointer\.failureDetail : ""/);
    const dictation = read("Settings/DictationPage.qml");
    assert.match(dictation, /StatusPlaceholder \{\s+shown: !Dictation\.available/);
    assert.match(dictation, /visible: !Dictation\.available && Dictation\.cpuSupported/);
    assert.match(dictation, /label: "cybex update stage local" \/\/ i18n: untranslated/);
    assert.match(dictation, /in \/etc\/nixos\/machine\.nix, set features\.developer to true, run the command below/);
    assert.doesNotMatch(dictation, /which this installation does not have/);
});
