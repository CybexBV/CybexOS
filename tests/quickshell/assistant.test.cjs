// The Cybex OS Assistant's shell side (docs/assistant.md): placement, the box's
// side, agent choice, and the wiring between the shortcut, the service, the
// bar, the compositor and the installation feature. The service has its own
// tests in tests/nixos/test_assistant.py.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

const A = load("AssistantHelpers.js");
const root = path.resolve(shellDir, "../..");
const read = relative => fs.readFileSync(path.join(shellDir, relative), "utf8");
const repo = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("tool permissions default to Always allow and Ask first remains an explicit choice", () => {
    const H = load("SettingsHelpers.js");
    assert.equal(H.defaults().assistantApprovalPolicy, "always");
    for (const value of [undefined, null, false, "unknown", "always"])
        assert.equal(H.merge({ assistantApprovalPolicy: value }).assistantApprovalPolicy, "always");
    assert.equal(H.merge({ assistantApprovalPolicy: "ask" }).assistantApprovalPolicy, "ask");
    assert.match(read("Settings/AssistantPage.qml"), /settingKey: "assistantApprovalPolicy"/);
});

test("the character starts in the top-right corner below the bar and stays on its output", () => {
    const output = { width: 1920, height: 1080 };
    assert.deepEqual(A.placement({ x: -1, y: -1 }, output, 60, 36),
        { x: 1920 - 60 - 24, y: 36 + 24 });
    assert.deepEqual(A.placement({ x: 300, y: 200 }, output, 60, 36), { x: 300, y: 200 });
    // A place saved on a larger display is pulled back inside this one.
    assert.deepEqual(A.placement({ x: 3000, y: 2000 }, output, 60, 36), { x: 1860, y: 1020 });
    assert.deepEqual(A.placement({ x: 10.6, y: 0 }, output, 60, 0), { x: 11, y: 0 });
});

test("the box opens below unless below is cramped and above is roomier", () => {
    const output = { width: 1920, height: 1080 };
    const below = A.dockPlacement({ x: 900, y: 100 }, 60, output, 360, 36);
    assert.equal(below.above, false);
    assert.equal(below.anchorY, 100 + 60 + A.GAP);
    assert.equal(below.room, 1080 - (100 + 60 + A.GAP) - A.EDGE);
    assert.equal(below.x, 900 + 30 - 180, "centred under the character");

    const near = A.dockPlacement({ x: 900, y: 900 }, 60, output, 360, 36);
    assert.equal(near.above, true);
    assert.equal(near.anchorY, 900 - A.GAP);
    assert.equal(near.room, 900 - A.GAP - 36);

    // Cramped both ways: the roomier side wins, which is below here.
    const short = { width: 800, height: 420 };
    const middle = A.dockPlacement({ x: 300, y: 120 }, 60, short, 360, 36);
    assert.equal(middle.above, false, "below has 218 px, above only 74");

    // Clamped to the output with its margin, and never wider than it.
    assert.equal(A.dockPlacement({ x: 0, y: 100 }, 60, output, 360, 0).x, A.EDGE);
    assert.equal(A.dockPlacement({ x: 1860, y: 100 }, 60, output, 360, 0).x, 1920 - 360 - A.EDGE);
    assert.equal(A.dockPlacement({ x: 100, y: 100 }, 60, { width: 300, height: 900 }, 360, 0).width,
        300 - A.EDGE * 2);
});

test("a drag that ends past the edge finds the display under the pointer", () => {
    const outputs = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: -200, width: 2560, height: 1440 }];
    assert.equal(A.outputAt(outputs, 100, 100), 0);
    assert.equal(A.outputAt(outputs, 2000, -100), 1);
    assert.equal(A.outputAt(outputs, 1919, 1079), 0);
    assert.equal(A.outputAt(outputs, 1920, 1300), -1, "between displays is no display");
    assert.equal(A.dragged(4, -4), false, "a press that wobbles is still a click");
    assert.equal(A.dragged(5, 0), true);
});

test("automatic follows the cybex agent default, then whichever is installed", () => {
    const both = { claude: { available: true }, codex: { available: true } };
    const codexOnly = { claude: { available: false }, codex: { available: true } };
    assert.equal(A.resolveAgent("auto", both, "codex"), "codex");
    assert.equal(A.resolveAgent("auto", both, "opencode"), "claude");
    assert.equal(A.resolveAgent("auto", codexOnly, "claude"), "codex",
        "a default that is not installed gives way to one that is");
    assert.equal(A.resolveAgent("auto", {}, ""), "claude");
    assert.equal(A.resolveAgent("codex", {}, "claude"), "codex",
        "an explicit choice stands, so the service can say it is missing");
    assert.equal(A.nextAgent("claude", both), "codex");
    assert.equal(A.nextAgent("codex", both), "claude");
    assert.equal(A.nextAgent("claude", codexOnly), "codex");
    assert.equal(A.nextAgent("codex", {}), "codex");
    assert.equal(A.anyAgent({ claude: { available: false } }), false);
    assert.equal(A.resolveAgent("auto", {claude: {available: true, auth: "required"},
        codex: {available: true, auth: "ready"}}, "claude"), "codex");
    assert.equal(A.modelFor("claude", "sonnet", "gpt-5.6-sol"), "sonnet");
    assert.equal(A.modelFor("codex", "sonnet", "default"), "");
});

