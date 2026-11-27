const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

function read(relative) {
    return untranslated(fs.readFileSync(path.join(shellDir, relative), "utf8"));
}

function objectBlock(source, start) {
    let depth = 0;
    const opening = source.indexOf("{", start);
    for (let index = opening; index < source.length; index++) {
        if (source[index] === "{")
            depth++;
        else if (source[index] === "}" && --depth === 0)
            return source.slice(start, index + 1);
    }
    assert.fail("unterminated QML object block");
}

test("a machine without Wi-Fi tells a missing cable from missing hardware", () => {
    const drawer = read("Popovers/Drawer/DrawerNetwork.qml");
    // Until EthernetState has answered, or while a port exists, the cable is
    // what is missing; only a machine with no port at all lacks hardware.
    assert.match(drawer,
        /!wifiPresent \? \(!EthernetState\.known \|\| EthernetState\.devices\.length > 0\s*\? "cable" : "hardware"\)/);
});

test("Tailscale is an overlay row with its own setup path, not the physical route", () => {
    const singleton = read("Common/Tailscale.qml");
    const drawer = read("Popovers/Drawer/DrawerNetwork.qml");

    assert.match(singleton,
        /readonly property bool connected:\s*running && ip !== "" && statusError === ""/);
    assert.match(drawer, /visible:\s*!Tailscale\.missing/);
    assert.match(drawer, /: Tailscale\.statusText/);
    assert.match(drawer, /onClicked:\s*Tailscale\.showSetup\(\)/);
    // Tailscale augments the view; the diagnostics remain bound to
    // NetworkDetails' selected Ethernet/Wi-Fi interface.
    assert.match(drawer, /NetworkDetails\.primaryInterface/);
    assert.doesNotMatch(drawer, /primary:\s*Tailscale/);
});

test("Tailscale polling follows Network consumers and refreshes new views", () => {
    const singleton = read("Common/Tailscale.qml");
    const module = read("Bar/Modules/Wifi.qml");

    assert.match(singleton,
        /function acquire\(\)[\s\S]{0,120}watchers\+\+;[\s\S]{0,80}if \(!statusProc\.running\)\s*refresh\(\)/);
    // The menubar's permanent claim polls slowly; an open view polls fast.
    assert.match(singleton, /readonly property int livePollMs:\s*30000/);
    assert.match(singleton, /readonly property int idlePollMs:\s*120000/);
    assert.match(singleton,
        /interval:\s*root\.missing \? root\.missingPollMs\s*: root\.liveWatchers > 0 \? root\.livePollMs : root\.idlePollMs/);
    // Nothing polls an idle or locked session; the first input refreshes.
    assert.match(singleton, /running:\s*root\.watchers > 0 && !Activity\.idle/);
    assert.match(singleton,
        /target: Activity[\s\S]{0,80}function onResumed\(\)[\s\S]{0,120}root\.refresh\(\)/);
    // A missing binary is probed hourly, not forked every poll.
    assert.match(singleton, /readonly property int missingPollMs:\s*Format\.MS_HOUR/);
    assert.match(singleton, /missing = exitCode === ProcHelpers\.NOT_STARTED;/);
    assert.match(singleton,
        /function acquireLive\(\)\s*\{\s*liveWatchers\+\+;\s*acquire\(\);/);
    assert.match(singleton,
        /function releaseLive\(\)\s*\{[\s\S]{0,80}liveWatchers - 1\);\s*release\(\);/);
    const drawer = read("Popovers/Drawer/DrawerNetwork.qml");
    assert.match(drawer, /onClaimed:[\s\S]{0,200}Tailscale\.acquireLive\(\)/);
    assert.match(drawer, /onReleased:[\s\S]{0,200}Tailscale\.releaseLive\(\)/);
    assert.match(module, /Tailscale\.acquire\(\)/);
    assert.match(module, /Tailscale\.release\(\)/);
});

test("the Tailscale switch issues exactly one requested state change", () => {
    const singleton = read("Common/Tailscale.qml");
    const panel = read("Popovers/Drawer/DrawerNetwork.qml");
    const checked = panel.indexOf("checked: Tailscale.running");
    assert.ok(checked >= 0);
    const start = panel.lastIndexOf("Toggle {", checked);
    const toggle = objectBlock(panel, start);

    assert.match(toggle, /onToggled:\s*value => Tailscale\.setRunning\(value\)/);
    assert.doesNotMatch(toggle, /execDetached/);
    assert.match(singleton, /function setRunning\(value\)/);
    assert.doesNotMatch(singleton, /execDetached\(\["tailscale"/);
    assert.match(singleton, /actionProc\.command = TailscaleHelpers\.command\(value, privileged, actionProc\.login\)/);
});

test("wired monitoring is ref-counted by each visible Network consumer", () => {
    const singleton = read("Common/EthernetState.qml");
    const module = read("Bar/Modules/Wifi.qml");
    const drawer = read("Popovers/Drawer/DrawerNetwork.qml");

    assert.match(singleton, /function acquire\(\)/);
    assert.match(singleton, /function release\(\)/);
    // One NetworkManager event stream for the shell: wired changes arrive
    // through NetworkStatus's `nmcli monitor`, and the poll is only a
    // safety net while that stream is down.
    assert.doesNotMatch(singleton, /"nmcli", "device", "monitor"/);
    assert.match(singleton,
        /target: NetworkStatus[\s\S]*?function onMonitorEvent\(line\)[\s\S]*?monitorDebounce\.restart\(\)/);
    assert.match(singleton, /function onMonitorRunningChanged\(\)/);
    assert.match(singleton,
        /id: poll[\s\S]{0,80}running: root\.watchers > 0 && !NetworkStatus\.monitorRunning/);
    assert.match(singleton, /property bool known:/);
    assert.match(singleton, /property string error:/);
    assert.match(singleton, /readonly property var connectedDevices:/);
    for (const source of [module, drawer]) {
        assert.match(source, /EthernetState\.acquire\(\)/);
        assert.match(source, /EthernetState\.release\(\)/);
    }
});
