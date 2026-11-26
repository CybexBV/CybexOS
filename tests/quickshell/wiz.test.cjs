// Wiz, the assistant's character (docs/assistant.md): the rig in
// Common/WizRig.js, the layers scripts/export-wiz builds from it, and the
// rules that keep Assistant/Wiz.qml cheap on a full-output overlay.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { shellDir, load } = require("./shell.cjs");

const W = load("WizRig.js");
const root = path.resolve(shellDir, "../..");
const layersDir = path.join(shellDir, "assets/wiz");
const stillsDir = path.join(root, "assets/wiz");
const read = relative => fs.readFileSync(path.join(shellDir, relative), "utf8");
const wiz = read("Assistant/Wiz.qml");
const art = read("Common/WizArt.qml");
// The code alone: the comments explain what it avoids, by name.
const uncommented = source => source.replace(/^\s*\/\/.*$/gm, "");
const code = uncommented(wiz), artCode = uncommented(art);

// The whole of each QML block that `opening` begins, braces matched, and
// where it is.
function spans(source, opening) {
    const found = [];
    for (const match of source.matchAll(new RegExp(opening.source + " \\{", "g"))) {
        let depth = 0, end = match.index + match[0].length - 1;
        do {
            if (source[end] === "{") depth++;
            else if (source[end] === "}") depth--;
            end++;
        } while (depth > 0);
        found.push({ start: match.index, end, text: source.slice(match.index, end) });
    }
    return found;
}
function blocks(source, opening) {
    return spans(source, opening).map(span => span.text);
}

// ---- what Wiz.qml's animations move, read from the file itself --------------
const MOVES = { X: "x", Y: "y", Rotation: "rotation", Scale: "scale", Opacity: "opacity" };
const ANIMATION = /\b(?:SequentialAnimation|ParallelAnimation|(?:X|Y|Rotation|Scale|Opacity)Animator|NumberAnimation|Sine[XYR]|Wave|Nudge|Nod)(?: on \w+)?/;

