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
