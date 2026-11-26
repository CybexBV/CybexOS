const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../desktop/quickshell');
const read = name => untranslated(fs.readFileSync(path.join(root, name), 'utf8'));

test('settings subsections own separation inside revealers and preserve the row grid', () => {
    const subsection = read('Settings/SettingsSubsection.qml');
    assert.match(subsection, /implicitHeight: Theme.settingsSubsectionSpacing/);
    assert.match(subsection, /heading.height[\s\S]*Theme.settingsContentSpacing/);
    assert.match(subsection, /root.insetContent \? Theme.settingsMarkInset : 0/);
    const appearance = read('Settings/AppearancePage.qml');
    // Accent source reveals rows attached to it (2026-09), not headed
    // subsections: the fixed presets and hue, or the wallpaper palette.
    assert.doesNotMatch(appearance, /SettingsSubsection \{/);
    assert.doesNotMatch(appearance, /SectionHeader \{/);
    for (const reveal of ['fixedColorReveal', 'wallpaperPaletteReveal'])
        assert.match(appearance, new RegExp(`id: ${reveal}[\\s\\S]{0,400}?SettingsRow \\{`),
            `${reveal} holds rows in the page's grid`);
    for (const page of ['AppearancePage', 'BarLayoutGroups', 'DrawerPage', 'NotificationsPage',
            'PowerPage', 'RegionPage', 'TouchpadPage', 'ModulesPage', 'PluginsPage'])
        assert.match(read(`Settings/${page}.qml`), /spacing: Theme.settingsGroupSpacing/);
});

test('responsive controls and focus scrolling respect their content bounds', () => {
    const picker = read('Settings/PickerRow.qml');
    assert.match(picker, /wideHeight: Math.max\(Theme.panelRowHeight, pills.implicitHeight\) \+ rowPad \* 2/);
    // Every control ends on the page's right-hand edge and tells the row
    // where it begins, so labels take the room to its left (2026-09).
    for (const row of ['PickerRow', 'SliderRow', 'SettingsTextRow', 'TimeRow', 'CornerPickerRow',
            'SwitchRow', 'SelectRow'])
        assert.match(read(`Settings/${row}.qml`), /controlLeft:/, `${row} reports its control's left edge`);
    for (const row of ['PickerRow', 'TimeRow', 'CornerPickerRow', 'SelectRow'])
        assert.match(read(`Settings/${row}.qml`), /root\.narrow \? root\.markInset : root\.contentRight - width/);
    assert.match(read('Settings/SliderRow.qml'), /Math\.min\(root\.trackWidth,/,
        'a slider keeps a bounded track instead of stretching across the page');
    // A switch keeps its own line beside the label; its description is the
    // shared hint line underneath, which wraps instead of eliding.
    assert.match(read('Settings/SwitchRow.qml'), /hint: description/);
    assert.match(read('Settings/SettingsRow.qml'),
        /height: lineHeight \+ \(hintLine\.visible \? hintLine\.height/);
    assert.match(read('Settings/ResponsiveActionRow.qml'), /Flow \{/);
    assert.match(read('Settings/SettingsPage.qml'), /while \(ancestor && ancestor !== contentRoot/);
    assert.match(read('Settings/SettingsRow.qml'), /Accessible.name: "Reset " \+ root.resetLabel/);
});

test('notification actions wrap and image captions retain independent contrast', () => {
    assert.match(read('Common/NotifActions.qml'), /Flow \{\s*width: root.width/);
    const wallpaper = read('Settings/WallpaperGrid.qml');
    const caption = wallpaper.slice(wallpaper.indexOf('id: badge'), wallpaper.indexOf('visible: cell.chosen'));
    assert.match(caption, /color: "#ffffff"/);
    assert.match(read('ShortcutsOverlay.qml'), /contentHeight: body.implicitHeight/);
    const shortcuts = read('ShortcutsOverlay.qml');
    assert.match(shortcuts, /width: Math\.min\(Theme\.scaled\(1180\), root\.width - 96\)/,
        'the shortcut sheet uses the width of a wide screen');
    assert.match(shortcuts,
        /count: Math\.max\(1, Math\.min\(3,\s*Math\.floor\(\(width \+ spacing\) \/ \(minimumColumnWidth \+ spacing\)\)\)\)/,
        'columns follow the available width, one to three');
    assert.match(shortcuts, /width: shortcut\.stacked \? parent\.width\s*: Math\.min\(parent\.width, naturalWidth\)/,
        'stacked keys wrap inside the column instead of overflowing its left edge');
});

test('shortcut rows size from their column, not a parent that closing unsets', () => {
    // Closing the sheet clears the group model; each row is unparented
    // before its bindings are torn down, so `parent.width` threw once per row.
    const sheet = read('ShortcutsOverlay.qml');
    const row = sheet.slice(sheet.indexOf('id: shortcut\n'), sheet.indexOf('id: label'));
    assert.match(row, /width: rows\.width/);
    assert.doesNotMatch(row, /width: parent\.width/);
});

test('accent ink remains readable without changing the chosen fill', () => {
    const helpers = require('./shell.cjs').load('SettingsHelpers.js');
    for (const background of ['#201e1b', '#eeedf3', '#f7f5fb']) {
        for (const accent of ['#d1d581', '#9ecbeb', '#a992e0', '#79b88b', '#d3b47e', '#e8837a']) {
            const ink = helpers.ensureContrast(accent, background, 4.5);
            assert.ok(helpers.contrastRatio(ink, background) >= 4.5,
                `${accent} ink on ${background}`);
        }
    }
    assert.match(read('Common/Theme.qml'), /accentText: SettingsHelpers.ensureContrast\(\s*accent.toString\(\), copyReferenceBg.toString\(\), 4.5\)/);
    assert.match(read('Common/Theme.qml'), /accent: paletteActive \? Common.Palette.primary\s*: Settings.effectiveAccent/);
    assert.match(read('Settings/SettingsHint.qml'), /tone === "active" \? Theme\.accentText/);
});

test('native forms share field chrome and drawer tabs expose keyboard selection', () => {
    assert.match(read('Settings/SettingsTextRow.qml'), /SettingsField \{/);
    // Plugin install and clone fields are FieldRows: the shared field chrome
    // on a labeled row, ending with their action on the control edge.
    assert.match(read('Settings/FieldRow.qml'), /SettingsField \{/);
    assert.match(read('Settings/PluginsPage.qml'), /FieldRow \{/);
    assert.match(read('Settings/PluginRow.qml'), /FieldRow \{/);
    for (const file of ['PluginsPage', 'PluginRow', 'FieldRow'])
        assert.doesNotMatch(read(`Settings/${file}.qml`), /Controls.TextField/);
    const tabs = read('Popovers/Drawer/DrawerTabs.qml');
    assert.match(tabs, /activeFocusOnTab: on/);
    assert.match(tabs, /Accessible.selected: on/);
    for (const key of ['Left', 'Right', 'Home', 'End'])
        assert.match(tabs, new RegExp(`Qt.Key_${key}`));
    // Every tab keeps its label; the strip wraps rather than hiding one.
    assert.match(tabs, /layout: DrawerFormat.tabLayout\(/);
});

test('bar preview workspace pips survive losing their strip during teardown', () => {
    // Changing the layout destroys a preview widget with its pip strip; a pip
    // whose binding runs after the strip is gone must not read a null parent.
    const preview = read('Settings/BarPreview.qml');
    const start = preview.indexOf('id: pip');
    const pip = preview.slice(start, preview.indexOf('Text {', start));
    assert.ok(start > 0 && pip.length > 0);
    assert.match(pip, /anchors\.verticalCenter: parent \? parent\.verticalCenter : undefined/);
    assert.doesNotMatch(pip, /:\s*parent\.\w+\s*$/m, 'a repeated delegate guards its parent');
});
const { untranslated } = require("./shell.cjs");
