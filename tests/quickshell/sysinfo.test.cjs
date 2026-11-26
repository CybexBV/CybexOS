const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir } = require("./shell.cjs");

const source = fs.readFileSync(path.join(shellDir, "Common", "SysInfo.qml"), "utf8");

test("root capacity uses one guarded direct df process and validates completion", () => {
    const disk = source.slice(source.indexOf("function finishRootFsProbe"),
        source.indexOf("// ---- brightness"));
    assert.match(disk, /if \(exitCode !== 0\)/);
    assert.match(disk, /SysInfoHelpers\.parseDf\(stdoutText\)/);
    assert.match(disk, /setRootFsUnavailable/);
    assert.match(disk,
        /function refreshRootFs\(\)[\s\S]{0,120}?if \(!rootFsProc\.running\)[\s\S]{0,80}?rootFsProc\.running = true/,
        "overlapping df runs must be suppressed");
    assert.match(disk,
        /command:\s*\["df",\s*"--block-size=1",\s*"--output=fstype,size,used,avail,pcent,target",\s*"\/"\]/);
    assert.match(disk, /environment:\s*\(\{ LC_ALL:\s*"C" \}\)/);
    assert.doesNotMatch(disk, /command:\s*\["sh"/,
        "the capacity probe must not use a shell pipeline");
    assert.match(disk, /ProcHelpers\.NOT_STARTED/);
});

test("the first watcher primes every reading and all polling stops without watchers", () => {
    const watchers = source.slice(source.indexOf("// ---- watchers"));
    assert.match(watchers,
        /function acquire\(\)[\s\S]{0,120}?watchers === 0[\s\S]{0,420}?cpuPrev = null/);
    for (const refresh of [
        "statView.reload()", "cpuPrimeTimer.restart()", "memView.reload()", "uptimeView.reload()",
        "tempView.reload()", "refreshRootFs()", "refreshBrightness()",
    ])
        assert.ok(watchers.includes(refresh), `${refresh} is absent from first acquire`);
    assert.match(watchers,
        /id:\s*cpuPrimeTimer[\s\S]{0,80}?interval:\s*250[\s\S]{0,140}?root\.watchers > 0/);
    assert.match(watchers,
        /function release\(\)[\s\S]{0,160}?watchers === 0[\s\S]{0,80}?cpuPrimeTimer\.stop\(\)/);
    for (const interval of [2000, 10000, 60000])
        assert.match(watchers, new RegExp(
            `interval:\\s*${interval}[\\s\\S]{0,100}?running:\\s*root\\.watchers > 0`));
    assert.match(watchers, /function release\(\)[\s\S]{0,100}?Math\.max\(0, watchers - 1\)/);
});
