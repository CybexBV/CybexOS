const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

function read(relative) {
    return untranslated(fs.readFileSync(path.join(shellDir, relative), "utf8"));
}

function qmlFiles(directory) {
    const out = [];
    const walk = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory())
                walk(full);
            else if (entry.name.endsWith(".qml"))
                out.push(full);
        }
    };
    walk(path.join(shellDir, directory));
    return out;
}

test("glass switches every shell surface through semantic fills", () => {
    const theme = read("Common/Theme.qml");
    assert.match(theme,
        /readonly property bool glassActive:\s*Settings\.glassEnabled && !Settings\.highContrast/);
    assert.match(theme,
        /readonly property color barSurface:\s*glassActive \? glass : barBg/);
    assert.match(theme,
        /readonly property color surfaceStrong:\s*glassActive \? glassStrong : popBg/);
    assert.match(theme,
        /readonly property color surfaceMenu:\s*glassActive \? glassMenu : menuBg/);

    assert.match(theme,
        /readonly property color panelSurface:\s*glassActive \? glassPanel : background/);

    // Every surface that hangs off the bar is a panel now and shares one fill.
    // A menu floating *above* a panel still needs to stay legible over it, so
    // the tooltip and the folder picker keep the denser variant.
    const expected = {
        "Bar/Bar.qml": "barSurface",
        "Bar/PopoutHost.qml": "barSurface",
        "Bar/BarTooltip.qml": "surfaceMenu",
        "LauncherWindow.qml": "panelSurface",
        "NotificationToasts.qml": "panelSurface",
        "OsdWindow.qml": "panelSurface",
        "ShortcutsOverlay.qml": "panelSurface",
        "DockWindow.qml": "panelSurface",
        "OverviewView.qml": "panelSurface",
        "Popovers/PopoutPanel.qml": "barSurface",
        "Settings/FolderDialog.qml": "surfaceMenu"
    };
    for (const [file, token] of Object.entries(expected))
        assert.match(read(file), new RegExp(`Theme\\.${token}\\b`),
            `${file} does not follow the glass setting`);

    assert.match(read("Popovers/Surface.qml"), /color:\s*root\.surfaceColor\b/,
        "shared surfaces must honor the panel-specific surface contract");
    assert.match(read("Bar/PopoutHost.qml"),
        /host\.activePanel \? host\.activePanel\.surfaceColor : Theme\.barSurface/,
        "the host must preserve global glass as the default while allowing product canvases");

    for (const file of qmlFiles(".")) {
        if (file === path.join(shellDir, "Common", "Theme.qml"))
            continue;
        assert.doesNotMatch(untranslated(fs.readFileSync(file, "utf8")), /Theme\.glass(?:Strong|Menu)?\b/,
            `${path.relative(shellDir, file)} bypasses the semantic glass tokens`);
    }
});

test("menubar content uses its colour-derived palette", () => {
    const exempt = new Set(["BarTooltip.qml", "PopoutHost.qml"]);
    const globalPalette = /Theme\.(?:glass|chip|chipHover|wsOccupied|dotDim|stroke|icon|textHi|textMid|textLow|textDim|textFaint|accent|accentFg|accentGlow|red|redText|redBg|amber|amberBg|wxSun|wxMoon|wxCloud|wxFog|wxRain|wxSnow|wxStorm)\b/;

    for (const file of qmlFiles("Bar")) {
        if (exempt.has(path.basename(file)))
            continue;
        assert.doesNotMatch(untranslated(fs.readFileSync(file, "utf8")), globalPalette,
            `${path.relative(shellDir, file)} bypasses the automatic menubar palette`);
    }

    const theme = read("Common/Theme.qml");
    assert.match(theme,
        /readonly property color barBg:\s*Settings\.effectiveBarColor/,
        "wallpaper accents must not replace the selected menubar background");
    assert.match(theme,
        /readonly property var barPalette:\s*SettingsHelpers\.barPalette\(barBg\.toString\(\)\)/);
    assert.match(theme, /readonly property color barAccent:\s*SettingsHelpers\.ensureContrast/);
    assert.match(read("Common/Weather.qml"), /function barGlyphColor/);
    assert.match(read("Bar/Modules/Weather.qml"), /Weather\.barGlyphColor/);
});

