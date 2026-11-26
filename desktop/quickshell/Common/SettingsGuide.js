// Where the small Wiz of Settings' guide stands ("Show me where",
// docs/assistant.md): beside one row, pointing at it, never over the row's
// own label or control. Settings/SettingsGuide.qml measures the row and
// calls place(); everything here is plain geometry, so it is tested under
// Node (settings-guide.test.cjs).
//
// Rectangles are {x, y, width, height} in one coordinate space (the guide's
// layer). Wiz is a square box of `size`; his wand tip sits at a fixed point
// of that box for each way he points, from the rig's own pointing pose
// (WizRig.js: the hand, the wand's length and its angle).

.pragma library

// The spots, in the order they are tried. "left" stands before the label and
// "gap" between the label and its control, both pointing right; "right"
// stands after the row pointing left. "above" stands over the row pointing
// down at it, "below" under it pointing up.
var SPOTS = ["left", "gap", "right", "above", "below"];

// Clear air between the wand's tip and what it points at.
var GAP = 4;

// The wand tip as a fraction of his box, facing right, for one aim:
// "aside" (the pose as drawn), "down" (rig.LAYOUT.aim.below) or "up".
function tip(rig, aim) {
    var pose = rig.POSES.pointing;
    var hand = aim === "down" ? rig.LAYOUT.aim.below : aim === "up" ? rig.LAYOUT.aim.above : pose;
    var angle = hand.wandA * Math.PI / 180;
    var reach = rig.LAYOUT.wand;
    return { x: (hand.rx + reach * Math.cos(angle)) / 120, y: (hand.ry + reach * Math.sin(angle)) / 120 };
}

function tips(rig) {
    return { aside: tip(rig, "aside"), down: tip(rig, "down"), up: tip(rig, "up") };
}

// One spot: his box, which way he faces, how he holds the wand and the point
// it touches. null when the spot means nothing for this row.
function spot(name, input) {
    var size = input.size;
    var row = input.row;
    var label = input.label || row;
    var controls = input.controls || [];
    var box = function(face, aim, point) {
        var t = input.tips[aim];
        var fx = face > 0 ? t.x : 1 - t.x;
        return { name: name, facing: face, aside: aim === "aside", boxAbove: aim === "up",
                 x: Math.round(point.x - fx * size), y: Math.round(point.y - t.y * size),
                 width: size, height: size, target: point };
    };
    // Beside something, facing it, his box GAP short of it: the wand's tip
    // is then a little further off, by the air in his box past the tip.
    var before = function(x, y) {
        return box(1, "aside", { x: x - GAP - (1 - input.tips.aside.x) * size, y: y });
    };
    var after = function(x, y) {
        return box(-1, "aside", { x: x + GAP + (1 - input.tips.aside.x) * size, y: y });
    };
    // He points at the label's middle, the line a row is read along; at a
    // destination without one, at its first line.
    var lineY = input.label ? label.y + label.height / 2 : row.y + Math.min(row.height, size) / 2;
    if (name === "left")
        return before(label.x, lineY);
    if (name === "right") {
        var right = row.x + row.width;
        for (var i = 0; i < controls.length; i++)
            right = Math.max(right, controls[i].x + controls[i].width);
        return after(right, lineY);
    }
    if (name === "gap") {
        // The first control after the label on the label's line.
        if (!input.label)
            return null;
        var first = null;
        for (var j = 0; j < controls.length; j++) {
            var rect = controls[j];
            var onLine = rect.y < lineY && rect.y + rect.height > lineY;
            if (onLine && rect.x >= label.x + label.width && (!first || rect.x < first.x))
                first = rect;
        }
        return first ? before(first.x, lineY) : null;
    }
    // Over or under the row, starting just past the label (or at the start
    // of a destination without one), his box touching the row's edge.
    var aim = name === "above" ? "down" : "up";
    var t2 = input.tips[aim];
    var x = (input.label ? label.x + label.width : row.x) + GAP + t2.x * size;
    if (name === "above")
        return box(1, aim, { x: x, y: row.y - (1 - t2.y) * size });
    return box(1, aim, { x: x, y: row.y + row.height + t2.y * size });
}

// How much of the box lies over the rectangles, in square pixels.
function overlap(box, rects) {
    var total = 0;
    for (var i = 0; i < rects.length; i++) {
        var rect = rects[i];
        if (!rect)
            continue;
        var w = Math.min(box.x + box.width, rect.x + rect.width) - Math.max(box.x, rect.x);
        var h = Math.min(box.y + box.height, rect.y + rect.height) - Math.max(box.y, rect.y);
        if (w > 0 && h > 0)
            total += w * h;
    }
    return total;
}

// input: {size, area, row, label, controls, tips}. `area` is where he may
// stand (the visible page and its margin), `row` the whole row, `label` the
// label as drawn (null for a destination that is not a settings row: then
// the whole of it is in `controls`), `controls` everything else of the row he
// must not cover, `tips` from tips(). Each spot is pulled inside the area;
// the first that then covers nothing, moved by at most a quarter of his size
// to get there, wins (`fits`). When none does, the one that covers least,
// then the one moved least, with `fits` false.
function place(input) {
    var rects = (input.label ? [input.label] : []).concat(input.controls || []);
    var found = [];
    for (var i = 0; i < SPOTS.length; i++) {
        var c = spot(SPOTS[i], input);
        if (!c)
            continue;
        var x = Math.max(input.area.x, Math.min(c.x, input.area.x + input.area.width - c.width));
        var y = Math.max(input.area.y, Math.min(c.y, input.area.y + input.area.height - c.height));
        c.shift = Math.abs(x - c.x) + Math.abs(y - c.y);
        c.x = x;
        c.y = y;
        c.overlap = overlap(c, rects);
        c.fits = c.overlap === 0 && c.shift <= c.width / 4;
        if (c.fits)
            return c;
        found.push(c);
    }
    found.sort(function(a, b) { return a.overlap - b.overlap || a.shift - b.shift; });
    return found[0];
}

var exported = {
    SPOTS: SPOTS,
    GAP: GAP,
    tip: tip,
    tips: tips,
    place: place
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
