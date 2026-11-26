const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./shell.cjs");

const F = load("Format.js");

test("mmss reads junk as zero rather than as a stray minus sign", () => {
    // The old usage/system copies rendered "-1:-30" and "0:12.7" here; only
    // the media copy guarded. This is the behaviour that changed, and it
    // changed on inputs none of the three call sites can produce.
    for (const bad of [-1, -30, null, undefined, NaN, Infinity, "x"])
        assert.equal(F.mmss(bad), "0:00", `mmss(${String(bad)})`);
    assert.equal(F.mmss(12.7), "0:12");
});
