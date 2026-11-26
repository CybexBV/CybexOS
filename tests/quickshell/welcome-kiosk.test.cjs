// The welcome guide is drawn in the installer's design: the same tokens,
// the same zoom rule for the 1280×800 canvas, the same faces, full screen.
// docs/welcome.md; installer/kiosk/README.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {shellDir} = require('./shell.cjs');
const root = path.resolve(shellDir, '../..');
const read = name => fs.readFileSync(path.join(shellDir, name), 'utf8');

test('the canvas zoom follows installer/kiosk/src/zoom.rs', () => {
    const qml = read('Welcome/Kiosk.qml');
    const body = qml.match(/function zoomFor\(width: real, height: real, ratio: real\): real \{([^]*?)\n    \}/);
    assert.ok(body, 'zoomFor');
    const zoomFor = vm.runInNewContext(`(function (width, height, ratio) {${body[1]}\n})`);
    // The installer's own vectors, in physical pixels.
    for (const [width, height, zoom] of [[1280, 800, 1], [1920, 1200, 1.5], [1920, 1080, 1.35],
        [2880, 1800, 2.25], [3840, 2160, 2.7]])
        assert.equal(zoomFor(width, height, 1), zoom, `${width}×${height}`);
    // Logical sizes under a compositor scale give the same physical zoom.
    assert.equal(zoomFor(1280, 800, 1.5) * 1.5, 1.5);
    assert.equal(zoomFor(2560, 1440, 1.5) * 1.5, 2.7);
    // The guide rounds down so the canvas always fits: 1.125 is 1.12, not 1.13.
    assert.equal(zoomFor(1440, 900, 1), 1.12);
    assert.ok(zoomFor(1366, 768, 1) * 800 <= 768 && zoomFor(1366, 768, 1) * 1280 <= 1366);
    // The guide fits small screens down to 0.6 rather than the installer's 0.8.
    assert.equal(zoomFor(1024, 600, 1), 0.75);
    assert.equal(zoomFor(640, 400, 1), 0.6);
    assert.equal(zoomFor(0, 0, 1), 1);
    const rust = fs.readFileSync(path.join(root, 'installer/kiosk/src/zoom.rs'), 'utf8');
    assert.match(rust, /pub const CANVAS: \(f32, f32\) = \(1280\.0, 800\.0\);/);
    assert.match(rust, /fit\.clamp\(0\.8, 3\.0\) \* 100\.0\)\.round\(\) \/ 100\.0/);
});

test('the guide is a full-screen overlay that steps aside and leaves a resume pill', () => {
    const window = read('WelcomeWindow.qml');
    assert.match(window, /WlrLayershell\.layer: WlrLayer\.Overlay/);
    assert.match(window, /anchors \{ top: true; left: true; right: true; bottom: true \}/);
    assert.match(window, /exclusionMode: ExclusionMode\.Ignore/);
    assert.match(window, /WlrLayershell\.keyboardFocus: root\.shown \? WlrKeyboardFocus\.Exclusive : WlrKeyboardFocus\.None/);
    assert.match(window, /value: Guide\.Kiosk\.zoomFor\(guide\.width, guide\.height/);
    assert.match(window, /visible: Welcome\.open && Welcome\.aside/);
    assert.match(window, /event\.name === "openwindow"/, 'a new window makes the guide step aside');
    assert.match(window, /Launcher\.open \|\| Overview\.open \|\| Session\.keysOpen/);
    assert.match(window, /readonly property Item contentItem: guide\.contentItem/);
    // The window rule for the old floating window is gone.
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'desktop/hypr/looknfeel.lua'), 'utf8'), /Welcome to Cybex OS/);
});

