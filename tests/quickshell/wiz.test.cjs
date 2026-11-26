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
const leaves = ops => ops.filter(op => op.k === "path" || op.k === "radial");

// The whole of each QML block that `opening` begins, braces matched.
function blocks(source, opening) {
    const found = [];
    for (const match of source.matchAll(new RegExp(opening.source + " \\{", "g"))) {
        let depth = 0, end = match.index + match[0].length - 1;
        do {
            if (source[end] === "{") depth++;
            else if (source[end] === "}") depth--;
            end++;
        } while (depth > 0);
        found.push(source.slice(match.index, end));
    }
    return found;
}

// The matrix m followed by one of the rig's transform steps.
function then(m, step) {
    let n;
    if (step[0] === "t") n = [1, 0, 0, 1, step[1], step[2]];
    else if (step[0] === "s") n = [step[1], 0, 0, step[2], 0, 0];
    else {
        const a = step[1] * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), x = step[2], y = step[3];
        n = [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y];
    }
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

// What a draw list paints, as [x0, y0, x1, y1]. Control points bound a
// curve; a stroke and three blur deviations bound its paint.
function painted(ops) {
    const stack = [[1, 0, 0, 1, 0, 0]], box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const op of ops) {
        if (op.k === "g") stack.push(op.t.reduce(then, stack[stack.length - 1]));
        else if (op.k === "end") stack.pop();
        else {
            const m = stack[stack.length - 1], scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
            const points = [];
            let margin = 0;
            if (op.k === "radial") {
                for (const sx of [-1, 1])
                    for (const sy of [-1, 1])
                        points.push([op.cx + sx * op.r, op.cy + sy * op.r * op.sy]);
            } else {
                margin = ((op.stroke ? (op.lw || 1) / 2 : 0) + (op.glow ? 3 * op.glow.s : 0)) * scale;
                for (const segment of op.d)
                    for (let i = 1; i + 1 < segment.length; i += 2)
                        points.push([segment[i], segment[i + 1]]);
            }
            for (const [px, py] of points) {
                const x = m[0] * px + m[2] * py + m[4], y = m[1] * px + m[3] * py + m[5];
                box[0] = Math.min(box[0], x - margin);
                box[1] = Math.min(box[1], y - margin);
                box[2] = Math.max(box[2], x + margin);
                box[3] = Math.max(box[3], y + margin);
            }
        }
    }
    return box;
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

