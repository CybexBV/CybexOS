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
