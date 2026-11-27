const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./shell.cjs");
const C = load("CountdownHelpers.js");

test("the next wake lands exactly where the label changes", () => {
    // Every millisecond in the final two minutes, then a coarse sweep of the
    // next hours: the label holds until the wake and changes on it.
    const lefts = [];
    for (let left = 1; left <= 125000; left++)
        lefts.push(left);
    for (let left = 125000; left <= 3 * 3600000; left += 997)
        lefts.push(left);
    for (const left of lefts) {
        const wait = C.nextChangeMs(left);
        assert.ok(wait > 0 && wait <= 60000, `${left}: ${wait}`);
        assert.notEqual(C.remainingLabel(left - wait), C.remainingLabel(left),
            `${left}: the label must change at the wake`);
        assert.equal(C.remainingLabel(left - wait + 1), C.remainingLabel(left),
            `${left}: the label must hold until the wake`);
    }
    // A minute label wakes about once a minute; seconds only at the end.
    assert.equal(C.nextChangeMs(10 * 60000 + 30000), 30000);
    assert.equal(C.nextChangeMs(10 * 60000), 60000);
    assert.equal(C.nextChangeMs(60500), 500);
    assert.equal(C.nextChangeMs(60000), 1000);
    assert.equal(C.nextChangeMs(0), 0);
    assert.equal(C.nextChangeMs(-1), 0);
    assert.equal(C.nextChangeMs(NaN), 0);
});

test("the soonest change covers every reminder and ignores finished ones", () => {
    const now = 1_000_000_000;
    const due = ms => (now + ms) / 1000;
    assert.equal(C.soonestChangeMs([], now), 0);
    assert.equal(C.soonestChangeMs(null, now), 0);
    assert.equal(C.soonestChangeMs([due(-3000), due(0)], now), 0);
    assert.equal(C.soonestChangeMs([due(10 * 60000 + 30000), due(5 * 60000 + 12000)], now), 12000);
    assert.equal(C.soonestChangeMs([due(-3000), due(45500)], now), 500);
    assert.equal(C.soonestChangeMs(["" + due(90000)], now), 30000);
});
