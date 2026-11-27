const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

const repoDir = path.resolve(__dirname, "../..");

function readRepo(relative) {
    return fs.readFileSync(path.join(repoDir, relative), "utf8");
}

function readShell(relative) {
    return fs.readFileSync(path.join(shellDir, relative), "utf8");
}

test("desktop-open boundaries accept only HTTP(S) URLs", () => {
    const urls = load("ExternalUrl.js");
    assert.equal(urls.safeHttpUrl("https://github.com/o/r/pull/1"),
        "https://github.com/o/r/pull/1");
    assert.equal(urls.safeHttpUrl(" HTTP://Example.test/thread "),
        "http://example.test/thread");
    for (const unsafe of [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,pwned",
        "t3code://app/",
        "https://example.test/\nfile:///etc/passwd",
        // The notifications' strict rules hold for every link the shell opens.
        "https://user:pass@example.test/",
        "https://0x7f.0x0.0x0.0x1/",
        "https://example.test/%0a",
        null,
    ])
        assert.equal(urls.safeHttpUrl(unsafe), "", String(unsafe));

});







test("settings rail reports and retries both load and save failures", () => {
    const view = readShell("Settings/SettingsView.qml");
    const settings = readShell("Common/Settings.qml");
    assert.match(view,
        /persistenceStatus:[\s\S]*Settings\.loadError[\s\S]*Settings\.loadErrorText[\s\S]*Settings\.saveError/);
    assert.match(view,
        /visible: Settings\.persistenceError && !Settings\.undoAvailable/);
    assert.match(view,
        /Accessible\.name: Settings\.loadError[\s\S]*"Retry loading settings"[\s\S]*"Retry saving settings"/);
    assert.match(view,
        /Settings\.loadError \? "Could not read settings"[\s\S]*Settings\.saveError \? "Could not save settings"/);
    assert.match(view,
        /Accessible\.role: Settings\.persistenceError[\s\S]*Accessible\.AlertMessage/);
    assert.match(settings,
        /function retrySave\(\) \{[\s\S]*if \(loadError\)[\s\S]*store\.reload\(\)[\s\S]*saveNow\(\)/);
});
