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
const exportWiz = require(path.join(root, 'scripts/export-wiz'));
const slint = fs.readFileSync(path.join(root, 'installer/kiosk/ui/wiz.slint'), 'utf8');
const artDir = path.join(root, 'installer/kiosk/assets/wiz');
const picture = name => fs.readFileSync(path.join(artDir, `${name}.svg`), 'utf8');
const viewBox = name => picture(name).match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const centre = name => { const [x, y, w, h] = viewBox(name); return [x + w / 2, y + h / 2]; };
const looks = ['thinking', 'brewing', 'needs-input', 'happy', 'sorry'];
// The poses whose star moves on its own: a twinkle at work, a pulse for a question.
const starApart = ['thinking', 'brewing', 'needs-input'];

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
    const asked = [...slint.matchAll(/name: (?:root\.(?:look|pose) \+ )?"([a-z0-9-]+)"/g)].map(match => match[1]);
    assert.ok(asked.length >= 10, asked.join(' '));
    for (const name of asked) {
        // "-body", "-eyes" and "-hat" follow the pose, "-star" where it moves
        // on its own; the others name a pose's part.
        const wanted = name === '-star' ? starApart.map(look => look + name)
            : name.startsWith('-') ? looks.map(look => look + name) : [name];
        for (const want of wanted)
            assert.ok(files.some(file => file.startsWith(want)), `${want} is not in installer/kiosk/assets/wiz`);
    }
    const rust = fs.readFileSync(path.join(root, 'installer/kiosk/src/wiz.rs'), 'utf8');
    for (const file of files)
        assert.ok(rust.includes(`"${file}"`), `src/wiz.rs does not embed ${file}`);
    // Every step of the stir and every bubble, and no more.
    for (let i = 0; i < exportWiz.STIR.steps; i++)
        assert.ok(files.includes(`brewing-stir${i}`), `brewing-stir${i}`);
    for (let j = 0; j < exportWiz.BUBBLES.length; j++)
        assert.ok(files.includes(`brewing-bubble${j}`), `brewing-bubble${j}`);
    assert.ok(!files.includes(`brewing-stir${exportWiz.STIR.steps}`));
    assert.ok(!files.includes(`brewing-bubble${exportWiz.BUBBLES.length}`));
    // And nothing it no longer shows: the amber pip and its ring became the
    // star, and the installation brews instead of working a spell.
    assert.deepEqual(files.filter(file => /pip|ring\d?$|^working-/.test(file)), []);
    assert.doesNotMatch(slint, /needs-input-(?:pip|ring)|"working/);
    assert.doesNotMatch(rust, /needs-input-(?:pip|ring)|"working/);
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
    // Brewing: the cauldron is in his body. The stirring wand and the hand
    // that holds it are not: they are in each step of the stir, the wand
    // under the hand, and every step is drawn apart.
    const brewing = picture('brewing-body');
    assert.ok(brewing.includes(`fill="${C.pot}"`) && !brewing.includes(`stroke="${C.wand}"`));
    assert.equal(brewing.split(`fill="${C.glove}"`).length - 1, 3, 'only his left mitten stays in the body');
    const steps = new Set();
    for (let i = 0; i < exportWiz.STIR.steps; i++) {
        const stir = picture(`brewing-stir${i}`), wand = stir.indexOf(`stroke="${C.wand}"`);
        assert.ok(wand > 0 && wand < stir.indexOf(`fill="${C.glove}"`), `brewing-stir${i}`);
        steps.add(stir);
    }
    assert.equal(steps.size, exportWiz.STIR.steps);
});