test('steps open Settings only after stepping aside', () => {
    for (const name of fs.readdirSync(path.join(shellDir, 'Welcome')).filter(file => file.endsWith('.qml'))) {
        const source = read('Welcome/' + name);
        for (const match of source.matchAll(/Settings\.showPanel\(/g)) {
            const before = source.slice(Math.max(0, match.index - 200), match.index);
            assert.match(before, /Welcome\.stepAside\(false\);\s*$/, `${name} opens Settings without stepping aside`);
        }
    }
});

test('shortcut changes are applied or discarded on the way out of the step, not from its footer', () => {
    const step = read('Welcome/ShortcutsStep.qml');
    assert.doesNotMatch(step, /Keybindings\.(apply|discard)\(/, 'the step has no Apply bar');
    assert.match(step, /onNext: Welcome\.move\(1\)/);
    const welcome = read('Common/Welcome.qml');
    assert.match(welcome, /function move\(delta\) \{\s*leave\(/);
    assert.match(welcome, /step === "shortcuts" && target !== step && Keybindings\.dirty\) \{\s*leaving = target;\s*sheet = "shortcuts";/);
    assert.match(read('Welcome/WelcomeView.qml'), /shortcuts: "ShortcutChangesSheet\.qml"/);
    // The guide's own ways out ask too; only Hello's Not now and the resume
    // pill (the step is not on screen) dismiss directly.
    for (const name of fs.readdirSync(path.join(shellDir, 'Welcome')).filter(file => file.endsWith('.qml'))) {
        const source = read('Welcome/' + name);
        assert.doesNotMatch(source, /Welcome\.go\(/, name);
        if (!['HelloStep.qml', 'ResumePill.qml'].includes(name))
            assert.doesNotMatch(source, /Welcome\.dismiss\(/, `${name} closes the guide without asking`);
    }
    const sheet = read('Welcome/ShortcutChangesSheet.qml');
    assert.match(sheet, /Keybindings\.apply\(\)/);
    assert.match(sheet, /if \(Keybindings\.discard\(\)\) Welcome\.proceed\(\);/);
    assert.match(sheet, /function onApplied\(\) \{\s*if \(!root\.applying\) return;\s*root\.applying = false;\s*Welcome\.proceed\(\);/);
    assert.match(sheet, /kind: "primary"\s*focus: true/, 'Enter applies');
});

// 2026-11-24 UI council review: one primary per screen, choices that read as
// what they are, focus rings for the keyboard only, and every finding on
// Ready with somewhere to go.
test('each step has one primary button, and Connect\'s sign-ins are secondary', () => {
    const steps = ['ConnectStep.qml', 'WallpaperStep.qml', 'StyleStep.qml', 'FinishStep.qml'];
    for (const name of steps) {
        const source = read('Welcome/' + name);
        const primaries = (source.match(/kind: "primary"/g) || []).length + (source.match(/KioskFooter \{/g) || []).length;
        assert.equal(primaries, 1, name);
    }
    assert.match(read('Welcome/FinishStep.qml'), /kind: "primary"\s*text: I18n\.tr\("Start using Cybex OS"\)/);
    const connect = read('Welcome/ConnectStep.qml');
    assert.match(connect, /recommended: true/, 'the assistant card is marked, not filled');
    assert.doesNotMatch(connect, /AI assistant · recommended/);
});

test('Connect turns its sign-ins off while known to be offline, and names only the offered agents', () => {
    const connect = read('Welcome/ConnectStep.qml');
    assert.match(connect, /readonly property bool offline: NetworkStatus\.known && !root\.online/);
    assert.match(connect, /objectName: "connectPassword"[\s\S]*?enabled: Welcome\.passwordSignedIn \|\| !root\.offline/);
    assert.match(connect, /objectName: "connectGoogle"[\s\S]*?enabled: Welcome\.googleSignedIn \|\| !root\.offline/);
    assert.match(connect, /objectName: "connectAgent-" \+ modelData[\s\S]*?\(ready \|\| !root\.offline\)/);
    assert.match(connect, /I18n\.tr\("Signing in needs the internet\."\)/);
    assert.match(connect, /visible: root\.offline/, 'the banner follows the same rule');
    // "Claude Code or Codex" only when both are installed (or neither is).
    assert.doesNotMatch(connect, /I18n\.tr\("[^"]*Claude Code or Codex/);
    assert.match(connect, /agentNames: \(root\.installed\.length > 0 \? root\.installed : AssistantHelpers\.AGENT_IDS\)/);
    assert.match(connect, /I18n\.format\("Sign in with %1\. Your assistant/);
    assert.match(connect, /I18n\.format\("Your sign-in stays with %1;/);
});

test('Connect\'s Wiz snores with his own z\'s, not a second set drawn over him', () => {
    const connect = read('Welcome/ConnectStep.qml');
    // His own z's rise there, the cue that he sleeps until an account is
    // connected: he is asked to snore (Assistant/Wiz.qml).
    assert.match(connect, /sourceComponent: Character\.Wiz \{\s*objectName: "connectWiz"\s*pose: card\.character\s*snoring: true\s*\}/);
    // No z's of the step's own, as it once drew: no letter, no animation.
    assert.doesNotMatch(connect.replace(/^\s*\/\/.*$/gm, ""), /\bsnore\b|text: "z"|Animat/);
    assert.match(connect, /readonly property string wizPose: !Assistant\.connected \|\| root\.installed\.length === 0 \? "asleep"/);
});

test('switches have a 3:1 off edge, single choices a radio dot, and focus rings follow the keyboard', () => {
    const toggle = read('Welcome/KioskToggle.qml');
    assert.match(toggle, /color: checked \? Kiosk\.accent : Kiosk\.switchOffTrack/);
    assert.match(toggle, /border\.width: checked \? 0 : Math\.max\(1, Kiosk\.px\(1\)\)\s*border\.color: Kiosk\.fog/);
    const radio = read('Welcome/KioskRadio.qml');
    assert.doesNotMatch(radio, /name: "check"/, 'a radio is a dot, not a tick');
    assert.match(radio, /border\.color: checked \? Kiosk\.accent : Kiosk\.faint/);
    // Dark and Light are chosen by a fill, not a second ring.
    const style = read('Welcome/StyleStep.qml');
    assert.match(style, /color: chosen \? Kiosk\.accentSoft : Kiosk\.card/);
    assert.doesNotMatch(style, /Kiosk\.accentRing/);
    assert.match(read('Welcome/KioskFocusRing.qml'), /opacity: FocusModality\.keyboard \? 1 : 0/);
    assert.match(style, /visible: option\.activeFocus && FocusModality\.keyboard/);
    assert.match(read('WelcomeWindow.qml'), /FocusModalityObserver \{\}/);
});