test("the named Hyprland blur rule persists and applies without remapping surfaces", () => {
    const look = untranslated(fs.readFileSync(
        path.resolve(shellDir, "../hypr/looknfeel.lua"), "utf8"));
    const settings = read("Common/Settings.qml");

    assert.match(look, /local function persisted_glass_enabled\(\)/);
    assert.match(look, /return enabled\("glassEnabled"\) and not enabled\("highContrast"\)/);
    assert.match(look,
        /quickshell_blur_rule = hl\.layer_rule\(\{[\s\S]*?enabled = persisted_glass_enabled\(\)/);
    assert.match(look,
        /namespace = \[\[\^qs-\(bar\|bar-popout\|launcher\|notifications\|osd\|shortcuts\|dock\)\$\]\]/);
    assert.match(settings,
        /"hyprctl", "eval",[\s\S]{0,120}?"quickshell_blur_rule:set_enabled\("/);
    assert.match(settings, /exitSeen \? lastExit : ProcHelpers\.NOT_STARTED/,
        "a missing hyprctl binary must surface as an apply error");
    assert.match(settings,
        /if \(root\.dispatchedGlassEnabled !== \(root\.glassEnabled && !root\.highContrast\)\)\s*glassReplayTimer\.restart\(\)/,
        "a second toggle while hyprctl is busy must be replayed");

    for (const file of ["Bar/Bar.qml", "Bar/BarPopoutWindow.qml", "LauncherWindow.qml",
        "NotificationToasts.qml", "OsdWindow.qml", "ShortcutsOverlay.qml",
        "DockWindow.qml", "OverviewWindow.qml"])
        assert.doesNotMatch(read(file), /WlrLayershell\.namespace:\s*Settings\./,
            `${file} must keep a stable namespace when glass changes`);
});

// Runs looknfeel.lua under luajit with a minimal `hl` double against a stored
// shell.json and returns whether the blur rule starts enabled.
const luajit = ["/usr/bin/luajit", "/usr/local/bin/luajit"].find(file => fs.existsSync(file))
    || (require("node:child_process").spawnSync("sh", ["-c", "command -v luajit"], { encoding: "utf8" })
        .stdout || "").trim();

function persistedBlur(t, settings) {
    const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cybexos-tests.glass."));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const template = untranslated(fs.readFileSync(
        path.resolve(shellDir, "../hypr/looknfeel.lua"), "utf8"));
    fs.writeFileSync(path.join(root, "looknfeel.lua"), template.replace(/\{\{.*?\}\}/g, "false"));
    if (settings !== undefined) {
        fs.mkdirSync(path.join(root, ".config/cybexos"), { recursive: true });
        fs.writeFileSync(path.join(root, ".config/cybexos/shell.json"), settings);
    }
    const driver = `
local rules = {}
local noop = function() end
hl = { config = noop, curve = noop, animation = noop, window_rule = noop,
  get_config = function() return nil end, get_monitors = function() return {} end,
  on = function() return { remove = noop } end,
  workspace_rule = function() return { set_enabled = noop } end,
  layer_rule = function(spec) rules[spec.name] = spec.enabled
    return { set_enabled = noop } end }
dofile(${JSON.stringify(path.join(root, "looknfeel.lua"))})
io.write(tostring(rules["quickshell-blur"]))
`;
    const result = require("node:child_process").spawnSync(luajit, ["-e", driver], {
        encoding: "utf8", env: { HOME: root, PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

test("a compositor reload keeps blur off under high contrast", {
    skip: luajit ? false : "luajit is not installed",
}, t => {
    const json = value => JSON.stringify(value, null, 4);
    assert.equal(persistedBlur(t), "false", "no stored settings: glass is off by default");
    assert.equal(persistedBlur(t, json({ glassEnabled: true })), "true");
    assert.equal(persistedBlur(t, json({ glassEnabled: false })), "false");
    assert.equal(persistedBlur(t, json({ glassEnabled: true, highContrast: true })), "false",
        "high contrast turns glass off in the shell, so blur must not return on reload");
    assert.equal(persistedBlur(t, json({ highContrast: true, glassEnabled: true })), "false");
    assert.equal(persistedBlur(t, json({ glassEnabled: true, highContrast: false })), "true");
    assert.equal(persistedBlur(t, JSON.stringify({ glassEnabled: true, highContrast: true })),
        "false", "compact JSON reads the same");
});
