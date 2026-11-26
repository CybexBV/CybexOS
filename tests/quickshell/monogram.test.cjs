// The monogram tile an app without an icon shows (Common/Monogram.js):
// its first letter on a colour derived from its name, readable in both themes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./shell.cjs");

const M = load("Monogram.js");

test("every tile keeps 4.5:1 between letter and fill in both themes", () => {
    for (const hue of M.HUES) {
        // A name for each hue: search a few until one lands on it.
        let name = "";
        for (let i = 0; i < 2000 && name === ""; i++)
            if (M.hue("app " + i) === hue) name = "app " + i;
        assert.notEqual(name, "", `a name for hue ${hue}`);
        for (const dark of [true, false]) {
            const tile = M.tile(name, dark);
            assert.match(tile.fill, /^#[0-9a-f]{6}$/);
            assert.match(tile.ink, /^#[0-9a-f]{6}$/);
            assert.ok(M.contrast(tile.fill, tile.ink) >= 4.5,
                `${dark ? "dark" : "light"} hue ${hue}: ${tile.ink} on ${tile.fill} is ${M.contrast(tile.fill, tile.ink).toFixed(2)}:1`);
        }
    }
});