test('the star says what the pip said: amber and pulsing for a question, in each pose its own light', () => {
    const C = WizRig.COLORS;
    // Steady in the hat: the accent when he is happy, red when it failed.
    assert.ok(picture('happy-hat').includes(C.magic));
    assert.ok(picture('sorry-hat').includes('#FF5D73'));
    // At work the hat carries a dim star and the lit one twinkles over it,
    // from about as bright as the rig's twinkle at its dimmest to fully lit.
    for (const look of ['thinking', 'brewing']) {
        assert.ok(!picture(`${look}-hat`).includes(C.magic) && picture(`${look}-star`).includes(C.magic), look);
        assert.ok(!picture(`${look}-star`).includes(`fill="${C.hat}"`), `${look}-star is the star alone`);
    }
    const dim = WizRig.LIGHT.rest.k, low = ((0.72 - dim) / (1 - dim)).toFixed(2), high = (0.28 / (1 - dim)).toFixed(2);
    assert.ok(slint.includes('if root.pose == "thinking" || root.pose == "brewing": Art {'));
    assert.ok(slint.includes(`opacity: root.still ? 1 : round((${low} + ${high} * sin(root.t * 6.5rad)) * 10) / 10.0;`), `${low} + ${high}`);
    // A waiting question: the hat carries a dim star, and the amber one over
    // it dims and comes back with each pulse.
    assert.ok(!picture('needs-input-hat').includes(C.amber));
    assert.ok(picture('needs-input-star').includes(C.amber));
    assert.match(slint, /name: "needs-input-star";\s*ppu: root\.ppu;\s*opacity: root\.since-pulse < 28 && !root\.still \? 1 - round\(sin\(self\.spread \* 180deg\) \* 7\) \/ 10\.0 : 1;/);
    assert.match(slint, /interval: root\.pulses < 3 \? 1111ms : 8s;/);
});

test('brewing: bubbles rise off the brew while he stirs, as the rig draws it', () => {
    const at = exportWiz.brew(WizRig.stillOps('brewing')), first = exportWiz.BUBBLES[0];
    // Each bubble starts on the brew where the rig puts it, at its own size.
    exportWiz.BUBBLES.forEach((bubble, j) => {
        const [x, y] = centre(`brewing-bubble${j}`);
        assert.ok(Math.abs(x - at.start[j][0]) < 0.02 && Math.abs(y - at.start[j][1]) < 0.02, `brewing-bubble${j} is on the brew`);
        assert.ok(Math.abs(viewBox(`brewing-bubble${j}`)[2] / viewBox('brewing-bubble0')[2] - bubble.r / first.r) < 0.02, `brewing-bubble${j}`);
    });
    // They rise the rig's 15 cauldron units at 0.6 rises a second, a fifth of
    // a rise apart, wobbling 1.5 units, fading and shrinking by 0.3.
    assert.ok(slint.includes(`for j in ${exportWiz.BUBBLES.length}: Art {`));
    assert.ok(slint.includes(`rise: Math.mod(root.t * 0.6 + j * ${1 / exportWiz.BUBBLES.length}, 1);`));
    assert.ok(slint.includes(`dy: root.bob + root.px(-${at.rise.toFixed(1)} * self.rise);`), `rise ${at.rise}`);
    assert.ok(slint.includes(`dx: root.px(${(1.5 * at.unit).toFixed(2)} * sin((root.t * 2 + j * 1.9) * 1rad));`), `wobble ${1.5 * at.unit}`);
    assert.ok(slint.includes('size: round((1 - 0.3 * self.rise) * 10) / 10.0;'));
    assert.ok(slint.includes('opacity: 1 - self.rise;'));
    // The stir's steps, 40 ms frames apiece, make a turn in about the rig's
    // 2 pi / 3.2 s, and it rests on its first step when he holds still.
    const stir = slint.match(/stir: root\.still \? 0 : Math\.mod\(floor\(root\.tick \/ ([\d.]+)\), (\d+)\);/);
    assert.ok(stir, 'the stir steps with the frame counter');
    assert.equal(Number(stir[2]), exportWiz.STIR.steps);
    const turn = exportWiz.STIR.steps * Number(stir[1]) * 0.04, rig = 2 * Math.PI / 3.2;
    assert.ok(Math.abs(turn - rig) / rig < 0.05, `a turn of the stir takes ${turn} s, the rig's ${rig} s`);
    // Over his eyes, the brew and the bubbles, as the rig draws the wand
    // after the cauldron.
    assert.ok(slint.indexOf('name: "brewing-bubble"') > slint.indexOf('name: root.look + "-eyes"'));
    assert.ok(slint.indexOf('name: "brewing-stir"') > slint.indexOf('name: "brewing-bubble"'));
    // Brewing loops, like thinking; nothing else does.
    assert.match(slint, /property <bool> loops: root\.pose == "thinking" \|\| root\.pose == "brewing";/);
});
