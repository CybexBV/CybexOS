const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

function read(rel) {
    return fs.readFileSync(path.join(shellDir, rel), "utf8");
}

test("expressive text and reveal motion use the shared timing language", () => {
    const text = read("Common/AnimatedText.qml");
    const reveal = read("Common/Revealer.qml");

    assert.match(text, /Behavior on text/);
    assert.match(text, /PropertyAction \{\}/,
        "the outgoing label must leave before the new value is committed");
    assert.match(text, /Theme\.springCurve/);
    assert.match(reveal, /Behavior on implicitHeight/);
    assert.match(reveal, /visible:\s*reveal \|\|/,
        "revealed content must survive its exit transition");

    const actions = read("Common/NotifActions.qml");
    assert.match(actions, /Revealer\s*\{/);
    assert.match(actions, /Notifs\.secondaryActions\(entry\)/);
    assert.doesNotMatch(actions, /items:\s*reveal\s*\?/,
        "notification actions must not vanish before the revealer closes");

    const clock = read("Bar/Modules/Clock.qml");
    assert.match(clock, /AnimatedText\s*\{/);
    assert.match(clock, /animateChange:\s*!Settings\.modOpts\.clock\.seconds/,
        "a seconds clock should not run a transition every second");
});

test("menubar icons keep bright system ink and shared monochrome brands", () => {
    const bar = read("Bar/Bar.qml");
    const chip = read("Bar/BarChip.qml");
    const icon = read("Bar/BarIcon.qml");
    const updates = read("Bar/Modules/Updates.qml");
    const media = read("Bar/Modules/Media.qml");
    const tray = read("Bar/Modules/Tray.qml");
    const volume = read("Bar/Modules/Volume.qml");
    const wifi = read("Bar/Modules/Wifi.qml");
    const bluetooth = read("Bar/Modules/Bluetooth.qml");
    const battery = read("Bar/Modules/Battery.qml");
    const weather = read("Bar/Modules/Weather.qml");
    const brand = read("Bar/BarBrandIcon.qml");

    assert.match(chip, /property color idleColor:\s*Theme\.barIcon/);
    assert.match(chip, /property color hoverColor:\s*Theme\.barTextHi/);
    assert.match(chip,
        /readonly property color fg:\s*held \|\| hovered \? hoverColor : idleColor/,
        "content chips must expose the same hover foreground as glyph chips");
    assert.match(icon,
        /held \|\| root\.hovered \? hoverColor : idleColor/);
    assert.match(brand, /BrandIcon\s*\{/);
    assert.match(brand, /colorized:\s*true/);
    assert.match(brand, /tint:\s*Theme\.barIcon/);
    assert.match(brand, /normalizeTintSource:\s*true/,
        "bar brands must not inherit luminance from canonical source paint");

    assert.equal((bar.match(/idleColor:\s*Theme\.barIcon/g) || []).length, 1,
        "the launcher keeps the shared resting icon tone");
    const control = read("Bar/Modules/Control.qml");
    const controlGlyph = read("Bar/ControlIconGlyph.qml");
    assert.match(control,
        /BarChip\s*\{[\s\S]{0,220}?panelName:\s*"control"[\s\S]{0,700}?ControlIconGlyph\s*\{/,
        "the Control Center widget draws its chosen icon");
    // The default Cybex OS mark is the bundled vector; a Nerd Font icon
    // takes the same resting and hover ink as the bar's other marks.
    assert.match(controlGlyph, /BarBrandIcon\s*\{[\s\S]{0,180}?name:\s*"cybexos"/);
    assert.match(controlGlyph, /property color idleColor:\s*Theme\.barIcon/);
    assert.match(controlGlyph, /property color hoverColor:\s*Theme\.barTextHi/);
    assert.match(controlGlyph, /color: root\.highlighted \? root\.hoverColor : root\.idleColor/);
    assert.match(control,
        /highlighted:\s*controlButton\.held \|\| controlButton\.hovered/);
    // The one bar target that rests on a chip (2026-11 review): the Cybex X
    // at the far right read as a window's close button. It takes the status
    // group's resting fill, and an accent edge while its drawer is open.
    assert.match(control, /restFill: Theme\.barChip/);
    assert.match(control, /border\.width: held \? 1 : 0\s+border\.color: Theme\.barAccent/);
    assert.match(control, /tooltip: I18n\.tr\("Control Center"\)/);
    assert.doesNotMatch(updates, /idleColor:|rebootRecommended/,
        "the available-update icon uses the shared system ink");
    // Without a cover the chip shows the player's mark in the shared ink.
    const mediaArt = read("Common/MediaArt.qml");
    assert.match(media, /markColor:\s*mediaChip\.fg/);
    assert.match(media, /markHighlighted:\s*mediaChip\.held \|\| mediaChip\.hovered/);
    assert.match(mediaArt, /highlighted:\s*root\.markHighlighted/);
    assert.match(mediaArt, /tintAmount:\s*root\.markHighlighted \? 1 : 0/);
    assert.match(mediaArt, /layer\.enabled:\s*visible && tintAmount > 0\.001/,
        "the player icon must not hold an offscreen layer at rest");
    assert.match(tray, /Theme\.barTextHi : Theme\.barIcon/);
    assert.match(tray, /tintAmount:\s*itemHover\.over \? 1 : 0/);
    assert.match(tray, /layer\.enabled:\s*tintAmount > 0\.001/,
        "tray icons must not hold an offscreen layer at rest");
    assert.match(volume, /idleColor:\s*Audio\.muted \? Theme\.barRedText : Theme\.barIcon/);
    assert.match(volume, /color:\s*chip\.fg/);
    // Offline and unconnected marks are dimmed in the readable disabled ink
    // (about 3:1) rather than faded to 35 %, which fell below 2:1.
    assert.match(wifi, /color: EthernetState\.connected \|\| WifiState\.connected\s+\? chip\.fg : Theme\.barTextDisabled/);
    assert.match(bluetooth, /color: BluetoothState\.connected \? chip\.fg : Theme\.barTextDisabled/);
    assert.doesNotMatch(wifi + bluetooth, /opacity:/);
    assert.match(battery, /Battery\.pluggedIn \? Theme\.barAccent : Theme\.barIcon/);
    assert.match(battery, /color:\s*chip\.fg/);
    assert.match(weather, /idleColor:\s*Weather\.barGlyphColor\(Weather\.code, Weather\.isDay\)/);
    assert.match(weather, /color:\s*chip\.fg/);
    assert.match(weather,
        /opacity:\s*chip\.held \|\| chip\.hovered \|\| !Weather\.offline \? 1 : 0\.52/);
    assert.doesNotMatch(weather, /color:\s*Theme\.barIcon/,
        "weather must retain its condition palette at rest");
});

test("scroll chrome discloses overflow without becoming an input surface", () => {
    const chrome = read("Common/ScrollChrome.qml");
    assert.match(chrome, /required property Flickable target/);
    assert.match(chrome, /target\.atYBeginning/);
    assert.match(chrome, /target\.atYEnd/);
    assert.match(chrome, /visibleArea\.heightRatio/);
    assert.match(chrome,
        /Format\.clamp01\(\s*viewportPosition \/ Math\.max\(0\.0001, 1 - viewportRatio\)/,
        "the thumb position must normalize Qt's shortened visible-area range");
    assert.match(chrome,
        /root\.scrollProgress \* Math\.max\(0, root\.height - height\)/,
        "a vertical thumb must reach the end of its track at full scroll");
    assert.doesNotMatch(chrome,
        /visibleArea\.yPosition \* \(root\.height - height\)/,
        "the viewport ratio must not be applied to the thumb offset twice");
    assert.doesNotMatch(chrome, /MouseArea|TapHandler|WheelHandler|DragHandler/);

    for (const rel of [
        "Settings/FolderDialog.qml",
        "Settings/SettingsPage.qml"
    ])
        assert.match(read(rel), /ScrollChrome\s*\{/,
            `${rel} does not use the shared viewport treatment`);
});
