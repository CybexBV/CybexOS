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
//
// It also says which row the assistant means (handle, rowFor, searchResult
// below), so that part is tested under Node too.

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

// ---- which row --------------------------------------------------------------
// The assistant's settings_search and settings_show (Common/AssistantTools.qml)
// name a row of the search index (SettingsSearchData.ROWS) by one string, its
// handle: the settings key, else the search anchor, else its page and label
// ("keyboard:keyboard-layouts"). Every row has one, and no two rows share it.
// Settings' guide can find a row by its key or anchor and point at it; a row
// with neither only opens its page.

function slug(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function handle(row) {
    return row.key || row.anchor || row.page + ":" + slug(row.label);
}

// The row a handle names, or null. A key or an anchor wins over a page and
// label, so a handle that is both names the row Settings can point at.
function rowFor(rows, text) {
    text = String(text || "");
    if (text === "")
        return null;
    var by = function(test) {
        for (var i = 0; i < rows.length; i++) {
            if (test(rows[i]))
                return rows[i];
        }
        return null;
    };
    return by(function(row) { return row.key === text; })
        || by(function(row) { return row.anchor === text; })
        || by(function(row) { return handle(row) === text; });
}

// Whether Settings' guide can find the row on its page and point at it.
function pointable(row) {
    return !!(row.key || row.anchor);
}

// Whether settings_set may change the row: a settings key the schema knows,
// and not one the assistant may not touch (`blocked`).
function changeable(row, defaults, blocked) {
    return !!row.key && Object.prototype.hasOwnProperty.call(defaults, row.key) && !blocked(row.key);
}

function valueType(value) {
    return (Array.isArray(value) || value instanceof Array) ? "list" : value === null ? "none" : typeof value;
}

// The rows that match the most of the query's words, best first: a row whose
// label holds the whole query before others that match as many words, then
// the index's own order. No words: the index from the top.
function searchRows(rows, query, limit) {
    var words = String(query || "").toLowerCase().split(/\s+/).filter(function(word) { return word !== ""; });
    var whole = words.join(" ");
    var found = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var haystack = [row.label, row.group, row.pageLabel, row.terms, row.key, row.anchor || "", handle(row)]
            .join(" ").toLowerCase();
        var score = words.filter(function(word) { return haystack.indexOf(word) !== -1; }).length;
        if (words.length > 0 && score === 0)
            continue;
        found.push({ row: row, score: score, named: whole !== "" && row.label.toLowerCase().indexOf(whole) !== -1,
            index: i });
    }
    found.sort(function(a, b) {
        return b.score - a.score || (b.named ? 1 : 0) - (a.named ? 1 : 0) || a.index - b.index;
    });
    return found.slice(0, limit).map(function(entry) { return entry.row; });
}

var SEARCH_NOTE = "Pass a result's row to settings_show to show it. Only a result with changeable true "
    + "can be changed, with settings_set and its key; the others can only be shown.";

// settings_search's answer. A row settings_set may change keeps the fields
// the tool always gave (key, label, page, group, current, default, type);
// every row also has `row`, its handle, and `changeable`. `current(key)`
// reads a setting's value now.
function searchResult(rows, query, defaults, current, blocked) {
    return {
        results: searchRows(rows, query, 12).map(function(row) {
            var entry = { key: row.key || "", label: row.label, page: row.pageLabel, group: row.group || "" };
            var change = changeable(row, defaults, blocked);
            if (change) {
                entry.current = current(row.key);
                entry["default"] = defaults[row.key];
                entry.type = valueType(defaults[row.key]);
            }
            entry.row = handle(row);
            entry.changeable = change;
            return entry;
        }),
        note: SEARCH_NOTE
    };
}

var exported = {
    SPOTS: SPOTS,
    GAP: GAP,
    tip: tip,
    tips: tips,
    place: place,
    slug: slug,
    handle: handle,
    rowFor: rowFor,
    pointable: pointable,
    changeable: changeable,
    valueType: valueType,
    searchRows: searchRows,
    searchResult: searchResult
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
