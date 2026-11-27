const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

function read(relative) {
    return untranslated(fs.readFileSync(path.join(shellDir, relative), "utf8"));
}

test("the Cybex OS widget owns Control Center through the normal module pipeline", () => {
    const bar = read("Bar/Bar.qml");
    const registry = load("PanelRegistryData.js");
    const button = read("Bar/Modules/Control.qml");
    assert.match(bar, /control: "Modules\/Control.qml"/);
    assert.doesNotMatch(bar, /id: controlButton/);
    assert.match(button, /moduleId: "control"/);
    assert.match(button, /isle: root.isle/);

    assert.match(button, /BarChip/);
    assert.match(button, /panelName:\s*"control"/);
    assert.match(button, /tooltip:\s*"Control Center"/);
    // The button's icon is Settings' choice (Common/ControlIconHelpers.js);
    // by default the Cybex OS mark, drawn from its bundled SVG.
    const glyph = read("Bar/ControlIconGlyph.qml");
    assert.match(button, /ControlIconGlyph\s*\{/);
    assert.match(glyph, /property string value: Settings\.controlIcon/);
    assert.match(glyph, /BarBrandIcon\s*\{[\s\S]{0,120}?visible: root\.glyph === ""[\s\S]{0,40}?name:\s*"cybexos"/);
    assert.equal(load("SettingsHelpers.js").defaults().controlIcon, "cybex");
    assert.equal(load("ControlIconHelpers.js").barGlyph("cybex"), "");
    assert.match(button, /width:\s*Theme\.barIconSize/);
    assert.match(button, /height:\s*Theme\.barIconSize/);
    assert.match(button,
        /highlighted:\s*controlButton\.held \|\| controlButton\.hovered/,
        "the Cybex OS mark must switch to its exact white SVG on hover");
    assert.equal(registry.byName("control").moduleId, "control",
        "Control Center must follow its movable widget");
});

test("session actions use the installed helper and report observed failures", () => {
    const session = read("Common/Session.qml");
    assert.match(session,
        /sessionAction\.command = \["cybexos-session-action", action\]/);
    assert.match(session, /Process \{[\s\S]*id:\s*sessionAction/);
    assert.match(session, /ProcHelpers\.NOT_STARTED/);
    assert.match(session, /summary:\s*"Session action failed"/);
    assert.doesNotMatch(session, /sleep 0\.3|hyprlock.*&/,
        "suspend must not depend on an unobserved fixed delay");
});

test("launcher and session power compatibility routes toggle control", () => {
    const shell = read("shell.qml");
    const providers = read("Common/LauncherProviders.qml");
    const providerData = load("LauncherProviders.js");
    const session = read("Common/Session.qml");

    const ipcPower = shell.match(/function power\(\): void \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    assert.match(ipcPower,
        /Popouts\.toggle\("control", undefined, undefined,[\s\S]*Screens\.focused/);

    const launcherPower = providers.slice(providers.indexOf('case "power":'),
        providers.indexOf("break;", providers.indexOf('case "power":')));
    assert.match(launcherPower,
        /Popouts\.toggle\("control", undefined, undefined,[\s\S]*Screens\.focused/);
    assert.equal(providerData.BUILTIN_ACTIONS.find(action => action.id === "power").name,
        "Open Control Center");

    assert.doesNotMatch(session,
        /powerOpen|openMenu|closeMenu|toggleMenu/,
        "the retired overlay lifecycle must not survive in Session");
    assert.match(shell, /function lock\(\): void \{\s*Session\.lock\(\);/,
        "direct session actions keep their established IPC route");
    assert.match(shell,
        /function close\(\): void \{[\s\S]*Session\.closeAll\(\);[\s\S]*Popouts\.currentName === "control"[\s\S]*Popouts\.close\(\);/,
        "session close must dismiss the panel opened by session power");
});