// Wiz.qml's own animation components, each with what it moves of the item
// its user hands it: [parameter, property]. A wave is an Animator and moves
// its `target`; a nudge, a nod and an arm's wave move what their Animators
// name through the component's id.
function movers(source) {
    const found = {};
    for (const body of blocks(source, /component \w+: \w+/)) {
        const [, name, base, id] = body.match(/^component (\w+): (\w+) \{\s*(?:id: (\w+))?/);
        const own = base.match(/^(X|Y|Rotation|Scale|Opacity)Animator$/);
        const handed = own ? [["target", MOVES[own[1]]]]
            : [...body.matchAll(/(X|Y|Rotation|Scale|Opacity)Animator \{ target: (\w+)\.(\w+);/g)]
                .filter(match => match[2] === id).map(match => [match[3], MOVES[match[1]]]);
        if (handed.length)
            found[name] = handed.filter((pair, at) => handed.findIndex(other => String(other) === String(pair)) === at);
    }
    return found;
}

// Every [item, property] the animations in `source` move.
function moved(source, components) {
    const pairs = [];
    for (const [, kind, item] of source.matchAll(/\b(X|Y|Rotation|Scale|Opacity)Animator \{\s*(?:id: \w+;?\s*)?target: (\w+)[;\n]/g))
        pairs.push([item, MOVES[kind]]);
    for (const [name, handed] of Object.entries(components))
        for (const use of blocks(source, new RegExp(`\\b${name}`)))
            for (const [parameter, property] of handed) {
                const item = use.match(new RegExp(`\\b${parameter}: (\\w+)[;\\n ]`));
                if (item)
                    pairs.push([item[1], property]);
            }
    return pairs;
}

// The animations that stand on their own: not a step of another one, and
// not inside a component, whose animations go with each thing made of it.
function animations(source) {
    const within = (inner, outers) => outers.some(outer => outer.start < inner.start && inner.end <= outer.end);
    const all = spans(source, ANIMATION), parts = spans(source, /component \w+: \w+/);
    return all.filter(span => !within(span, all) && !within(span, parts))
        .map(span => ({ ...span, id: (span.text.match(/^[\w ]+\{\s*id: (\w+)/) || [])[1] || "" }));
}

// A function's body, and a piece of script with the functions it calls
// written out (one level: stopNod() and the like).
function body(source, name) {
    const found = blocks(source, new RegExp(`function ${name}\\([^)]*\\)`))[0];
    return found ? found.slice(found.indexOf("{") + 1, found.lastIndexOf("}")) : "";
}
function unfolded(source, script) {
    return script.replace(/\b(\w+)\(\);/g, (call, name) => call + body(source, name));
}

const STATES = ["idle", "drowsy", "listening", "thinking", "working", "reading", "searching", "writing", "casting",
    "brewing", "delegating", "needs-input", "pointing", "finished", "proud", "happy", "greeting", "shrug", "sorry",
    "curious", "asleep", "carried"];

test("every state has a complete pose", () => {
    assert.deepEqual(W.STATES, STATES);
    const keys = Object.keys(W.POSES.idle).sort();
    assert.deepEqual(Object.keys(W.POSES).sort(), [...W.STATES].sort());
    assert.deepEqual(Object.keys(W.META).sort(), [...W.STATES].sort());
    for (const state of W.STATES) {
        assert.deepEqual(Object.keys(W.POSES[state]).sort(), keys, state);
        for (const key of keys)
            assert.ok(Number.isFinite(W.POSES[state][key]), `${state}.${key}`);
    }
    // Wiz.qml reads every key; one it ignored would be a silent no-op.
    for (const key of keys)
        assert.match(wiz, new RegExp(`stance\\.${key}\\b`), key);
    // Other surfaces pass "working" for work of no particular kind: it is casting.
    assert.deepEqual(W.POSES.working, W.POSES.casting);
    assert.deepEqual(W.META.working, W.META.casting);
    assert.match(code, /readonly property bool casting: act === "casting" \|\| act === "working"/);
});

test("the committed pictures are exactly what the rig exports", () => {
    const names = Object.keys(W.LAYERS);
    assert.deepEqual(fs.readdirSync(layersDir).filter(name => name.endsWith(".svg")).sort(),
        names.map(name => `${name}.svg`).sort());
    for (const name of names)
        assert.equal(fs.readFileSync(path.join(layersDir, `${name}.svg`), "utf8"), W.layerSVG(name),
            `assets/wiz/${name}.svg is stale; run scripts/export-wiz`);
    // Every pose at rest but the carried one, which only a drag shows.
    const stills = W.STATES.filter(state => state !== "carried");
    assert.deepEqual(fs.readdirSync(stillsDir).filter(name => name.endsWith(".svg")).sort(),
        stills.map(state => `${state}.svg`).sort());
    for (const state of stills)
        assert.equal(fs.readFileSync(path.join(stillsDir, `${state}.svg`), "utf8"), W.stillSVG(state),
            `assets/wiz/${state}.svg is stale; run scripts/export-wiz`);
    const check = spawnSync(path.join(root, "scripts/export-wiz"), ["--check"], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
});

test("the rig loads before QML has its globals", () => {
    // Qt 6.11 can run an imported script's top level before Math exists (a
    // component's first instance in a Repeater); the rig must not need it then.
    const context = { Math: undefined };
    vm.runInNewContext(fs.readFileSync(path.join(shellDir, "Common/WizRig.js"), "utf8") + "\nthis.loaded = WizRig;", context);
    assert.deepEqual(Object.keys(context.loaded.LAYERS), Object.keys(W.LAYERS));
    assert.deepEqual(Array.from(context.loaded.STATES), STATES);
});

test("the accent's pictures are made once per accent and shared", () => {
    assert.match(artCode, /readonly property string accent: wiz\.colour\(Theme\.accent\.toString\(\)\)/);
    assert.match(artCode, /readonly property bool tinted: accent !== wiz\.COLORS\.magic/);
    assert.match(artCode, /readonly property var sources: tinted \? pictures\(accent\) : \(\{\}\)/);
    assert.match(artCode, /if \(wiz\.LAYERS\[name\]\.accent\)\s*made\[name\] = url\(wiz\.layerSVG\(name, \{ accent: colour, scale: scale \}\)\);/);
    assert.match(artCode, /return "data:image\/svg\+xml;utf8," \+ encodeURIComponent\(svg\);/);
    // Image draws an SVG handed over as data at the size asked only when
    // that is smaller than the picture's own: the largest Wiz is 140 px at
    // three device pixels to one, 10.5 pixels a unit.
    const scale = Number(artCode.match(/readonly property int scale: (\d+)/)[1]);
    assert.ok(scale >= 16, `pictures are made at ${scale} pixels a unit`);
    assert.match(code, /source: WizArt\.sources\[name\] \|\| Qt\.resolvedUrl\("\.\.\/assets\/wiz\/" \+ name \+ "\.svg"\)/);
    // The old picture stays until the new one is drawn.
    assert.equal(code.match(/retainWhileLoading: true/g).length, 2);
    // The rig is loaded once, for every Wiz and every part of him: a script a
    // component imports is loaded again for each instance, inline ones included.
    assert.match(artCode, /import "WizRig\.js" as Rig/);
    assert.match(artCode, /readonly property var wiz: Rig\.WizRig/);
    assert.match(code, /readonly property var wiz: WizArt\.wiz/);
    assert.match(read("Common/qmldir"), /^singleton WizArt WizArt\.qml$/m);
    const importers = [];
    (function scan(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) scan(file);
            else if (entry.name.endsWith(".qml") && /WizRig\.js/.test(uncommented(fs.readFileSync(file, "utf8"))))
                importers.push(path.relative(shellDir, file));
        }
    })(shellDir);
    assert.deepEqual(importers, ["Common/WizArt.qml"]);
});

test("Wiz.qml draws every exported layer and no other", () => {
    const named = new Set([...code.matchAll(/(?:name|art): "([a-z0-9-]+)"(?=\s*(?:$|;|\}))/gm)].map(match => match[1]));
    if (/art: "rune" \+ rune\.index/.test(code) && /art: "rune" \+ frontRune\.index/.test(code))
        for (let i = 0; i < 4; i++)
            named.add(`rune${i}`);
    assert.deepEqual([...named].sort(), Object.keys(W.LAYERS).sort());
    // A thing he works with is placed about the point its layer names.
    for (const [, around] of code.matchAll(/around: "([a-z-]+)"/g))
        assert.ok(Array.isArray(W.LAYERS[around].at), around);
    // Each layer is drawn once at the device size it is shown at.
    assert.match(wiz, /sourceSize: Qt\.size\(Math\.ceil\(box\[2\] \* root\.pixels\), Math\.ceil\(box\[3\] \* root\.pixels\)\)/);
    assert.match(wiz, /readonly property real pixels: unit \* Math\.max\(1, Math\.ceil\(Screen\.devicePixelRatio\)\)/);
    assert.match(code, /readonly property var box: root\.wiz\.LAYERS\[name\]\.box\s*x: box\[0\]\s*y: box\[1\]\s*width: box\[2\]\s*height: box\[3\]/);
});

test("nothing is painted or scripted per frame", () => {
    for (const source of [code, artCode])
        for (const costly of [/\bCanvas\b/, /\bFrameAnimation\b/, /requestPaint/, /layer\.enabled/,
            /\bShaderEffect\b/, /\bMultiEffect\b/, /\bAnimatedSprite\b/, /\bParticleSystem\b/,
            /ScriptAction/, /PathAnimation/, /\bShape\b/, /\bclip: true/])
            assert.doesNotMatch(source, costly);
    // The rig supplies tables and the drag's arithmetic at runtime. It draws
    // only in WizArt, when the accent or the progress changes.
    assert.doesNotMatch(code + artCode, /WizRig\.create|\.create\(|\.ops\(|\.update\(|toSVG|stillSVG|stillOps|layerOps/);
    assert.doesNotMatch(code, /layerSVG|arcSVG|WizArt\.pictures/);
    assert.equal(artCode.match(/layerSVG|arcSVG/g).length, 2);
    assert.equal(code.match(/WizArt\.arc\(/g).length, 1);
    // A repeating Timer may wake a still Wiz for a blink, a glance, a wobble,
    // a pulse or a bead of sweat; each must stop with the rest of him. The
    // others fire once: the end of a drag's motion, of a dizzy spell, and of
    // the mess a drag made.
    assert.doesNotMatch(artCode, /\bTimer\b|Animation|Animator/);
    const timers = [...code.matchAll(/Timer \{([\s\S]*?)\n    \}/g)].map(match => match[1]);
    assert.equal(timers.length, 8);
    assert.equal(code.match(/\bTimer \{/g).length, 8, "every Timer is one of these");
    for (const body of timers) {
        if (/repeat: true/.test(body))
            assert.match(body, /running: (?:root\.live && |root\.act === "needs-input"\n)/, body);
        else
            assert.match(body, /id: (?:calm|recover|tidy)\b/, body);
    }
});

test("loops run only while live and busy, and Wiz holds still otherwise", () => {
    assert.match(wiz, /readonly property bool live: animated && visible/);
    assert.match(wiz, /readonly property bool busy: light === "busy"/);
    assert.match(wiz, /readonly property bool looping: live && \(busy \|\| \(pose === "listening" && recording\)\)/);
    // `act` names the pose whose motion runs. Only settle() and resume() set
    // it, and resume() only while he may move, so a loop gated on it is live.
    assert.deepEqual(code.match(/\bact = [^;]+;/g), ['act = "";', "act = pose;"]);
    assert.match(code, /function settle\(\) \{\s*act = "";/);
    assert.match(code, /function resume\(\) \{\s*if \(!live \|\| act !== ""\)\s*return;\s*act = pose;\s*gesture\(\);\s*if \(!looping\)\s*return;/);
    // Each infinite loop is gated on a live-derived condition, or is a wave,
    // which runs as its user says.
    const loops = [...wiz.matchAll(/(component Sine[XYR]: )?(?:SequentialAnimation|ParallelAnimation|[XY]Animator|RotationAnimator|ScaleAnimator)(?: on \w+)? \{\s*(?:id: \w+\s*)?(?:running: ([^\n]+)\s*)?loops: Animation\.Infinite/g)];
    assert.equal(loops.length, (code.match(/Animation\.Infinite/g) || []).length,
        "every infinite loop is in the shape this contract reads");
    const gate = /^(?:root\.live && [^\n]+|root\.act === "[a-z-]+"(?: && root\.recording)?|root\.casting|root\.busy && root\.act !== ""|(?:orbiter|mote|bubble|spell)\.running(?: && orbiter\.front)?)$/;
    assert.equal(loops.filter(([, wave]) => wave).length, 3, "SineX, SineY and SineR");
    for (const [source, wave, running] of loops) {
        if (wave)
            continue;
        assert.ok(running, `an infinite loop without a running condition: ${source}`);
        assert.match(running, gate, source);
    }
    // A wave runs on a live-derived condition too, but for the two that
    // resume() starts, and only while he is looping.
    const waves = [...code.matchAll(/^ *Sine[XYR] \{([^}]*)\}/gm)].map(match => match[1]);
    assert.ok(waves.length >= 20, `${waves.length} waves`);
    const started = [];
    for (const body of waves) {
        const running = body.match(/running: ([^;\n]+)/);
        if (running)
            assert.match(running[1], gate, body);
        else
            started.push(body.match(/id: (\w+);/)[1]);
    }
    assert.deepEqual(started, ["breathing", "swaying"]);
    assert.match(code, /if \(!looping\)\s*return;\s*breathDepth = [^;]+;\s*swayReach = [^;]+;\s*breathing\.start\(\);\s*swaying\.start\(\);\s*\}/);
    assert.match(code, /function settle\(\) \{\s*act = "";\s*breathing\.stop\(\);\s*swaying\.stop\(\);/);
    // Each kind of work moves in its own way, and only as that pose.
    for (const state of ["thinking", "reading", "searching", "writing", "brewing", "delegating", "carried"])
        assert.match(code, new RegExp(`running: root\\.act === "${state}"`), state);
    assert.match(code, /running: root\.act === "listening" && root\.recording/);
    // An orbiter runs as its user says: runes while thinking, stars while dizzy.
    const orbiters = [...code.matchAll(/delegate: Orbiter \{([\s\S]*?)\n\s*\}/g)].map(match => match[1]);
    assert.equal(orbiters.length, 4);
    for (const body of orbiters)
        assert.match(body, /running: root\.live && root\.(?:runes > 0\.02|dizziness > 0\.01)/, body);
    assert.match(wiz, /readonly property bool running: root\.live && visible/);
    assert.match(code, /delegate: Mote \{\s*running: spell\.running/);
    assert.match(code, /running: root\.live && cauldron\.visible/);
    assert.match(wiz, /onLoopingChanged: settle\(\)/);
    assert.match(code, /Component\.onCompleted: \{[^}]*\bresume\(\);\s*\}/, "a Wiz created mid-turn starts his loops");
    // A change of pose brings his hands, his eyes and his hat to rest first.
    assert.match(code, /onPoseChanged: \{[^}]*settle\(\);/);
    const settling = code.slice(code.indexOf("id: settling"), code.indexOf("onFinished: root.resume()"));
    for (const item of ["breath", "leftAct", "rightAct", "leftSleeveAct", "rightSleeveAct", "scan", "sway", "leftSwing",
        "rightSwing", "leftSleeveSwing", "rightSleeveSwing", "wandSwing", "dimmer"])
        assert.match(settling, new RegExp(`target: ${item}; to: 0;`), item);
    // A waiting question pulses three times, then only as a reminder.
    assert.match(wiz, /interval: root\.pulses < 3 \? 1111 : 8000/);
    // What a pose does once as it arrives is short.
    for (const id of ["greeting", "cheering", "shrugging", "wringing", "peering", "jabbing"]) {
        assert.match(code, new RegExp(`case "[a-z]+": ${id}\\.restart\\(\\); break;`), id);
        assert.match(code, new RegExp(`${id}\\.stop\\(\\);`), id);
    }
    assert.equal(code.match(/loops: [1-5]\b/g).length, 9, "each gesture ends after a few goes");
    // Pose changes snap when Wiz may not move.
    const behaviors = [...wiz.matchAll(/Behavior on \w+ \{\s*enabled: ([^;\n]+)/g)].map(match => match[1]);
    assert.ok(behaviors.length >= 40);
    for (const enabled of behaviors)
        assert.equal(enabled.trim(), "root.animated");
    // Without motion everything a loop moved goes back to where it rests.
    assert.match(code, /\} else \{\s*settling\.stop\(\);\s*breath\.y = 0;\s*dimmer\.opacity = 0;\s*for \(const item of shifted\) \{\s*item\.x = 0;\s*item\.y = 0;\s*\}\s*for \(const item of turned\)\s*item\.rotation = 0;/);
    assert.match(code, /onLiveChanged: \{[\s\S]*settle\(\);\s*\}/);
});

// Measured in Quickshell (Qt 6.12): stopping an Animator finishes it too, so
// its onFinished runs. settle() used to restart the settling animation, and a
// pose that also ends his work (proud, a shrug, sorry) settles twice at once:
// the second restart ended the first, which resumed him, and the new one
// resumed him again 300 ms later, his gesture starting over. A Wiz made live
// (the launcher's curious one, the notes popover's pointing one) settled
// while he was being made and resumed twice the same way.
test("what a pose does as it arrives starts once", () => {
    // Only the end of a settling and his own completion resume him.
    assert.equal(code.match(/\bresume\(\)/g).length, 3);
    assert.match(code, /id: settling[\s\S]*?onFinished: root\.resume\(\)\s*\}/);
    // A settling on its way is left to end; it is never started over.
    assert.match(body(code, "settle"), /if \(animated\) \{\s*if \(!settling\.running\)\s*settling\.start\(\);\s*\} else \{/);
    assert.doesNotMatch(code, /settling\.restart\(\)/);
    // And resume() does its work once for each settle(), whoever calls it.
    assert.match(code, /function settle\(\) \{\s*act = "";/);
    assert.match(code, /function resume\(\) \{\s*if \(!live \|\| act !== ""\)\s*return;\s*act = pose;\s*gesture\(\);/);
    assert.equal(code.match(/\bgesture\(\)/g).length, 2, "gesture() is called from resume() alone");
    // Made live, he starts at once: the settling begun meanwhile is ended first.
    assert.match(code, /Component\.onCompleted: \{[^}]*settling\.stop\(\);\s*resume\(\);\s*\}/);
});

// How long an animation block runs once: the steps of a sequence one after
// another, of anything else side by side.
function lasts(body) {
    const inner = body.slice(body.indexOf("{") + 1, body.lastIndexOf("}"));
    const steps = [];
    for (let at = 0, depth = 0, start = -1; at < inner.length; at++) {
        if (inner[at] === "{" && depth++ === 0)
            start = inner.lastIndexOf("\n", at) + 1;
        else if (inner[at] === "}" && --depth === 0 && /^\s*\w+(?:Animation|Animator) \{/.test(inner.slice(start, at + 1)))
            steps.push(lasts(inner.slice(start, at + 1).trim()));
    }
    if (!steps.length)
        return Number((inner.match(/duration: (\d+)/) || [0, 0])[1]);
    return /^SequentialAnimation/.test(body) ? steps.reduce((sum, step) => sum + step, 0) : Math.max(...steps);
}

test("what only some poses or moments show is made for them and let go", () => {
    // Every Loader is one of these, on while its part shows or fades.
    const made = blocks(code, /Loader/).map(body =>
        body.match(/^Loader \{\s*(?:id: \w+\s*)?(?:readonly property real light: [^\n]+\s*)?active: ([^\n]+)\s*sourceComponent: /));
    assert.ok(made.every(Boolean), "a Loader without a condition and a component of its own");
    assert.deepEqual(made.map(match => match[1]).sort(), [
        "root.feet > 0.02",                                     // his legs, and their kick
        "light > 0.01",                                         // light from below
        "root.dizziness > 0.01", "root.dizziness > 0.01", "root.dizziness > 0.01",  // spiral eyes; stars behind and in front
        "root.runes > 0.02", "root.runes > 0.02",               // runes behind the cone and in front
        "root.progress >= 0",                                   // the ring and its arc
        "root.pot > 0.02", "root.book > 0.02", "root.orb > 0.02", "root.scroll > 0.02",
        "root.wand > 0.05", "root.spell > 0.02", "root.scroll > 0.3", "root.point > 0.02",  // wand, spell, quill, finger
        "root.wisp > 0.02", "root.zzz > 0.02",
        "root.festive",                                         // sparkles
        "root.fuss", "root.fuss"                                // dust; "?!" and sweat
    ].sort());
    assert.match(code, /readonly property real light: Math\.max\(root\.book \* 0\.7, root\.orb, root\.pot \* 0\.8\)/);
    // What is left is what every pose shows, and nothing a pose adds.
    const drawing = code.slice(code.indexOf("id: rig"), code.indexOf("readonly property int filled"));
    let always = drawing;
    for (const body of blocks(drawing, /Loader/))
        always = always.replace(body, "");
    const names = new Set([...always.matchAll(/name: "([a-z0-9-]+)"/g)].map(match => match[1]));
    assert.deepEqual([...names].sort(), ["body", "boot", "brim", "cape", "cone", "eye", "eye-happy", "glow", "hand", "hand-open",
        "shadow", "star-ask", "star-bad", "star-lit", "star-off", "star-rest", "thread"]);
    assert.equal(always.match(/\bSleeve \{/g).length, 2);
    assert.doesNotMatch(always, /\b(?:Orbiter|Drop|Puff|Mote|Bubble|Sparkle|Sparkles|Prop|Wand|Spell|Dust|Panic|Repeater) \{(?![^{}]*model: (?:root\.layout\.feet|\[-1, 1\]))/,
        "only his feet and his eyes are repeated outside a Loader");
    // The star's five lights are all kept: one must be there the moment another goes.
    assert.match(code, /component Shine: Part \{/);
    // A loop that moves something outside its part stops before the part
    // goes: the kick ends with the drag, the leg only once it has faded.
    assert.match(code, /Behavior on feet \{\s*enabled: root\.animated\s*NumberAnimation \{ duration: 220;/);
    // What moves with a part is in it: the orb's bob, the wisp's float, the spell.
    assert.match(blocks(code, /sourceComponent: Prop/).find(body => /around: "orb"/.test(body)), /SineY \{\s*target: orbBob\s*running: root\.act === "searching"/);
    assert.match(blocks(code, /component Wand: Item/)[0], /name: "wand-tip"\s*visible: root\.spell <= 0\.02\s*\}\s*Loader \{\s*active: root\.spell > 0\.02\s*sourceComponent: Spell \{\}/);

    // The sparkles of a finished turn. `festive` is set as the pose changes,
    // before sparkle() wants them, and when he is made in that pose.
    assert.match(code, /onPoseChanged: \{[^}]*festive = pose === "finished" \|\| pose === "proud";\s*settle\(\);[^}]*if \(festive\)\s*sparkle\(\);\s*\}/);
    assert.match(code, /Component\.onCompleted: \{\s*festive = pose === "finished" \|\| pose === "proud";[^}]*\bresume\(\);\s*\}/);
    assert.deepEqual(code.match(/\bfestive = [^;]+;/g), Array(2).fill('festive = pose === "finished" || pose === "proud";'));
    assert.match(code, /function sparkle\(\) \{\s*\(sparkles\.item as Sparkles\)\?\.flare\(\);\s*\}/);
    const sparkles = blocks(code, /component Sparkles: Item/)[0];
    assert.match(sparkles, /model: root\.live \? root\.layout\.sparks : \[\]\s*delegate: Sparkle \{\s*burst: true/);
    assert.match(sparkles, /model: root\.live \? \[\] : root\.layout\.sparks\s*delegate: Sparkle \{\}/);

    // What a drag throws about: there from the grab, a landing or a bead of
    // sweat until two seconds after he is down, longer than any of it lasts.
    assert.match(code, /function startle\(\) \{[^}]*fuss = true;\s*tidy\.stop\(\);\s*\(panic\.item as Panic\)\?\.startle\(\);\s*\}/);
    assert.match(code, /function land\(sweat\) \{[^}]*fuss = true;\s*tidy\.restart\(\);\s*\(dust\.item as Dust\)\?\.burst\(\);\s*if \(sweat !== false\)\s*\(panic\.item as Panic\)\?\.slide\(\);\s*\}/);
    assert.match(code, /onTriggered: \{\s*root\.fuss = true;\s*\(panic\.item as Panic\)\?\.drip\(root\.drips\);\s*root\.drips\+\+;\s*\}/);
    assert.match(code, /calm\.stop\(\);\s*tidy\.restart\(\);/, "a drag that ends without a landing is tidied too");
    // Gone again two seconds after he is down, or at once when he may no longer move.
    assert.deepEqual(code.match(/\bfuss = [^;\n]+/g).sort(), ["fuss = false", "fuss = false", "fuss = true", "fuss = true", "fuss = true"]);
    const tidy = Number(code.match(/id: tidy\s*interval: (\d+)\s*onTriggered: root\.fuss = false/)[1]);
    const thrown = [blocks(code, /component Drop: Item/)[0], blocks(code, /component Puff: Item/)[0], blocks(code, /component Panic: Item/)[0]];
    const effects = thrown.flatMap(body => blocks(body, /(?:Sequential|Parallel)Animation/).filter(animation => /^\w+ \{\s*id: /.test(animation)));
    assert.deepEqual(effects.map(body => body.match(/id: (\w+)/)[1]), ["flying", "sliding", "puffing", "shouting"]);
    assert.deepEqual(effects.map(lasts), [620, 1150, 520, 920]);
    for (const body of effects)
        assert.ok(lasts(body) < tidy, body.match(/id: (\w+)/)[1]);
    // They move only what is theirs, so letting them go leaves nothing askew.
    for (const body of effects)
        for (const [, target] of body.matchAll(/target: (\w+);/g))
            assert.ok(["bead", "cloud", "shout"].includes(target), target);
});

// Reduced motion, the power saver or an unattended session take `animated`
// away at any moment. Measured in Quickshell (Qt 6.12): complete() does not
// end an Animator, alone or in a group, it runs on to its end; stop() ends it
// at once. So whatever plays once is stopped there, and nothing built of
// Animators is ever completed.
test("when he may no longer move, nothing ticks on", () => {
    const off = code.match(/onLiveChanged: \{\s*if \(!live\) \{([\s\S]*?)\n        \}\s*settle\(\);\s*\}/)[1];
    const ended = unfolded(code, off), settled = body(code, "settle");
    const named = animations(code).filter(animation => animation.id !== "");
    assert.ok(named.length >= 20, `${named.length} animations with a name`);
    for (const { id, text } of named) {
        if (/Animator \{|\b(?:Sine[XYR]|Wave|Nudge|Nod) \{/.test(text)) {
            assert.doesNotMatch(code, new RegExp(`\\b${id}\\.complete\\(\\)`), `${id} is built of Animators: complete() leaves it running`);
            if (id === "settling")
                continue;
            assert.ok(settled.includes(`${id}.stop();`) || ended.includes(`${id}.stop();`), `${id} is stopped when he may no longer move`);
        } else {
            assert.ok(ended.includes(`${id}.complete();`), `${id} is completed when he may no longer move`);
        }
    }
    // settle() runs last: it stops the loops and the gestures, and puts his
    // hands and hat back at once instead of easing them.
    assert.match(settled, /if \(animated\) \{\s*if \(!settling\.running\)\s*settling\.start\(\);\s*\} else \{\s*settling\.stop\(\);/);
    // What a drag threw about goes with its part, and he is not dizzy.
    for (const step of ["tidy.stop();", "fuss = false;", "dizzy = false;", "ux = 0;", "uy = 0;"])
        assert.ok(off.includes(step), step);
    const thrown = spans(code, /Loader/).filter(loader => /active: root\.fuss/.test(loader.text));
    assert.equal(thrown.length, 2);
    // Every other loop is gated on `live` (the loops' own test), and a still
    // sparkle replaces the bursting ones.
    assert.match(code, /model: root\.live \? root\.layout\.sparks : \[\]/);
});

test("carried, he reacts only while live and always comes back to rest", () => {
    assert.match(code, /readonly property bool carried: pose === "carried"/);
    assert.match(code, /onDragPointChanged: \{\s*if \(carried && live\)\s*follow\(\);/);
    assert.match(code, /if \(carried\) \{\s*tracker = null;\s*recover\.stop\(\);\s*if \(live\)\s*startle\(\);/);
    assert.match(code, /\} else \{\s*impact = Math\.min\(1, 0\.35 \+ 0\.65 \* Math\.sqrt\(ux \* ux \+ uy \* uy\)\);[\s\S]{0,80}ux = 0;\s*uy = 0;\s*if \(live\)\s*land\(\);\s*if \(dizzy\)\s*recover\.restart\(\);/);
    // His hands flail and are left a little behind; his feet kick.
    for (const hand of ["leftAct", "rightAct"])
        assert.equal(code.match(new RegExp(`Sine[XY] \\{ target: ${hand}; running: root\\.act === "carried";`, "g")).length, 2, hand);
    assert.match(code, /readonly property point leftReach: Qt\.point\(\(lx - layout\.shoulders\[0\]\[0\]\) \* arms \+ reaction\.handX,/);
    assert.match(code, /SineR \{\s*target: kick\s*running: root\.live && root\.carried\s*reach: 16\s*period: 480\s*phase: leg\.phase\s*onRunningChanged: \{\s*if \(!running\)\s*kick\.rotation = 0;\s*\}\s*\}/);
    // Every one-shot ends where it began.
    for (const id of ["startling", "landing"]) {
        const start = code.indexOf(`id: ${id}`);
        const block = code.slice(start, code.indexOf("\n    }\n", start));
        const last = block.slice(block.lastIndexOf("ParallelAnimation {"));
        for (const property of ["thudX", "thudY"])
            assert.match(last, new RegExp(`property: "${property}"; to: 1;`), `${id} ${property}`);
    }
    assert.match(code, /property: "squint"; to: 1;/);
    assert.match(code, /property: "crook"; to: 0; duration: 160/);
    assert.match(code, /YAnimator \{ target: hatNod; from: -root\.hop; to: 0;/);
    assert.match(code, /onStopped: breath\.x = 0/);
    // Reduced motion or an idle session ends a drag's motion at once.
    const off = code.slice(code.indexOf("onLiveChanged: {"));
    for (const step of ["startling.complete()", "landing.complete()", "hopping.stop()", "crooking.complete()", "dizzy = false"])
        assert.ok(off.includes(step), step);

    // ---- every item, not a list kept by hand ----------------------------------
    // Measured in Quickshell (Qt 6.12): an Animator that stops leaves its
    // item where it was, alone or as the last step of a sequence, and only
    // an earlier step of a sequence falls back to where the item stood. His
    // boots stayed turned after every drag that way. So each [item,
    // property] an Animator anywhere in the file moves is read from the
    // file, and each one that stays for good must be put back.
    const components = movers(code);
    assert.deepEqual(Object.keys(components).sort(), ["Nod", "Nudge", "SineR", "SineX", "SineY", "Wave"]);
    const ids = text => [...text.matchAll(/\bid: (\w+)/g)].map(match => match[1]);
    const drawing = code.slice(code.indexOf("id: rig"), code.indexOf("readonly property int filled"));
    let always = drawing;
    for (const part of blocks(drawing, /Loader/))
        always = always.replace(part, "");
    // What every pose shows stays; what a Loader or a component makes goes
    // with its part, and takes what its own animations did with it.
    const stays = new Set(ids(always));
    const goes = new Set([...blocks(code, /Loader/), ...blocks(code, /component \w+: \w+/)].flatMap(ids));
    const pairs = moved(code, components);
    assert.ok(pairs.length >= 110, `${pairs.length} moves read from the file`);
    for (const [item] of pairs)
        assert.ok(stays.has(item) || goes.has(item), `${item} is animated, and is part of neither every pose nor one made for a pose`);
    for (const on of spans(code, /Animat(?:ion|or) on \w+/))
        assert.ok(spans(code, /Loader/).concat(spans(code, /component \w+: \w+/)).some(part => part.start < on.start && on.end <= part.end),
            "an animation on its own item is part of something made for a pose");
    const key = pair => pair.join(".");

    // settle() brings most to rest: eased by `settling` while he may move,
    // at once otherwise. Whatever one does, the other does too.
    const settling = blocks(code, /ParallelAnimation/).find(text => /^ParallelAnimation \{\s*id: settling/.test(text));
    const eased = new Set(moved(settling, {}).map(key));
    assert.equal(settling.match(/Animator \{ target: \w+; to: 0; duration: 300; easing\.type: Easing\.OutCubic \}/g).length, eased.size);
    const listed = name => code.match(new RegExp(`readonly property list<Item> ${name}: \\[([^\\]]+)\\]`))[1].split(", ");
    const still = body(code, "settle").match(/\} else \{([\s\S]*)\}/)[1];
    const atOnce = new Set([...listed("shifted").flatMap(item => [`${item}.x`, `${item}.y`]),
        ...listed("turned").map(item => `${item}.rotation`),
        ...[...still.matchAll(/\b(\w+)\.(\w+) = 0;/g)].filter(match => match[1] !== "item").map(match => `${match[1]}.${match[2]}`)]);
    for (const pair of eased)
        assert.ok(atOnce.has(pair), `${pair} is eased back, and put back at once when he may not move`);

    // The rest look after themselves, each where it stops.
    const KIND = { x: "X", y: "Y", rotation: "Rotation", scale: "Scale", opacity: "Opacity" };
    const lastStep = (text, target, property) => [...text.matchAll(
        new RegExp(`${KIND[property]}Animator \\{[^{}]*?target: ${target}[;\\n][^{}]*`, "g"))].pop();
    const own = [];
    for (const animation of animations(code)) {
        const loose = moved(animation.text, components).filter(pair => stays.has(pair[0]) && !eased.has(key(pair)));
        const endless = /^[\w ]+\{[^{}]*loops: Animation\.Infinite/.test(animation.text) || /^Sine[XYR] /.test(animation.text);
        for (const [item, property] of loose) {
            own.push(key([item, property]));
            const back = `\\b${item}\\.${property} = 0\\b`;
            if (endless) {
                // A loop: put back as it stops.
                assert.match(animation.text, new RegExp(`on(?:RunningChanged|Stopped): [^]*?${back}`),
                    `the loop that moves ${item}.${property} puts it back as it stops`);
                continue;
            }
            // It plays once: it ends where the item rests, or puts it back
            // as it finishes; whoever stops it puts the item back in the
            // same breath; and nobody completes it, which would do nothing.
            assert.ok(animation.id, `what moves ${item}.${property} has a name to stop it by`);
            const direct = lastStep(animation.text, item, property);
            const handed = Object.entries(components).flatMap(([name, moves]) => moves
                .filter(([parameter, moves]) => moves === property && new RegExp(`\\b${name} \\{[^{}]*\\b${parameter}: ${item}\\b`).test(animation.text))
                .map(([parameter]) => {
                    const component = blocks(code, new RegExp(`component ${name}: \\w+`))[0];
                    return lastStep(component, `${component.match(/\{\s*id: (\w+)/)[1]}\\.${parameter}`, property);
                }));
            const last = direct || handed[0];
            assert.ok(last, `${animation.id} moves ${item}.${property} with an Animator this test can read`);
            assert.ok(/\bto: 0[;\n]/.test(last[0]) || new RegExp(`onFinished: [^]*?${back}`).test(animation.text),
                `${animation.id} leaves ${item}.${property} at rest when it ends`);
            for (const [, after] of code.matchAll(new RegExp(`\\b${animation.id}\\.stop\\(\\);((?:\\s*\\w+\\.\\w+ = 0;)*)`, "g")))
                assert.match(after, new RegExp(back), `${animation.id}.stop() puts ${item}.${property} back`);
            assert.doesNotMatch(code, new RegExp(`\\b${animation.id}\\.complete\\(\\)`));
        }
    }
    // These are the ones: the tremble, the kick, and what plays once.
    assert.deepEqual([...new Set(own)].sort(), ["bodyNod.y", "breath.x", "dart.x", "eyesNod.y", "hatNod.y", "kick.rotation",
        "star.rotation", "twirl.rotation"]);
    // Everything that stays and is moved is covered by one way or the other.
    for (const pair of pairs.filter(([item]) => stays.has(item)))
        assert.ok(eased.has(key(pair)) || own.includes(key(pair)), key(pair));
    // A grab stops the nod and a landing the startled glance.
    assert.match(code, /\n    function startle\(\) \{\s*stopNod\(\);/);
    assert.match(code, /\n    function land\(sweat\) \{\s*startling\.stop\(\);\s*stopGlance\(\);/);
});

// In the shell an asleep Wiz draws nothing, so his z's stand still. The
// welcome guide's Connect step used to float z's of its own over him as the
// cue that he sleeps until an account is connected; his own now rise there,
// and only there.
test("asleep, his z's stand still, and rise only where he is asked to snore", () => {
    assert.match(code, /^    property bool snoring: false$/m);
    // Still: the rig's three, each where it draws them.
    const zed = blocks(code, /component Zed: Item/)[0];
    assert.match(zed, /required property int index\s*property int place: index \+ 1\s*readonly property var here: root\.drift\(place\)\s*x: here\[0\]\s*y: here\[1\]\s*scale: here\[2\]\s*opacity: here\[3\]/);
    assert.doesNotMatch(zed, /Animat|Timer/);
    const drift = new Function("layout", "place", body(code, "drift"));
    const row = W.LAYOUT.zzz;
    assert.equal(row.length, 3);
    for (let place = 1; place <= 3; place++)
        assert.deepEqual(drift(W.LAYOUT, place), row[place - 1], `place ${place}`);
    // One place more beyond each end of the row: as far again, faded out.
    const below = drift(W.LAYOUT, 0), above = drift(W.LAYOUT, 4);
    assert.deepEqual([below[3], above[3]], [0, 0]);
    assert.ok(below[1] > row[0][1] && below[2] < row[0][2] && above[1] < row[2][1] && above[2] > row[2][2]);
    for (const at of [0, 1, 2]) {
        assert.ok(Math.abs(row[0][at] - below[at] - (row[1][at] - row[0][at])) < 1e-9);
        assert.ok(Math.abs(above[at] - row[2][at] - (row[2][at] - row[1][at])) < 1e-9);
    }
    // Snoring: each rises to the next one's place and one more waits below
    // the first, so after a step the row looks as it did and the step loops.
    const snore = blocks(code, /component Snore: Zed/)[0];
    assert.match(snore, /readonly property var next: root\.drift\(place \+ 1\)/);
    assert.match(snore, /\n\s*place: index\n/);
    assert.match(snore, /ParallelAnimation \{\s*running: root\.live && root\.snoring\s*loops: Animation\.Infinite/);
    for (const [kind, at] of [["X", 0], ["Y", 1], ["Scale", 2], ["Opacity", 3]])
        assert.match(snore, new RegExp(`${kind}Animator \\{ target: snore; from: snore\\.here\\[${at}\\]; to: snore\\.next\\[${at}\\]; duration: snore\\.span \\}`), kind);
    assert.equal(snore.match(/Animator \{/g).length, 4);
    assert.doesNotMatch(snore, /NumberAnimation|Timer|ScriptAction|easing/);
    // At the rig's pace: its z rises the whole way, four places, at 0.28 a second.
    assert.ok(Math.abs(4 * Number(snore.match(/readonly property int span: (\d+)/)[1]) - 1000 / 0.28) < 5);
    // When he may not move they stand where the still ones do: an Animator
    // leaves its item where it stopped.
    assert.match(snore, /onRunningChanged: \{\s*if \(running\)\s*return;\s*snore\.x = snore\.here\[0\];\s*snore\.y = snore\.here\[1\];\s*snore\.scale = snore\.here\[2\];\s*snore\.opacity = snore\.here\[3\];\s*\}/);
    // Made with the pose, the rising ones only for a Wiz asked to snore.
    assert.match(code, /active: root\.zzz > 0\.02\s*sourceComponent: Item \{\s*opacity: root\.zzz\s*Repeater \{\s*model: root\.layout\.zzz\.length \+ \(root\.snoring \? 1 : 0\)\s*delegate: root\.snoring \? drifting : standing/);
    assert.match(code, /Component \{\s*id: standing\s*Zed \{\}\s*\}\s*Component \{\s*id: drifting\s*Snore \{\}\s*\}/);
    // Only the welcome guide's Connect step asks.
    const askers = [];
    (function scan(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) scan(file);
            else if (entry.name.endsWith(".qml") && /\bsnoring:/.test(uncommented(fs.readFileSync(file, "utf8"))))
                askers.push(path.relative(shellDir, file));
        }
    })(shellDir);
    assert.deepEqual(askers.sort(), ["Assistant/Wiz.qml", "Welcome/ConnectStep.qml"]);
});

test("Wiz is the only character and holds still with reduced motion or nobody there", () => {
    assert.match(read("Assistant/Wiz.qml"), /property bool animated: !Theme\.reducedMotion && !Activity\.idle/);
    assert.match(read("Assistant/qmldir"), /^Wiz Wiz\.qml$/m);
    assert.doesNotMatch(read("Assistant/qmldir"), /AssistantCharacter/);

    const window = read("AssistantWindow.qml");
    assert.match(window, /readonly property real size: Assistant\.characterSize/);
    assert.match(window, /Wiz \{\n\s*id: character/);
    assert.match(window, /pose: Assistant\.pose/);
    assert.match(window, /recording: Assistant\.listening/);
    // Once per pointer move, both coordinates at once; Wiz swings himself.
    assert.match(window, /root\.dragY = [^\n]+\n\s*root\.dragPoint = Qt\.point\(root\.dragX, root\.dragY\);/);
    assert.match(window, /grab: Qt\.point\(root\.pressWindow\.x - root\.pressBubble\.x, root\.pressWindow\.y - root\.pressBubble\.y\)/);
    assert.doesNotMatch(window, /rotation: root\.dragging/);
    assert.match(read("shell.qml"), /size: Assistant\.characterSize/);
    assert.match(read("Common/Assistant.qml"), /readonly property real characterSize: Theme\.scaled\(88\)/);
    // What every surface that shows him already sets keeps working.
    for (const property of ["pose", "level", "recording", "hovered", "unread", "boxAbove", "lookX", "lookY", "dragPoint", "grab", "animated"])
        assert.match(code, new RegExp(`^    property \\w+ ${property}:`, "m"), property);
    assert.match(code, /function arrive\(\) \{\s*if \(!live\)\s*return;\s*impact = 0\.5;\s*land\(false\);/);
    assert.match(code, /function land\(sweat\) \{/);
});
