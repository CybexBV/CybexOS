// The installer draws Wiz from pictures scripts/export-wiz cuts out of the
// desktop's rig (installer/kiosk/ui/wiz.slint, src/wiz.rs). Its frame and
// motion constants must stay the rig's. installer/kiosk/README.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {shellDir} = require('./shell.cjs');
const root = path.resolve(shellDir, '../..');
const WizRig = require(path.join(shellDir, 'Common/WizRig.js'));
const slint = fs.readFileSync(path.join(root, 'installer/kiosk/ui/wiz.slint'), 'utf8');
const artDir = path.join(root, 'installer/kiosk/assets/wiz');
const picture = name => fs.readFileSync(path.join(artDir, `${name}.svg`), 'utf8');
const looks = ['thinking', 'working', 'needs-input', 'happy', 'sorry'];

test('his frame is the rig\'s still box, his feet on its ground', () => {
    const [x, y, width, height] = WizRig.STILL_BOX;
    assert.match(slint, new RegExp(`STILL_BOX, \\[${x}, ${y}, ${width}, ${height}\\]`));
    assert.match(slint, new RegExp(`width: ${width}px;`));
    assert.match(slint, new RegExp(`height: root\\.width \\* ${height} / ${width};`));
    assert.match(slint, new RegExp(`unit: root\\.width / ${width};`));
    assert.match(slint, new RegExp(`x: ${-x} \\* root\\.unit;`));
    assert.match(slint, new RegExp(`y: ${-y} \\* root\\.unit;`));
    assert.match(slint, new RegExp(`feet: ${WizRig.LAYOUT.ground[1] - y} \\* root\\.unit;`));
});

test('runes circle and sparkles burst as the rig draws them', () => {
    const orbit = WizRig.LAYOUT.orbit;
    assert.match(slint, new RegExp(`root\\.t \\* ${orbit.rate}rad`));
    assert.equal(slint.match(new RegExp(`root\\.px\\(${orbit.rx} \\* cos\\(self\\.at\\)\\)`, 'g')).length, 2);
    assert.equal(slint.match(new RegExp(`root\\.px\\(${orbit.ry} \\* sin\\(self\\.at\\)`, 'g')).length, 2);
    const delays = WizRig.LAYOUT.sparks.map(spark => spark[2]).join(', ');
    assert.ok(slint.includes(`for delay[z] in [${delays}]`), delays);
});

test('every picture the installer asks for is exported', () => {
    const files = fs.readdirSync(artDir).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4));
    const asked = [...slint.matchAll(/name: (?:root\.look \+ )?"([a-z0-9-]+)"/g)].map(match => match[1]);
    assert.ok(asked.length >= 10, asked.join(' '));
    for (const name of asked) {
        // "-body", "-eyes" and "-hat" follow the pose; the others name a pose's part.
        const wanted = name.startsWith('-') ? looks.map(look => look + name) : [name];
        for (const want of wanted)
            assert.ok(files.some(file => file.startsWith(want)), `${want} is not in installer/kiosk/assets/wiz`);
    }
    const rust = fs.readFileSync(path.join(root, 'installer/kiosk/src/wiz.rs'), 'utf8');
    for (const file of files)
        assert.ok(rust.includes(`"${file}"`), `src/wiz.rs does not embed ${file}`);
    // And nothing it no longer shows: the amber pip and its ring became the star.
    assert.deepEqual(files.filter(file => /pip|ring$/.test(file)), []);
    assert.doesNotMatch(slint, /needs-input-(?:pip|ring)/);
    assert.doesNotMatch(rust, /needs-input-(?:pip|ring)/);
});

test('each pose is his body with his hands, his eyes with their lids, and his hat with its star', () => {
    const C = WizRig.COLORS;
    for (const look of looks) {
        const body = picture(`${look}-body`), hat = picture(`${look}-hat`), eyes = picture(`${look}-eyes`);
        // Cloak, cape, mittens and boots move as one; the hat carries the band and the star's thread.
        for (const colour of [C.cloak, C.cape, C.glove, C.boot])
            assert.ok(body.includes(`fill="${colour}"`), `${look}-body ${colour}`);
        assert.ok(hat.includes(`fill="${C.band}"`) && hat.includes(`fill="${C.hat}"`), `${look}-hat`);
        assert.ok(eyes.includes(`fill="${C.eye}"`), `${look}-eyes`);
        assert.ok(!body.includes(`fill="${C.eye}"`) && !body.includes(`fill="${C.band}"`), `${look}-body holds no eyes or hat`);
        // Every picture sits inside his frame.
        const [x, y, width, height] = WizRig.STILL_BOX;
        for (const svg of [body, hat, eyes]) {
            const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
            assert.ok(vx >= x && vy >= y && vx + vw <= x + width && vy + vh <= y + height, `${look} leaves the frame`);
        }
    }
    // Sorry's worried lids are part of his eyes, in all three frames of a blink.
    for (const frame of ['sorry-eyes', 'sorry-eyes-half', 'sorry-eyes-shut'])
        assert.ok(picture(frame).includes(`fill="${C.face}"`), frame);
    // The wand is in the working body, under the hand that holds it.
    const working = picture('working-body');
    assert.ok(working.indexOf(`stroke="${C.wand}"`) > 0 && working.indexOf(`stroke="${C.wand}"`) < working.lastIndexOf(`fill="${C.glove}"`));
});

test('the star says what the pip said: amber and pulsing for a question, in each pose its own light', () => {
    const C = WizRig.COLORS;
    assert.ok(picture('thinking-hat').includes(C.magic) && picture('working-hat').includes(C.magic) && picture('happy-hat').includes(C.magic));
    assert.ok(picture('sorry-hat').includes('#FF5D73'));
    // A waiting question: the hat carries a dim star, and the amber one over
    // it dims and comes back with each pulse.
    assert.ok(!picture('needs-input-hat').includes(C.amber));
    assert.ok(picture('needs-input-star').includes(C.amber));
    assert.match(slint, /name: "needs-input-star";\s*ppu: root\.ppu;\s*opacity: root\.since-pulse < 28 && !root\.still \? 1 - round\(sin\(self\.spread \* 180deg\) \* 7\) \/ 10\.0 : 1;/);
    assert.match(slint, /interval: root\.pulses < 3 \? 1111ms : 8s;/);
    // The spell is at the tip of his wand, drawn after the hat it reaches past.
    assert.ok(slint.indexOf('name: "working-glow"') > slint.indexOf('name: root.look + "-hat"'));
    const [, sx, sy, sw, sh] = picture('working-core').match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/).map(Number);
    const [, gx, gy, gw, gh] = picture('working-glow').match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/).map(Number);
    assert.ok(Math.abs(sx + sw / 2 - gx - gw / 2) < 0.02 && Math.abs(sy + sh / 2 - gy - gh / 2) < 0.02, 'the spell\'s parts share a centre');
    assert.ok(sx + sw / 2 > 90 && sy + sh / 2 < 75, 'up and to his right, where the wand points');
});