test("effort: Auto leaves it to the agent, Codex alone has None", () => {
    assert.deepEqual(A.effortChoices("claude").map(choice => choice.value),
        ["default", "low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(A.effortChoices("codex").map(choice => choice.value),
        ["default", "none", "low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(A.effortChoices("codex").map(choice => choice.short),
        ["Auto", "None", "Low", "Med", "High", "XHigh", "Max"]);
    assert.deepEqual(A.effortChoices("claude")[0], { value: "default", label: "Auto", short: "Auto" });
    assert.equal(A.effortFor("claude", "high", "low"), "high");
    assert.equal(A.effortFor("codex", "high", "none"), "none");
    assert.equal(A.effortFor("codex", "high", "default"), "");
    assert.equal(A.effortFor("claude", "none", "low"), "", "Claude Code has no None");
    assert.equal(A.effortFor("claude", "turbo", "low"), "", "an unknown effort is left to the agent");
    assert.equal(A.effortFor("claude", "", "low"), "");
    assert.equal(A.effortLabel("claude", "default"), "Auto");
    assert.equal(A.effortLabel("codex", ""), "Auto");
    assert.equal(A.effortLabel("codex", "medium"), "Medium");
    assert.equal(A.effortLabel("claude", "xhigh"), "XHigh");
});

test("Wiz's pose follows the most urgent state and what a running turn is doing", () => {
    const base = { connected: true };
    const pose = state => A.characterPose(Object.assign({}, base, state));
    assert.equal(A.characterPose({}), "asleep");
    assert.equal(pose({ composing: true }), "listening", "an open box is listened to");
    assert.equal(pose({ listening: true, busy: true }), "listening");
    assert.equal(pose({ busy: true, composing: true }), "thinking");
    assert.equal(pose({ celebrating: true, failed: true }), "finished");
    assert.equal(pose({ waiting: true, busy: true, step: "Waiting for your approval", stepKind: "run" }), "needs-input");
    // Every kind of step the service reports has its own pose.
    const kinds = { think: "thinking", read: "reading", search: "searching", write: "writing", run: "casting",
        change: "casting", install: "brewing", delegate: "delegating", tool: "working" };
    for (const [kind, expected] of Object.entries(kinds)) {
        assert.equal(pose({ busy: true, step: "A step", stepKind: kind }), expected, kind);
        assert.equal(A.workPose(kind, "A step"), expected, kind);
    }
    assert.deepEqual(A.STEP_POSES, kinds);
    // The kind wins over the line: the service's own words don't matter.
    assert.equal(pose({ busy: true, step: "Thinking", stepKind: "read" }), "reading");
    // An older service sends no kind: the service's own "Thinking" step
    // (turn.py) is thinking, any tool step is work.
    assert.equal(pose({ busy: true, step: "Thinking" }), "thinking");
    assert.equal(pose({ busy: true, step: "" }), "thinking");
    assert.equal(pose({ busy: true, step: "Running nix flake check" }), "working");
    // No step at all ("" from a newer service) thinks too; an unknown kind falls back.
    assert.equal(pose({ busy: true, step: "", stepKind: "" }), "thinking");
    assert.equal(pose({ busy: true, step: "Doing a new thing", stepKind: "juggle" }), "working");
    assert.equal(pose({ transcribing: true, step: "Editing shell.json", stepKind: "write" }), "thinking",
        "transcribing is not a turn at work");
    // How a turn ended: a nod, a thumbs-up after a minute or more, a shrug
    // when the ownership rules refused something.
    assert.equal(pose({ celebrating: true }), "finished");
    assert.equal(pose({ celebrating: true, took: 59999 }), "finished");
    assert.equal(pose({ celebrating: true, took: 60000 }), "proud");
    assert.equal(A.PROUD_AFTER_MS, 60000);
    assert.equal(pose({ celebrating: true, refused: true }), "shrug");
    assert.equal(pose({ celebrating: true, refused: true, took: 120000 }), "shrug", "a refusal outweighs the time");
    assert.equal(pose({ refused: true }), "idle", "only the celebration shrugs");
    assert.equal(pose({ speaking: true }), "happy");
    // A reply that offers something to act on: he points at it, once the
    // celebration is over and while nothing else is going on.
    assert.equal(pose({ offers: true }), "pointing");
    assert.equal(pose({ offers: true, celebrating: true }), "finished");
    assert.equal(pose({ offers: true, speaking: true }), "happy");
    assert.equal(pose({ offers: true, composing: true }), "listening");
    // A file held over him: curious, over everything but a drag and no service.
    assert.equal(pose({ fileOver: true }), "curious");
    assert.equal(pose({ fileOver: true, busy: true, stepKind: "read" }), "curious");
    assert.equal(pose({ fileOver: true, waiting: true }), "curious");
    assert.equal(pose({ fileOver: true, dragging: true }), "carried");
    assert.equal(A.characterPose({ fileOver: true }), "asleep");
    // Drowsy after a long quiet while: over an idle Wiz, an open box, a
    // pointed-at reply and a seen failure, never over a question at work or
    // waiting, a routine's finding, a celebration or speech.
    assert.equal(A.DROWSY_AFTER_MS, 600000);
    for (const quiet of [{}, { composing: true }, { offers: true }, { failed: true }])
        assert.equal(pose({ drowsy: true, ...quiet }), "drowsy", JSON.stringify(quiet));
    assert.equal(pose({ drowsy: true, busy: true, stepKind: "search" }), "searching");
    assert.equal(pose({ drowsy: true, waiting: true, busy: true }), "needs-input");
    assert.equal(pose({ drowsy: true, attention: true }), "needs-input");
    assert.equal(pose({ drowsy: true, celebrating: true }), "finished");
    assert.equal(pose({ drowsy: true, speaking: true }), "happy");
    assert.equal(pose({ drowsy: true, listening: true }), "listening");
    // Being dragged wins over everything, even a turn at work or no service.
    assert.equal(pose({ dragging: true }), "carried");
    assert.equal(pose({ dragging: true, busy: true, step: "Reading a file", stepKind: "read", waiting: true }), "carried");
    assert.equal(A.characterPose({ dragging: true }), "carried");
    assert.equal(pose({ failed: true }), "sorry");
    assert.equal(pose({}), "idle");
    const W = load("WizRig.js");
    for (const state of [{}, base, { ...base, composing: true }, { ...base, waiting: true, busy: true },
        { ...base, busy: true, step: "Reading a file" }, { ...base, busy: true }, { ...base, celebrating: true },
        { ...base, celebrating: true, took: 90000 }, { ...base, celebrating: true, refused: true },
        { ...base, speaking: true }, { ...base, failed: true }, { ...base, dragging: true },
        { ...base, offers: true }, { ...base, fileOver: true }, { ...base, drowsy: true }]
        .concat(Object.keys(kinds).map(kind => ({ ...base, busy: true, stepKind: kind }))))
        assert.ok(W.STATES.includes(A.characterPose(state)), "every pose is one Wiz can show");
    const shared = read("Common/Assistant.qml");
    assert.doesNotMatch(shared, /\bmood\b/);
    assert.match(shared, /readonly property string pose: AssistantHelpers\.characterPose\(characterState\)/);
    assert.match(shared, /step: root\.turn \? root\.turn\.step \|\| "" : ""/);
    assert.match(shared, /stepKind: root\.turn \? root\.turn\.stepKind : undefined/);
    assert.match(shared, /refused: !!\(root\.turn && root\.turn\.refused\)/);
    assert.match(shared, /took: root\.turn && root\.turn\.finishedAt \? root\.turn\.finishedAt - \(root\.turn\.startedAt \|\| 0\) : 0/);
    assert.match(repo("desktop/assistant/cybexos_assistant/turn.py"), /self\.step = "Thinking"/,
        "the service's thinking step is the one characterPose recognises");
    // The service's kinds are exactly the ones a pose exists for.
    const kindsLine = /KINDS = \(([^)]*)\)/.exec(repo("desktop/assistant/cybexos_assistant/steps.py"))[1];
    assert.deepEqual(kindsLine.split(",").map(name => name.trim()).sort(),
        ["CHANGE", "DELEGATE", "INSTALL", "READ", "RUN", "SEARCH", "THINK", "TOOL", "WRITE"]);
});

test("Wiz points at a reply that offers something to act on", () => {
    const done = { status: "completed", plugins: [], staged: "" };
    assert.equal(A.replyOffers(null, {}, []), false);
    assert.equal(A.replyOffers(done, {}, []), false, "a plain answer offers nothing to act on");
    const widget = { ...done, plugins: [{ id: "personal.cputemp", name: "CPU temperature" }] };
    assert.equal(A.replyOffers(widget, {}, []), true, "Add to bar");
    assert.equal(A.replyOffers(widget, {}, ["personal.cputemp"]), false, "added already");
    assert.equal(A.replyOffers({ ...widget, plugins: widget.plugins.concat([{ id: "personal.b" }]) }, {},
        ["personal.cputemp"]), true, "one of two still to add");
    // On the bar already, whoever put it there (Settings, `cybex plugin
    // enable`, this reply before the shell restarted): nothing to point at.
    assert.equal(A.replyOffers(widget, {}, [], ["personal.cputemp"]), false, "on the bar already");
    assert.equal(A.replyOffers(widget, {}, [], ["personal.other"]), true, "another widget is on the bar");
    assert.equal(A.replyOffers(widget, {}, undefined, undefined), true, "nothing known yet: the button is there");
    const two = { ...widget, plugins: widget.plugins.concat([{ id: "personal.b" }]) };
    assert.equal(A.replyOffers(two, {}, ["personal.b"], ["personal.cputemp"]), false, "one clicked, one on the bar");
    assert.equal(A.replyOffers(two, {}, [], ["personal.cputemp"]), true, "one of two on the bar");
    // The review is offered whatever is on the bar.
    assert.equal(A.replyOffers({ ...widget, staged: "tx-1" }, { transaction: "tx-1", state: "ready" }, [],
        ["personal.cputemp"]), true);
    const staged = { ...done, staged: "tx-1" };
    assert.equal(A.replyOffers(staged, { transaction: "tx-1", state: "ready" }, []), true, "Review change…");
    assert.equal(A.replyOffers(staged, { transaction: "tx-1", state: "preparing" }, []), false, "not built yet");
    assert.equal(A.replyOffers(staged, { transaction: "tx-1", state: "done" }, []), false, "applied");
    assert.equal(A.replyOffers(staged, { transaction: "tx-2", state: "ready" }, []), false, "another change");
    assert.equal(A.replyOffers({ ...widget, status: "failed" }, {}, []), false, "a failure is sorry, not a pointer");
    const shared = read("Common/Assistant.qml");
    // What is on the bar is the shell's own word (Common/UserPlugins), read
    // only while a reply is open.
    assert.match(shared, /readonly property bool replyOffers: replyOpen && !composing && !historyOpen && !busy\s*&& AssistantHelpers\.replyOffers\(turn, Updates\.deployment, addedWidgets,\s*UserPlugins\.enabledWidgets\.map\(widget => widget\.id\)\)/);
    assert.match(read("Common/UserPlugins.qml"), /readonly property var enabledWidgets: widgets\.filter\(plugin => plugin\.enabled\)/);
    assert.equal(shared.match(/UserPlugins\./g).length, 1, "nothing else in the assistant makes the plugin scan start");
    assert.match(shared, /function addWidget\(pluginId\) \{[\s\S]*?addedWidgets = addedWidgets\.concat\(\[pluginId\]\)/);
    assert.match(shared, /offers: root\.replyOffers/);
    // The buttons it counts are the reply's own.
    const reply = read("Assistant/AssistantReply.qml");
    assert.match(reply, /label: I18n\.tr\("Add to bar"\)/);
    assert.match(reply, /visible: root\.deploymentState === "ready"[\s\S]*?label: I18n\.tr\("Review change…"\)/);
});

test("Wiz gets drowsy after ten quiet minutes, on one timer, and wakes when used", () => {
    const shared = read("Common/Assistant.qml");
    assert.match(shared, /property int drowsyAfter: AssistantHelpers\.DROWSY_AFTER_MS/);
    // Never while something runs or waits for the person.
    const quiet = /readonly property bool quiet: ([\s\S]*?)\n\s*onQuietChanged/.exec(shared)[1];
    for (const term of ["shown", "connected", "!busy", "!sideBusy", "queue === null", "!listening", "!transcribing",
        "!speaking", "!celebrating", "!dragging", "!fileOver", "!unread", 'attentionConversation === ""'])
        assert.ok(quiet.includes(term), term);
    assert.match(shared, /onQuietChanged: \{\s*if \(!quiet\)\s*drowsy = false;/);
    assert.match(shared, /Timer \{\s*id: dozing\s*interval: root\.drowsyAfter\s*running: root\.quiet && !root\.drowsy\s*onTriggered: root\.drowsy = true\s*\}/);
    assert.equal((shared.match(/id: dozing/g) || []).length, 1, "one timer");
    // Every way of using him stirs him: a click, a question, the box, typing.
    assert.match(shared, /function characterClicked\(\) \{\s*stir\(\);/);
    assert.match(shared, /function send\(text\) \{\s*stir\(\);/);
    for (const change of ["onReplyOpenChanged: stir()", "onHistoryOpenChanged: stir()", "onDraftChanged: stir()"])
        assert.ok(shared.includes(change), change);
    assert.match(shared, /onComposingChanged: \{\s*stir\(\);/);
    assert.match(shared, /drowsy: root\.drowsy/);
    // Hovering him or the box, and a file held over him.
    const window = read("AssistantWindow.qml");
    assert.match(window, /id: characterHover\s*onHoveredChanged: \{[\s\S]*?if \(hovered\) \{\s*Assistant\.stir\(\);/);
    assert.match(window, /id: dockHover\s*onHoveredChanged: Assistant\.stir\(\)/);
    assert.match(window, /onContainsDragChanged: \{\s*Assistant\.fileOver = containsDrag;\s*Assistant\.stir\(\);/);
});

test("the wisp works beside him only while work runs or waits behind him, and tucked right he faces left", () => {
    const shared = read("Common/Assistant.qml");
    // Never without the service: what it last said about its questions
    // stays in turn, side and queue, and an asleep Wiz draws nothing.
    assert.match(shared, /readonly property bool helper: connected && \(sideBusy \|\| queue !== null \|\| \(busy && !!turn\.routine\)\)/);
    assert.match(shared, /readonly property bool busy: connected && AssistantHelpers\.active\(turn\)/);
    assert.match(shared, /readonly property bool sideBusy: connected && AssistantHelpers\.active\(side\)/);
    assert.match(shared, /readonly property bool waiting: connected && turn !== null && turn\.status === "waiting"/);
    assert.match(shared, /readonly property int facing: Settings\.assistantTuck === "right" && !dragging \? -1 : 1/);
    const window = read("AssistantWindow.qml");
    assert.match(window, /Wiz \{\s*id: character[\s\S]*?helper: Assistant\.helper\s*facing: Assistant\.facing/);
    assert.match(read("shell.qml"), /helper: Assistant\.helper, facing: Assistant\.facing/);
    // The service runs a routine in the main lane, marked on the snapshot.
    assert.match(repo("desktop/assistant/cybexos_assistant/server.py"), /Routines \(routines\.py\) run in the main lane/);
});

test("readouts: elapsed time, home-relative paths and closure changes", () => {
    assert.equal(A.elapsedLabel(8400), "8 s");
    assert.equal(A.elapsedLabel(65000), "1 min 05 s");
    assert.equal(A.elapsedLabel(12 * 60000 + 5000), "12 min");
    assert.equal(A.displayPath("/home/cybex/.config/cybexos/shell.json", "/home/cybex"), "~/.config/cybexos/shell.json");
    assert.equal(A.displayPath("/home/nerdy/x", "/home/cybex"), "/home/nerdy/x");
    const changes = A.closureChanges([
        "obsidian: ∅ → 1.9.12, +148.2 MiB",
        "electron: ∅ → 37.2.4, +201.0 MiB",
        "firefox: 140.0 → 141.0, +1.2 MiB",
        "old-tool: 2.0 → ∅, -3.1 MiB",
        "not a change line"
    ].join("\n"), 3);
    assert.deepEqual(changes.rows.map(row => [row.name, row.kind]),
        [["obsidian", "added"], ["electron", "added"], ["firefox", "changed"]]);
    assert.equal(changes.more, 1);
    assert.deepEqual(A.closureChanges("", 5), { rows: [], more: 0 });
    assert.deepEqual(A.closureChanges("aws-lc: ∅ → 5.12.0, \u001b[31;1m5.1 MiB\u001b[0m\n"
        + "bruno: 4.0.0 → 4.3.0, \u001b[32;1m-14.6 MiB\u001b[0m", 5).rows,
        [{name: "aws-lc", change: "∅ → 5.12.0, 5.1 MiB", kind: "added"},
         {name: "bruno", change: "4.0.0 → 4.3.0, -14.6 MiB", kind: "changed"}]);
    assert.equal(A.errorAction("auth", "codex").auth, true);
    assert.equal(A.errorAction("crashed", "claude"), null);
    assert.equal(A.copyText({ text: "Done.\n\n" }), "Done.");
});

test("Super+I is one in-process shortcut: a tap types, a hold talks", () => {
    const shell = read("shell.qml");
    assert.match(shell, /GlobalShortcut \{\s*appid: "quickshell"\s*name: "assistantTalk"[\s\S]*?onPressed: Assistant\.shortcutPressed\(\)\s*onReleased: Assistant\.shortcutReleased\(\)/);
    const bindings = repo("desktop/hypr/bindings.lua");
    assert.match(bindings, /if features\.assistant then\s*bind\(mainMod \.\. " \+ I", hl\.dsp\.global\("quickshell:assistantTalk"\),\s*\{ description = "Shell: Assistant" \}, "shell.assistant"\)/);
    assert.match(repo("desktop/hypr/features.lua"), /assistant = os\.getenv\("CYBEXOS_ASSISTANT"\) ~= "0"/);
    const assistant = read("Common/Assistant.qml");
    assert.match(assistant, /interval: AssistantHelpers\.HOLD_MS/);
    assert.match(assistant, /function shortcutReleased\(\) \{\s*if \(holdTimer\.running\) \{\s*holdTimer\.stop\(\);[\s\S]*?toggleComposer\(\);/,
        "a release before the hold time is a tap");
    assert.match(assistant, /if \(shortcutHolding && listening && !voiceLatched\)\s*stopListening\(true\);/,
        "releasing a hold sends what was said");
    assert.ok(A.HOLD_MS >= 200 && A.HOLD_MS <= 400);
});

test("the shell is a client: the service owns turns and the shell reconciles with hello", () => {
    const assistant = read("Common/Assistant.qml");
    assert.match(assistant, /readonly property string socketPath: runtimeDir \+ "\/assistant\.sock"/);
    assert.match(assistant, /Socket \{\s*id: socket\s*path: root\.socketPath\s*parser: SplitParser/);
    assert.match(assistant, /onConnectionStateChanged: \{\s*root\.helloed = false;/);
    assert.match(assistant, /case "turn\.updated":\s*if \(params\.lane === "side"\)\s*adoptSide\(params\.turn\);\s*else\s*adopt\(params\.turn\);/);
    assert.match(assistant, /case "turn\.delta":/);
    assert.doesNotMatch(assistant, /Process \{[^}]*"claude"|"codex", "app-server"/,
        "the shell never runs an agent itself");
    // Voice: Voxtype writes the transcript to a file instead of typing it.
    assert.match(assistant, /record start --file="\$2"/);
    assert.match(assistant, /property: "assistantWatching"\s*value: root\.available/);
    // Screen context: hidden for the capture, one output, into the service's directory.
    assert.match(assistant, /exec grim -o "\$2" -l 6 "\$3"/);
    assert.match(assistant, /readonly property string scratchDir: runtimeDir \+ "\/assistant"/);
    assert.match(assistant, /if \(!Settings\.assistantScreenContext \|\| capturing/,
        "no screenshot unless screen context was switched on");
});

test("the overlay takes input only on the character and the box, and the keyboard only when asked", () => {
    const window = read("AssistantWindow.qml");
    assert.match(window, /WlrLayershell\.namespace: "qs-assistant"/);
    assert.match(window, /WlrLayershell\.layer: WlrLayer\.Overlay/);
    assert.match(window, /mask: Region \{\s*item: characterMask\s*Region \{\s*item: dockMask\s*\}\s*Region \{\s*item: pressMask/);
    // Faded, he takes no input at all, so clicks reach the window under him.
    assert.match(window, /id: characterMask[\s\S]*?width: root\.faded \? 0 : character\.width/);
    // A held button on the character takes the whole output until it comes
    // up, and a drag never changes the keyboard mode under it.
    assert.match(window, /id: pressMask\s*width: root\.pressing \? stage\.width : 0\s*height: root\.pressing \? stage\.height : 0/);
    for (const handler of ["onReleased", "onCanceled"])
        assert.match(window, new RegExp(handler + ": \\{\\s*root\\.pressing = false;"));
    assert.match(window, /readonly property bool dockShown: boxOpen && !dragging/);
    assert.match(window, /keyboardFocus: !root\.boxOpen \? WlrKeyboardFocus\.None\s*: root\.keyboardWanted && !grab\.active \? WlrKeyboardFocus\.Exclusive\s*: WlrKeyboardFocus\.OnDemand/);
    assert.match(window, /readonly property bool keyboardWanted: Assistant\.focusRequested/);
    assert.match(window, /HyprlandFocusGrab \{\s*id: grab/);
    assert.match(window, /Assistant\.openComposer\(false\)/, "hovering opens the box without the keyboard");
    assert.match(window, /opacity: Assistant\.capturing \? 0 : 1/);
    assert.match(read("shell.qml"), /LazyLoader \{\s*active: Assistant\.shown\s*AssistantWindow \{\}/);
    const look = repo("desktop/hypr/looknfeel.lua");
    const blur = look.match(/name = "quickshell-blur",[\s\S]*?namespace = \[\[([^\]]+)\]\]/);
    assert.doesNotMatch(blur[1], /assistant/, "a full-output surface must not be blurred");
});

test("shown, the character flies in from the top-right corner, never across from the left", () => {
    const window = read("AssistantWindow.qml");
    // Until the surface has its size he waits just past the top-right corner.
    assert.match(window, /bubbleX: dragging \? dragX : !entered \? root\.width\s*: tuck !== "" \? AssistantHelpers\.tuckedX\(tuck, root\.size, root\.width\) : resting\.x/);
    assert.match(window, /bubbleY: dragging \? dragY : entered \? resting\.y : -root\.size/);
    // Nothing animates before then, so a zero width cannot start a sweep.
    for (const axis of ["x", "y"])
        assert.match(window, new RegExp("Behavior on " + axis + " \\{\\s*enabled: root\\.settled && !root\\.dragging"));
    assert.match(window, /function enter\(\) \{\s*if \(entered \|\| !visible \|\| width <= 0 \|\| height <= 0\)\s*return;/);
    // The flight: animation on, then his place. Under the welcome guide, the
    // other way round, since its own Wiz makes the hop.
    assert.match(window, /if \(covered\) \{[^}]*entered = true;\s*settled = true;[^}]*\} else \{[^}]*settled = true;\s*entered = true;/);
    for (const handler of ["Component.onCompleted", "onWidthChanged", "onHeightChanged"])
        assert.match(window, new RegExp(handler.replace(".", "\\.") + ": Qt\\.callLater\\(root\\.enter\\)"));
});

test("the menubar button toggles the character on its own display and shows activity", () => {
    const module = read("Bar/Modules/Assistant.qml");
    assert.match(module, /moduleId: "assistant"/);
    assert.match(module, /onClicked: Assistant\.toggleShown\(root\.host \? root\.host\.outputName : ""\)/);
    assert.match(read("Bar/Bar.qml"), /case "assistant": return Settings\.assistantConfigured;/);
    assert.match(read("Bar/Bar.qml"), /assistant: "Modules\/Assistant\.qml"/);
    assert.ok(load("PanelRegistryData.js").PANEL_LESS_MODULES.includes("assistant"));
    assert.equal(load("WidgetCatalog.js").WIDGETS.assistant.glyph, "assistant");
});

test("the approval card never answers for the person", () => {
    const card = read("Assistant/AssistantApproval.qml");
    for (const decision of ["allow", "always", "deny"])
        assert.match(card, new RegExp(`Assistant\\.respond\\(root\\.approval\\.id, "${decision}"\\)`));
    assert.doesNotMatch(card, /Component\.onCompleted|Timer \{/, "no card answers itself");
    // A staged change is applied by the updater's own reviewed request.
    assert.match(read("Assistant/AssistantReply.qml"), /onTriggered: Assistant\.reviewStagedChange\(\)/);
    assert.doesNotMatch(read("Assistant/AssistantReply.qml"), /Updates\.apply\(\)/);
    assert.match(read("Assistant/AssistantReply.qml"),
        /Updates\.deployment\.transaction === turn\.staged/);
});

test("the installation feature carries the service, the agents and the menubar", () => {
    const options = repo("nix/modules/default.nix");
    assert.match(options, /assistant = mkOption \{ type = types\.bool; default = true; \};/);
    const desktop = repo("nix/modules/desktop.nix");
    assert.match(desktop, /CYBEXOS_ASSISTANT = if cfg\.features\.assistant then "1" else "0";/);
    assert.match(desktop, /systemd\.user\.services\.cybexos-assistant = lib\.mkIf cfg\.features\.assistant \{/);
    assert.match(desktop, /ExecStart = "\$\{assistant\}\/bin\/cybexos-assistant serve";/);
    // The running system's packages through the stable profile link, and no
    // restart by activation: an app install must not end an answer.
    assert.match(desktop, /path = \[ sessionPath \];[^}]*restartIfChanged = false;\s*serviceConfig = \{\s*ExecStart = "\$\{assistant\}/);
    const applications = repo("nix/modules/applications.nix");
    // The agentic OS always carries an agent CLI: Codex everywhere, and Claude
    // Code whenever unfree packages are allowed (it is unfree). Both are the
    // makers' own release builds that Cybex OS pins (nix/packages).
    assert.match(applications, /codexCli = pkgs\.callPackage \.\.\/packages\/codex \{\};/);
    assert.match(applications, /claudeCode = pkgs\.callPackage \.\.\/packages\/claude-code \{\};/);
    assert.match(applications, /# The agent CLIs are part of every installation\. Claude Code is unfree\.\s*codexCli\s*\]/);
    assert.match(applications, /lib\.optionals cfg\.features\.proprietary \[[^\]]*claudeCode \]/,
        "Claude Code is unfree: it still needs the proprietary feature");
    assert.match(applications, /lib\.optionals cfg\.features\.assistant \[ assistant \]/);
    // The installer offers no switch for it: every installation includes it.
    assert.match(repo("installer/cybexos-install"), /the assistant is always\s*# included/);
    assert.match(repo("lifecycle/cybexos/cli.py"), /PASSTHROUGH = \('agent', 'assistant', 'backup', 'report', 'doctor', 'plugin', 'shell', 'theme'\)/);
    assert.match(read("Common/Settings.qml"), /readonly property bool assistantConfigured:\s*Quickshell\.env\("CYBEXOS_ASSISTANT"\) !== "0"/);
});

test("conversation history: day headings, time labels and live status", () => {
    const now = new Date(2026, 10, 1, 14, 32).getTime();
    const minutes = n => now - n * 60000;
    const days = n => now - n * 24 * 3600000;
    assert.equal(A.historyGroup(minutes(5), now), "today");
    assert.equal(A.historyGroup(days(1), now), "yesterday");
    assert.equal(A.historyGroup(days(4), now), "week");
    assert.equal(A.historyGroup(days(9), now), "older");
    assert.deepEqual(A.historyTime(now - 20000, now), { kind: "now", value: 0 });
    assert.deepEqual(A.historyTime(minutes(2), now), { kind: "minutes", value: 2 });
    assert.equal(A.historyTime(minutes(180), now).kind, "time");
    assert.equal(A.historyTime(days(1), now).kind, "yesterday");
    assert.equal(A.historyTime(days(3), now).kind, "weekday");
    assert.equal(A.historyTime(days(30), now).kind, "date");
    const rows = [{ id: "a", updatedAt: minutes(1) }, { id: "b", updatedAt: minutes(90) },
        { id: "c", updatedAt: days(3) }, { id: "d", updatedAt: days(40) }];
    assert.deepEqual(A.groupConversations(rows, now).map(group => [group.group, group.rows.map(row => row.id)]),
        [["today", ["a", "b"]], ["week", ["c"]], ["older", ["d"]]], "empty headings are left out");
    const row = { id: "a", status: "completed" };
    assert.equal(A.liveStatus(row, { conversation: "a", status: "waiting" }), "waiting");
    assert.equal(A.liveStatus(row, { conversation: "b", status: "running" }), "completed");
    assert.equal(A.liveStatus(row, { conversation: "a", status: "failed" }), "completed",
        "a finished turn is the list's own status");
    assert.equal(A.RECENT_LIMIT, 3);
    assert.equal(A.conversationText({ turns: [{ prompt: "Hi", text: "Hello.\n" },
        { prompt: "Again", status: "failed", error: "Signed out" }] }), "> Hi\n\nHello.\n\n> Again\n\nSigned out");
});

test("a click opens a new conversation unless the last one still needs the person", () => {
    assert.equal(A.opensLastConversation({}), false);
    assert.equal(A.opensLastConversation({ busy: true }), true, "a question running or waiting");
    assert.equal(A.opensLastConversation({ unread: true, hasReply: true }), true, "an answer not seen");
    assert.equal(A.opensLastConversation({ unread: true, hasReply: false }), false);
    const assistant = read("Common/Assistant.qml");
    // A click, Super+I and the launcher open fresh; hovering opens the box as left.
    assert.match(assistant, /function openFresh\(withFocus\) \{[\s\S]*?if \(AssistantHelpers\.opensLastConversation\(\{ busy: busy, unread: unread, hasReply: hasReply \}\)\) \{[\s\S]*?return;\s*\}\s*startNew\(\);\s*openComposer\(withFocus\);/);
    assert.match(assistant, /else\s*openFresh\(true\);\s*\}\s*\/\/ Continues the conversation of the answer on screen\./,
        "characterClicked opens fresh when the box is closed");
    assert.match(assistant, /function toggleComposer\(\) \{[\s\S]*?else\s*openFresh\(true\);\s*\}/);
    assert.match(assistant, /function ask\(text\) \{[\s\S]*?startNew\(\);/);
    const window = read("AssistantWindow.qml");
    assert.match(window, /id: rest[\s\S]*?Settings\.assistantHover === "open"[\s\S]*?Assistant\.openComposer\(false\)/);
    assert.doesNotMatch(window, /Assistant\.(?:startNew|openFresh)\(/, "hovering never resets the conversation");
    // The question names the conversation it continues; "" starts a new one.
    assert.match(assistant, /conversation: continued,/);
    assert.match(assistant, /case "conversations\.updated":\s*adoptConversations\(params\.conversations \|\| \[\]\);/);
    // History is a box view, closed by a click elsewhere, with the keyboard for its search.
    assert.match(window, /readonly property bool showHistory: Assistant\.historyOpen/);
    assert.match(window, /showComposer \|\| showHistory \|\| showWorking\)/);
    assert.match(window, /Assistant\.focusLost\(\);/);
    // Clearing asks first; deleting one offers Undo.
    const history = read("Assistant/AssistantHistory.qml");
    assert.match(history, /onTriggered: Assistant\.confirmingClear = true/);
    assert.match(history, /objectName: "assistantClearHistory"[\s\S]*?onTriggered: Assistant\.clearHistory\(\)/);
    assert.match(history, /onTriggered: Assistant\.undoDelete\(\)/);
    // A list cut by the box's room fades at its cut edge (2026-11-24 review).
    assert.match(history, /EdgeFade \{ anchors\.bottom: parent\.bottom; shown: listFlick\.contentY \+ listFlick\.height < listFlick\.contentHeight - 1 \}/);
    assert.match(history, /EdgeFade \{ anchors\.top: parent\.top; shown: listFlick\.contentY > 1; fromTop: true \}/);
    assert.match(read("Settings/AssistantPage.qml"), /settingKey: "assistantHistory"/);
    assert.match(repo("desktop/assistant/cybexos_assistant/history.py"), /RETENTION = \("month", "forever", "session"\)/);
});

test("the box keeps one family of corners and keyboard-only focus rings", () => {
    // 2026-11-24 review: one card mixed 16, 12, 10, 9, 7 and pill corners.
    const surface = read("Assistant/AssistantSurface.qml");
    assert.match(surface, /radius: Theme\.panelRadius/);
    assert.match(surface, /readonly property int innerRadius: Theme\.concentricRadius\(radius, padding\)/);
    for (const name of ["AssistantComposer", "AssistantHistory", "AssistantReply", "AssistantWorking", "AssistantApproval",
        "AssistantChanges", "AssistantConversationRow", "AssistantModelPicker", "AssistantAgentButton", "AssistantMarkdown",
        "AssistantFailure"]) {
        const source = read(`Assistant/${name}.qml`);
        assert.doesNotMatch(source, /radius: Theme\.scaled\(/, `${name} takes its corner from Theme`);
        assert.doesNotMatch(source, /radius: height \/ 2/, `${name} has no pills`);
    }
    assert.match(read("AssistantWindow.qml"), /FocusModalityObserver \{\}/);
    assert.match(read("Assistant/AssistantConversationRow.qml"),
        /color: root\.hovered \|\| root\.activeFocus && FocusModality\.keyboard \? Theme\.chipHover : "transparent"/);
});
