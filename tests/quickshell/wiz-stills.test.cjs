// Wiz's still pictures, assets/wiz/<pose>.svg (docs/branding.md): the
// desktop package renders them with librsvg for the terminal and the
// assistant's notifications (nix/packages/desktop.nix). librsvg cuts off the
// glow of a turned shape, so no glowing shape in a still may be turned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {shellDir, load} = require('./shell.cjs');

const W = load('WizRig.js');
const root = path.resolve(shellDir, '../..');
const stillsDir = path.join(root, 'assets/wiz');
const stills = W.STATES.filter(state => state !== 'carried');

function multiply(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
// An SVG transform attribute as a matrix.
function matrix(attribute) {
    let m = [1, 0, 0, 1, 0, 0];
    for (const [, kind, args] of attribute.matchAll(/(\w+)\(([^)]*)\)/g)) {
        const v = args.trim().split(/[\s,]+/).map(Number);
        let n;
        if (kind === 'translate') n = [1, 0, 0, 1, v[0], v[1] || 0];
        else if (kind === 'scale') n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
        else if (kind === 'matrix') n = v;
        else if (kind === 'rotate') {
            const a = v[0] * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), x = v[1] || 0, y = v[2] || 0;
            n = [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y];
        } else throw new Error(`unknown transform ${kind}`);
        m = multiply(m, n);
    }
    return m;
}
// Each filtered path and the matrix it is drawn with.
function filtered(svg) {
    const stack = [[1, 0, 0, 1, 0, 0]], found = [];
    for (const [tag] of svg.matchAll(/<\/?g[^>]*>|<path[^>]*>/g)) {
        if (tag.startsWith('</g')) stack.pop();
        else if (tag.startsWith('<g')) {
            const t = tag.match(/transform="([^"]*)"/);
            stack.push(t ? multiply(stack[stack.length - 1], matrix(t[1])) : stack[stack.length - 1]);
        } else if (tag.includes('filter="url(')) found.push({tag, m: stack[stack.length - 1]});
    }
    return found;
}

test('no glowing shape in a still is turned, so librsvg draws its whole glow', () => {
    for (const state of stills) {
        const svg = fs.readFileSync(path.join(stillsDir, `${state}.svg`), 'utf8');
        const glows = filtered(svg);
        assert.ok(glows.length > 0, `${state} has his glowing eyes`);
        for (const {tag, m} of glows)
            assert.ok(Math.abs(m[1]) < 2e-3 && Math.abs(m[2]) < 2e-3, `${state}: ${tag.slice(0, 60)} is turned`);
    }
    // The sparkles of a finished turn are turned in the rig, and come out upright
    // at the same place.
    const ops = W.stillOps('finished').filter(op => op.layer === 'sparkle');
    assert.ok(ops.length >= 3);
    const svg = W.stillSVG('finished');
    for (const [x, y] of W.LAYOUT.sparks.map(spark => [spark[0], spark[1]]).slice(0, 3)) {
        const near = filtered(svg).some(({tag, m}) => {
            const d = tag.match(/d="M([-\d.]+) ([-\d.]+)/);
            const px = m[0] * Number(d[1]) + m[2] * Number(d[2]) + m[4], py = m[1] * Number(d[1]) + m[3] * Number(d[2]) + m[5];
            return Math.hypot(px - x, py - y) < 7;
        });
        assert.ok(near, `a sparkle near ${x}, ${y}`);
    }
});

test('the desktop package renders stills that exist', () => {
    const nix = fs.readFileSync(path.join(root, 'nix/packages/desktop.nix'), 'utf8');
    const used = [...nix.matchAll(/assets\/wiz\/([a-z-]+)\.svg/g)].map(match => match[1]);
    const loop = nix.match(/for pose in ([a-z -]+); do/);
    assert.ok(loop, 'the notification poses');
    const all = used.filter(name => name !== '$pose').concat(loop[1].trim().split(/\s+/));
    assert.ok(all.includes('idle') && all.includes('finished') && all.includes('needs-input') && all.includes('sorry'), all.join(' '));
    for (const name of all)
        assert.ok(fs.existsSync(path.join(stillsDir, `${name}.svg`)), `assets/wiz/${name}.svg`);
});