test("each pose shows what the design gives it", () => {
    const P = W.POSES;
    // Hands show at rest and are tucked in when he dozes or sleeps.
    assert.equal(P.idle.arms, 1);
    assert.deepEqual([P.drowsy.arms, P.asleep.arms], [0, 0]);
    // Each kind of work has its own thing.
    const holds = { reading: "book", searching: "orb", writing: "scroll", brewing: "pot", delegating: "wisp" };
    for (const [state, thing] of Object.entries(holds))
        for (const other of ["book", "orb", "scroll", "pot", "wisp"])
            assert.equal(P[state][other], other === thing ? 1 : 0, `${state} ${other}`);
    for (const state of ["casting", "working", "brewing", "pointing"])
        assert.equal(P[state].wand, 1, state);
    assert.deepEqual([P.casting.spell, P.thinking.runes, P.asleep.zzz], [1, 1, 1]);
    // Eyelids and the brow carry the feeling.
    assert.ok(P.drowsy.lid > 0.4 && P.sorry.brow < 0 && P.casting.brow > 0 && P.curious.big === 1);
    // A raised hand for a question, a thumb for a job well done, open hands to wave or shrug.
    assert.ok(P["needs-input"].ry < 70 && P["needs-input"].rx > 90);
    assert.deepEqual([P.proud.point, P.proud.pointA], [1, -90]);
    for (const state of ["greeting", "shrug", "curious", "delegating", "carried"])
        assert.equal(P[state].palms, 1, state);
    assert.equal(P.carried.feet, 1);
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

test("each layer holds its drawing, strokes and glow included", () => {
    for (const [name, layer] of Object.entries(W.LAYERS)) {
        const ops = W.layerOps(name);
        assert.ok(leaves(ops).length > 0, `${name} draws nothing`);
        assert.match(W.layerSVG(name), /<path|<ellipse/, `${name}.svg is empty`);
        if (layer.first)
            assert.equal(leaves(ops).length, layer.first, `${name} keeps its first ${layer.first}`);
        // A local layer lies about its own origin, without the groups around it.
        if (layer.local)
            assert.deepEqual(ops, leaves(ops), `${name} is local`);
        const [x, y, width, height] = W.layerBox(name), [x0, y0, x1, y1] = painted(ops);
        assert.ok(x0 >= x - 1e-6 && y0 >= y - 1e-6 && x1 <= x + width + 1e-6 && y1 <= y + height + 1e-6,
            `${name} spills out of its box: it paints ${[x0, y0, x1, y1].map(v => v.toFixed(2))}`);
    }
});

test("every still pose fits the box they all share", () => {
    // Pictures swapped in place line up because every pose is drawn in one box.
    assert.deepEqual(W.STILL_BOX, [-8, -12, 136, 132]);
    const [x, y, width, height] = W.STILL_BOX;
    for (const state of W.STATES) {
        const [x0, y0, x1, y1] = painted(W.stillOps(state));
        assert.ok(x0 >= x && y0 >= y && x1 <= x + width && y1 <= y + height,
            `${state} leaves the still box: it paints ${[x0, y0, x1, y1].map(v => v.toFixed(2))}`);
        assert.match(W.stillSVG(state), new RegExp(`viewBox="${W.STILL_BOX.join(" ")}"`), state);
    }
});

// Nothing painted over the cloak may thin or cross its outline: the face
// comes before it, and the cape, which covers the outline where his arms
// leave the body, has an outline of its own.
test("the cloak's outline stays whole around the face, and the cape covers his shoulders", () => {
    const body = leaves(W.layerOps("body"));
    const outline = body.find(op => op.stroke === W.COLORS.edge && !op.fill);
    assert.ok(outline, "the body layer draws the cloak's outline");
    const face = body.find(op => op.fill === W.COLORS.face);
    assert.ok(face && body.indexOf(face) < body.indexOf(outline), "the face comes before the outline");
    assert.deepEqual(outline.d, body[0].d, "the outline is the cloak's own shape");
    const cape = leaves(W.layerOps("cape"));
    const fill = cape.findIndex(op => op.fill === W.COLORS.cape), edge = cape.findIndex(op => op.stroke === W.COLORS.capeEdge);
    assert.ok(fill >= 0 && edge > fill, "the cape draws its outline over its own fill");
    assert.deepEqual(cape[edge].d, cape[fill].d);
    // In every pose: sleeves under the cape, his hands over everything he holds.
    for (const state of W.STATES) {
        const order = leaves(W.stillOps(state)).map(op => op.layer);
        if (order.includes("sleeve"))
            assert.ok(Math.max(order.lastIndexOf("sleeve"), order.lastIndexOf("cuff")) < order.indexOf("cape"), `${state}: sleeves under the cape`);
        if (order.includes("hand")) {
            for (const held of ["pot", "bubble", "book", "orb", "orb-shine", "scroll", "scroll-line", "wand", "spell-core", "quill"])
                assert.ok(order.lastIndexOf(held) < order.indexOf("hand"), `${state}: his hands over the ${held}`);
            // The finger he points with, or the thumb he raises, is under its own hand.
            assert.ok(order.lastIndexOf("finger") < order.lastIndexOf("hand"), `${state}: the hand over its finger`);
        }
    }
});

// The hat band sits on the cone and sways with it, under the cone's outline.
test("the hat band moves with the cone and stays inside its outline", () => {
    assert.ok(!("band" in W.LAYERS), "the band is part of the cone layer");
    const cone = leaves(W.layerOps("cone")), last = cone[cone.length - 1];
    assert.ok(last.stroke && !last.fill, "the cone layer ends with its outline");
    assert.deepEqual(last.d, cone[0].d, "the outline is the cone's own shape");
    assert.ok(cone.some(op => op.fill === "#DC1E37"), "the red Cybex band is in the cone layer");
});

test("the rig loads before QML has its globals", () => {
    // Qt 6.11 can run an imported script's top level before Math exists (a
    // component's first instance in a Repeater); the rig must not need it then.
    const context = { Math: undefined };
    vm.runInNewContext(fs.readFileSync(path.join(shellDir, "Common/WizRig.js"), "utf8") + "\nthis.loaded = WizRig;", context);
    assert.deepEqual(Object.keys(context.loaded.LAYERS), Object.keys(W.LAYERS));
    assert.deepEqual(Array.from(context.loaded.STATES), STATES);
});

test("the star on his hat is his one status light", () => {
    const lights = {
        rest: ["idle", "drowsy", "shrug", "carried"],
        busy: ["thinking", "working", "reading", "searching", "writing", "casting", "brewing", "delegating"],
        ready: ["listening", "pointing", "finished", "proud", "happy", "greeting", "curious"],
        ask: ["needs-input"], bad: ["sorry"], off: ["asleep"]
    };
    assert.deepEqual(Object.keys(lights).sort(), Object.keys(W.LIGHT).sort());
    assert.deepEqual(Object.values(lights).flat().sort(), [...W.STATES].sort());
    for (const [light, states] of Object.entries(lights))
        for (const state of states) {
            assert.equal(W.META[state].light, light, state);
            // A reply not yet seen lights a resting star; it changes no other.
            assert.equal(W.light(state, true), light === "rest" ? "ready" : light, state);
            assert.equal(W.light(state, false), light, state);
        }
    assert.equal(W.light("nonsense", false), "rest");
    // It twinkles while he works and pulses while he waits; otherwise it is steady.
    assert.deepEqual(Object.entries(W.LIGHT).map(([name, light]) => [name, light.beat]),
        [["rest", "none"], ["busy", "twinkle"], ["ready", "none"], ["ask", "pulse"], ["bad", "none"], ["off", "none"]]);
    // Amber for your move, red for a failure, the magic colour at work or with a reply, dark asleep.
    const star = (state, opts) => leaves(W.stillOps(state, opts)).filter(op => op.layer === "star");
    const lit = state => star(state).find(op => op.k === "path").stroke;
    assert.equal(lit("needs-input"), W.COLORS.amber);
    assert.equal(lit("sorry"), "#FF5D73");
    for (const state of [...lights.busy, ...lights.ready])
        assert.equal(lit(state), W.COLORS.magic, state);
    assert.equal(star("idle", { unread: true }).find(op => op.k === "path").stroke, W.COLORS.magic);
    assert.ok(star("idle").some(op => op.k === "radial"), "a resting star still glows a little");
    assert.ok(!star("asleep").some(op => op.k === "radial" || op.glow), "asleep, it is dark");
    assert.ok(W.LIGHT.rest.k < 0.5 && W.LIGHT.off.k === 0 && W.LIGHT.busy.k === 1);
    // It replaces the amber and the blue pip.
    for (const gone of ["pip", "pip-ring", "unread"])
        assert.ok(!(gone in W.LAYERS), gone);
    for (const name of ["star-rest", "star-lit", "star-ask", "star-bad", "star-off"])
        assert.equal(W.LAYERS[name].tag, "star", name);
    assert.match(code, /readonly property string light: wiz\.light\(pose, unread\)/);
    assert.match(code, /readonly property string shine: light === "busy" \|\| light === "ready" \? "lit" : light/);
    for (const light of ["rest", "lit", "ask", "bad", "off"])
        assert.match(code, new RegExp(`Shine \\{ name: "star-${light}"; light: "${light}" \\}`));
});

test("a ring round the star fills as a job gets on", () => {
    const layers = opts => new Set(leaves(W.stillOps("brewing", opts)).map(op => op.layer));
    assert.ok(!layers({}).has("ring"), "no ring without progress");
    assert.ok(layers({ progress: 0 }).has("ring") && !layers({ progress: 0 }).has("ring-arc"));
    assert.ok(layers({ progress: 0.5 }).has("ring-arc"));
    // The arc alone, in the ring's box, in the colour of the star's light.
    assert.doesNotMatch(W.arcSVG(0, { light: "busy" }), /<path/);
    const half = W.arcSVG(0.5, { light: "busy" }), full = W.arcSVG(1, { light: "busy" });
    assert.match(half, new RegExp(`viewBox="${W.layerBox("ring").join(" ")}"`));
    assert.match(half, new RegExp(`stroke="${W.COLORS.magic}"`));
    assert.match(W.arcSVG(0.5, { light: "ask" }), new RegExp(`stroke="${W.COLORS.amber}"`));
    assert.match(W.arcSVG(0.5, { light: "busy", accent: "#34D399" }), /stroke="#34D399"/);
    assert.ok(full.length > half.length, "a longer arc for more progress");
    // Wiz.qml draws the arc again only when the progress moves a sixtieth.
    assert.match(code, /property real progress: -1/);
    assert.match(code, /readonly property int filled: Math\.round\(Math\.min\(1, progress\) \* 60\)/);
    assert.match(code, /active: root\.progress >= 0\s*sourceComponent: Part \{\s*name: "ring"\s*Image \{[^}]*source: WizArt\.arc\(root\.filled, root\.light\)/);
    assert.match(artCode, /function arc\(sixtieths, light\) \{\s*return url\(wiz\.arcSVG\(sixtieths \/ 60, \{ light: light, accent: accent, scale: scale \}\)\);/);
});

test("magic takes the accent, and only magic does", () => {
    const pink = "#F472B6", blue = W.COLORS.magic;
    assert.equal(blue, "#4FA3F7", "the pictures' own colour is Cybex blue");
    const tinted = Object.keys(W.LAYERS).filter(name => W.LAYERS[name].accent).sort();
    assert.deepEqual(tinted, ["bubble", "orb", "pot", "rune0", "rune1", "rune2", "rune3", "scroll-line", "sparkle",
        "spell-core", "spell-glow", "spell-ring", "star-lit", "underlight", "wand-tip", "wisp"]);
    for (const name of Object.keys(W.LAYERS)) {
        const own = W.layerSVG(name), other = W.layerSVG(name, { accent: pink });
        if (W.LAYERS[name].accent) {
            assert.notEqual(other, own, `${name} takes the accent`);
            assert.doesNotMatch(other, new RegExp(blue), `${name} keeps no blue`);
        } else {
            assert.equal(other, own, `${name} has no magic in it`);
        }
    }
    // A whole pose: the magic changes, his eyes stay ice-white, amber and red stay.
    for (const state of W.STATES) {
        const still = W.stillSVG(state, { accent: pink });
        assert.doesNotMatch(still, new RegExp(blue), state);
        if (state !== "asleep")
            assert.match(still, /fill="#EEF6FF"[^>]*filter/, `${state}: glowing ice-white eyes`);
        assert.match(still, /flood-color="#78BEFF"|asleep/, state);
    }
    assert.match(W.stillSVG("needs-input", { accent: pink }), /#F5B83D/);
    assert.match(W.stillSVG("sorry", { accent: pink }), /#FF5D73/);
    assert.match(W.stillSVG("casting", { accent: pink }), new RegExp(pink));
    // Still pictures (terminal, notifications, installer) are in Cybex blue.
    assert.match(W.stillSVG("thinking"), new RegExp(blue));
    // What a theme hands over becomes "#RRGGBB"; anything else is Cybex blue.
    assert.equal(W.colour("#f472b6"), pink);
    assert.equal(W.colour("#fff"), "#FFFFFF");
    assert.equal(W.colour("#80f472b6"), pink);
    for (const bad of ["", null, undefined, "pink", "#12345"])
        assert.equal(W.colour(bad), blue);
    // A bigger picture of its own for the shell to scale down: the same drawing.
    assert.match(W.layerSVG("rune0", { scale: 24 }), /width="432" height="432" viewBox="-9 -9 18 18"/);
    assert.equal(W.layerSVG("rune0", { scale: 24 }).replace(/width="432" height="432"/, 'width="18" height="18"'), W.layerSVG("rune0"));
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
    assert.match(code, /function resume\(\) \{\s*if \(!live\)\s*return;\s*act = pose;\s*gesture\(\);\s*if \(!looping\)\s*return;/);
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

// Qt's SineCurve is (1 - cos 2πt) / 2 and its CosineCurve (1 + sin 2πt) / 2
// (QEasingCurve), so one Animator between the two ends of a wave's reach is
// the rig's sine, where four eased quarter steps were before.
test("a wave is one Animator, and the same motion as the rig's sine", () => {
    const body = name => code.match(new RegExp(`function ${name}\\(([^)]*)\\) \\{\\s*return ([^;]+);\\s*\\}`));
    const cosine = JSON.parse(code.match(/readonly property var cosine: (\[[^\]]+\])/)[1]);
    const Easing = {
        SineCurve: t => (Math.sin(t * 2 * Math.PI - Math.PI / 2) + 1) / 2,
        CosineCurve: t => (Math.cos(t * 2 * Math.PI - Math.PI / 2) + 1) / 2
    };
    const [wave, far, curve] = ["wave", "far", "curve"].map(name =>
        new Function("cosine", "Easing", ...body(name)[1].split(", "), `return ${body(name)[2]};`).bind(null, cosine, Easing));
    const middle = 61, reach = 32;
    for (let phase = 0; phase < 4; phase++) {
        const from = middle + far(phase) * reach, to = middle - far(phase) * reach;
        const at = t => from + (to - from) * curve(phase)(t);
        // Where the rig's sine is at each quarter, and in between.
        for (let step = 0; step <= 4; step++)
            assert.ok(Math.abs(at(step / 4) - wave(step, phase, middle, reach)) < 1e-9, `phase ${phase}, quarter ${step}`);
        for (let i = 0; i <= 64; i++)
            assert.ok(Math.abs(at(i / 64) - (middle + reach * Math.cos(2 * Math.PI * i / 64 + phase * Math.PI / 2))) < 1e-9,
                `phase ${phase} at ${i}/64`);
    }
    for (const [name, animator] of [["SineX", "XAnimator"], ["SineY", "YAnimator"], ["SineR", "RotationAnimator"]])
        assert.match(code, new RegExp(`component ${name}: ${animator} \\{\\s*loops: Animation\\.Infinite\\s*property real reach: 1\\s*`
            + `property int period: 1000\\s*property int phase: 0\\s*from: root\\.far\\(phase\\) \\* reach\\s*to: -from\\s*`
            + `duration: period\\s*easing\\.type: root\\.curve\\(phase\\)\\s*\\}`), name);
    // An orbiter goes round on three of them, a quarter apart, and its place
    // in front of or behind the cone changes on the same quarters.
    const orbiter = blocks(code, /component Orbiter: Item/)[0];
    assert.match(orbiter, /XAnimator on x \{\s*running: orbiter\.running\s*loops: Animation\.Infinite\s*from: orbiter\.orbit\.cx \+ root\.far\(orbiter\.index\) \* orbiter\.orbit\.rx\s*to: orbiter\.orbit\.cx - root\.far\(orbiter\.index\) \* orbiter\.orbit\.rx\s*duration: 4 \* orbiter\.quarter\s*easing\.type: root\.curve\(orbiter\.index\)/);
    assert.match(orbiter, /YAnimator on y \{\s*running: orbiter\.running\s*loops: Animation\.Infinite\s*from: orbiter\.orbit\.cy \+ root\.far\(orbiter\.lag\) \* orbiter\.orbit\.ry\s*to: orbiter\.orbit\.cy - root\.far\(orbiter\.lag\) \* orbiter\.orbit\.ry\s*duration: 4 \* orbiter\.quarter\s*easing\.type: root\.curve\(orbiter\.lag\)/);
    assert.match(orbiter, /ScaleAnimator on scale \{\s*running: orbiter\.running\s*loops: Animation\.Infinite\s*from: \(0\.82 \+ root\.far\(orbiter\.lag\) \* 0\.22\) \* orbiter\.size\s*to: \(0\.82 - root\.far\(orbiter\.lag\) \* 0\.22\) \* orbiter\.size\s*duration: 4 \* orbiter\.quarter\s*easing\.type: root\.curve\(orbiter\.lag\)/);
    assert.match(orbiter, /readonly property int lag: \(index \+ 3\) % 4/);
    assert.equal(orbiter.match(/OpacityAnimator \{ from: orbiter\.near\(\d\); to: orbiter\.near\(\d\); duration: orbiter\.quarter \}/g).length, 4);
    // Where it stands when it may not move is the wave's start.
    assert.match(orbiter, /x: root\.wave\(0, index, orbit\.cx, orbit\.rx\)\s*y: root\.wave\(0, lag, orbit\.cy, orbit\.ry\)\s*scale: root\.wave\(0, lag, 0\.82 \* size, 0\.22 \* size\)/);
    assert.equal(code.match(/root\.wave\(/g).length, 3, "no wave is stepped through quarter by quarter any more");
    // Breathing and the sway start in the middle and go out first, as before.
    assert.match(code, /SineY \{ id: breathing; target: breath; reach: root\.breathDepth; period: 2992; phase: 3 \}/);
    assert.match(code, /SineR \{ id: swaying; target: sway; reach: root\.swayReach; period: 4488; phase: 3 \}/);
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
    assert.match(code, /Component\.onCompleted: \{\s*festive = pose === "finished" \|\| pose === "proud";\s*resume\(\);\s*\}/);
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
    assert.deepEqual(code.match(/\bfuss = [^;\n]+/g).sort(), ["fuss = false", "fuss = true", "fuss = true", "fuss = true"]);
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

test("the star swings once on a change of pose; it twinkles and turns only at work", () => {
    const swinging = code.slice(code.indexOf("id: swinging"), code.indexOf("\n    }\n", code.indexOf("id: swinging")));
    assert.equal(swinging.match(/RotationAnimator \{ target: star;/g).length, 2);
    assert.match(swinging, /from: 16; to: 0;[^\n]*Easing\.OutElastic/);
    assert.doesNotMatch(swinging, /loops/);
    assert.match(code, /onPoseChanged: \{[^}]*if \(!live\)\s*return;\s*swinging\.restart\(\);/);
    // The twinkle is the dim star showing through the lit one.
    assert.match(code, /running: root\.busy && root\.act !== ""\s*loops: Animation\.Infinite\s*OpacityAnimator \{ target: dimmer;/);
    // A quarter turn of a four-pointed star looks like none, so it can stop there.
    assert.match(code, /id: twirling\s*running: root\.live && root\.busy\s*loops: Animation\.Infinite\s*alwaysRunToEnd: true\s*target: twirl\s*from: 0\s*to: 90/);
    assert.match(code, /twirling\.complete\(\);/);
});

test("a drag's velocity follows the pointer, restarting after a pause", () => {
    const C = W.CARRY;
    let s = W.follow(null, 100, 100, 1000);
    assert.equal(s.vx, 0, "a grab starts from rest");
    for (let t = 1016; t <= 1600; t += 16)
        s = W.follow(s, 100 + (t - 1000) * 1.2, 100, t);
    assert.ok(Math.abs(s.vx - 1200) < 1 && s.vy === 0, `a steady 1200 px/s drag reads ${s.vx}`);
    const close = W.follow(s, s.x + 50, s.y, s.at + C.minStep - 1);
    assert.equal(close, s, "samples closer than minStep wait for the next one");
    const later = W.follow(s, s.x + 50, s.y, s.at + C.stale + 1);
    assert.equal(later.vx, 0, "after a pause the pointer starts from rest");
    assert.ok(W.normal(C.speed) > 0.7 && W.normal(10 * C.speed) < 1 && W.normal(-C.speed) < -0.7);
});

test("quick reversals make him dizzy, slow or old ones do not", () => {
    const C = W.CARRY;
    function wave(speed, halfPeriod, duration, start) {
        let s = null, x = 0;
        for (let t = start; t <= start + duration; t += 16) {
            x += (Math.floor((t - start) / halfPeriod) % 2 ? -1 : 1) * speed * 0.016;
            s = W.follow(s, x, 0, t);
        }
        return s;
    }
    assert.ok(W.shaken(wave(1500, 130, 900, 0)), "three fast back-and-forths");
    assert.ok(!W.shaken(wave(400, 130, 900, 0)), "too slow to count");
    assert.ok(!W.shaken(wave(1500, 600, 900, 0)), "one reversal is a change of mind, not a shake");
    let s = wave(1500, 130, 900, 0);
    s = W.follow(s, s.x, s.y, s.at + 100);
    s = W.follow(s, s.x, s.y, s.at + C.shakeWindow + 100);
    assert.ok(!W.shaken(s), "reversals older than the window are forgotten");
});

test("he leans into every direction, diagonals included", () => {
    const right = W.carry(0.8, 0), left = W.carry(-0.8, 0), up = W.carry(0, -0.8), down = W.carry(0, 0.8);
    // Pulled right: swings so his bottom trails, hat and tip blown back, the
    // star streaming out behind, eyes ahead, feet and hands trailing; left
    // is the mirror image.
    assert.ok(right.swing > 0 && right.hatX < 0 && right.tip < 0 && right.star < 0 && right.eyeX > 0 && right.feet > 0 && right.handX < 0);
    for (const key of ["swing", "hatX", "hatTilt", "tip", "star", "eyeX", "feet", "handX"])
        assert.equal(left[key], -right[key], key);
    assert.equal(right.hatY, 0);
    // Lifted: the hat is shoved down over his eyes and his hands are left
    // below. Dropping: it floats off above him and tumbles, and he looks up at it.
    assert.ok(up.hatY > 0 && up.eyeY < 0 && up.swing === 0 && up.handY > 0);
    assert.ok(down.hatY < 0 && down.hatTilt < 0 && down.eyeY < 0 && down.handY < 0);
    // A diagonal is one motion: stretched along it, the hat thrown back and up.
    const diagonal = W.carry(0.6, 0.6);
    assert.equal(Math.round(diagonal.angle), 45);
    assert.equal(Math.round(W.carry(0.6, -0.6).angle), -45);
    assert.ok(diagonal.hatX < 0 && diagonal.hatY < 0 && diagonal.eyeX > 0 && diagonal.smear > right.smear * 0.99);
    assert.ok(W.carry(0.3, 0).smear < right.smear, "the stretch grows with speed");
    for (const value of Object.values(W.carry(0, 0)))
        assert.equal(Math.abs(value), 0);
});

test("the drag's effects are in the rig: \"?!\", sweat, dust, dizzy eyes and stars, feet out", () => {
    const drawn = effects => new Set(leaves(W.stillOps("carried", { effects })).map(op => op.layer));
    const plain = drawn({});
    for (const layer of ["leg", "boot", "hand", "sleeve"])
        assert.ok(plain.has(layer), layer);
    for (const layer of ["shout", "sweat", "dust", "dizzy-eye", "dizzy-star"])
        assert.ok(!plain.has(layer), `${layer} only when asked`);
    assert.ok(drawn({ shout: true }).has("shout") && drawn({ sweat: true }).has("sweat") && drawn({ dust: true }).has("dust"));
    const dizzy = drawn({ dizzy: true });
    assert.ok(dizzy.has("dizzy-eye") && dizzy.has("dizzy-star") && !dizzy.has("eyes") && !dizzy.has("lids"));
    // At rest his boots show under the hem and his legs do not.
    const resting = new Set(leaves(W.stillOps("idle")).map(op => op.layer));
    assert.ok(resting.has("boot") && !resting.has("leg"));
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
    assert.match(code, /SineR \{ target: kick; running: root\.live && root\.carried; reach: 16; period: 480; phase: leg\.phase \}/);
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
    for (const step of ["startling.complete()", "landing.complete()", "hopping.complete()", "crooking.complete()", "dizzy = false"])
        assert.ok(off.includes(step), step);
});

test("he can face the other way, point at the box, and have a helper", () => {
    assert.match(code, /property int facing: 1/);
    assert.match(code, /readonly property int side: facing < 0 \? -1 : 1/);
    assert.match(code, /property real turn: side/);
    // Mirrored about his own middle; a transform works in the item's scaled units.
    assert.match(code, /transform: Scale \{\s*origin\.x: 60 \* root\.unit\s*xScale: root\.turn\s*\}/);
    // Mirrored, he follows the pointer and the drag in his own frame, and
    // what is written still reads the right way round.
    assert.match(code, /hovered \? Qt\.point\(lookX \* 2 \* side, lookY \* 1\.2\)/);
    assert.match(code, /readonly property var reaction: wiz\.carry\(ux \* side, uy\)/);
    assert.match(code, /readonly property point pivot: Qt\.point\(side > 0 \? grab\.x \/ unit : 120 - grab\.x \/ unit, grab\.y \/ unit\)/);
    assert.equal(code.match(/transform: Scale \{ xScale: root\.side \}/g).length, 2, "the z's and the \"?!\"");
    // Pointing: down at the box below him, up at one above; `aside` keeps
    // the pose's own aim out to the side (Settings' guide).
    assert.match(code, /property bool aside: false/);
    assert.match(code, /readonly property var aim: pose === "pointing" && !aside\s*\? \(boxAbove \? layout\.aim\.above : layout\.aim\.below\) : null/);
    for (const key of ["rx", "ry", "wandA", "eyeX", "eyeY"])
        assert.match(code, new RegExp(`property real ${key}: aim \\? aim\\.${key} : stance\\.${key}`), key);
    const { above, below } = W.LAYOUT.aim;
    assert.ok(Math.sin(below.wandA * Math.PI / 180) > 0.8 && below.eyeY > 0, "the wand and his eyes go down");
    assert.ok(Math.sin(above.wandA * Math.PI / 180) < -0.8 && above.eyeY < 0, "and up");
    for (const aim of [above, below])
        assert.ok(aim.rx > W.LAYOUT.shoulders[1][0], "with his right hand");
    // The wisp beside him in any pose but asleep: it floats for as long as
    // it is there, and asleep he draws nothing.
    assert.match(code, /property bool helper: false/);
    assert.match(code, /property real wisp: Math\.max\(stance\.wisp, helper && pose !== "asleep" \? 1 : 0\)/);
    assert.equal(W.POSES.asleep.wisp, 0);
    for (const item of ["wispBob", "wispFlicker"])
        assert.match(code, new RegExp(`Sine[XYR] \\{ target: ${item}; running: root\\.live && helperWisp\\.visible;`), item);
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
