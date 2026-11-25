.pragma library

// Pure document merge/rebase/parse and quiet-hours clock helpers for SettingsHelpers.js.
// Keep this file free of Qt APIs so persistence stays deterministic across QML and Node.

// Quiet hours. "nights" is a fixed preset; "custom" uses the stored
// minutes-since-midnight bounds. A range crossing midnight wraps.
var QUIET_NIGHTS = { start: 1320, end: 420 };

function quietRange(quiet, start, end) {
    if (quiet === "nights")
        return { start: QUIET_NIGHTS.start, end: QUIET_NIGHTS.end };
    if (quiet === "custom")
        return { start: start, end: end };
    return null;
}

function quietActive(quiet, start, end, minutesNow) {
    var range = quietRange(quiet, start, end);
    if (!range || range.start === range.end)
        return false;
    if (range.start < range.end)
        return minutesNow >= range.start && minutesNow < range.end;
    return minutesNow >= range.start || minutesNow < range.end;
}

function formatMinutes(total) {
    var h = Math.floor(total / 60) % 24;
    var m = total % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Typed clock time to minutes since midnight, snapped to `step` and wrapped
// to one day: "7", "7:30", "07:30", "0730" and "19.45" all read. Returns -1
// for text that names no time, so a field can flag it instead of guessing.
function parseClockMinutes(text, step) {
    var clean = String(text || "").trim();
    var match = clean.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?$/);
    if (!match)
        return -1;
    var hours = Number(match[1]);
    var minutes = match[2] === undefined ? 0 : Number(match[2]);
    if (hours > 23 || minutes > 59)
        return -1;
    var grain = step > 0 ? step : 1;
    var total = Math.round((hours * 60 + minutes) / grain) * grain;
    return ((total % 1440) + 1440) % 1440;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function restoreSnapshot(current, snapshot) {
    var restored = clone(current);
    Object.keys(snapshot || {}).forEach(function(key) {
        restored[key] = clone(snapshot[key]);
    });
    return restored;
}

function listIn(value) {
    return (Array.isArray(value) || value instanceof Array) ? value : [];
}

// A layout entry moved to another column is no longer where the file had it.
// Only entries the new layout does not place at all (a newer schema's
// widgets) stay behind in their old column; a moved entry carries its
// unknown fields along.
function preserveUnknownMods(original, replacement) {
    if (!original || typeof original !== "object" || !replacement || typeof replacement !== "object")
        return preserveUnknown(original, replacement);
    var columns = ["left", "center", "right"];
    var stored = {};
    var placedIn = {};
    columns.forEach(function(col) {
        listIn(original[col]).forEach(function(entry) {
            if (entry && typeof entry.id === "string" && !stored[entry.id])
                stored[entry.id] = entry;
        });
        listIn(replacement[col]).forEach(function(entry) {
            if (entry && typeof entry.id === "string")
                placedIn[entry.id] = col;
        });
    });
    var base = clone(original);
    columns.forEach(function(col) {
        var kept = listIn(original[col]).filter(function(entry) {
            return !entry || typeof entry.id !== "string" || placedIn[entry.id] === undefined;
        });
        listIn(replacement[col]).forEach(function(entry) {
            if (entry && stored[entry.id])
                kept.push(stored[entry.id]);
        });
        if (original[col] !== undefined || replacement[col] !== undefined)
            base[col] = clone(kept);
    });
    return preserveUnknown(base, replacement);
}

function unknownFields(original, schema) {
    if (!original || typeof original !== "object")
        return undefined;
    if ((Array.isArray(original) || original instanceof Array)) {
        if (!(Array.isArray(schema) || schema instanceof Array))
            return undefined;
        var entries = [];
        original.forEach(function(item) {
            if (!item || typeof item.id !== "string")
                return;
            var known = schema.find(function(value) { return value && value.id === item.id; });
            if (!known) {
                entries.push(clone(item));
                return;
            }
            var extra = unknownFields(item, known);
            if (extra) {
                extra.id = item.id;
                entries.push(extra);
            }
        });
        return entries.length ? entries : undefined;
    }
    if (!schema || typeof schema !== "object")
        return undefined;
    var out = {};
    Object.keys(original).forEach(function(key) {
        if (key === "__proto__" || key === "constructor" || key === "prototype")
            return;
        var value = Object.prototype.hasOwnProperty.call(schema, key)
            ? unknownFields(original[key], schema[key]) : clone(original[key]);
        if (value !== undefined)
            out[key] = value;
    });
    return Object.keys(out).length ? out : undefined;
}

function preserveUnknown(original, replacement) {
    if ((Array.isArray(replacement) || replacement instanceof Array)) {
        if (!(Array.isArray(original) || original instanceof Array))
            return clone(replacement);
        // Layout entries carry stable ids. Preserve future entries and fields
        // while retaining the current user's ordering of understood entries.
        if (replacement.every(function(item) { return item && typeof item.id === "string"; })) {
            var result = replacement.map(function(item) {
                return preserveUnknown(original.find(function(old) {
                    return old && old.id === item.id;
                }), item);
            });
            original.forEach(function(item) {
                if (item && typeof item.id === "string"
                        && !replacement.some(function(next) { return next.id === item.id; }))
                    result.push(clone(item));
            });
            return result;
        }
        return clone(replacement);
    }
    if (!replacement || typeof replacement !== "object")
        return clone(replacement);
    var out = original && typeof original === "object" && !(Array.isArray(original) || original instanceof Array)
        ? clone(original) : {};
    Object.keys(replacement).forEach(function(key) {
        if (key !== "__proto__" && key !== "constructor" && key !== "prototype")
            out[key] = preserveUnknown(out[key], replacement[key]);
    });
    return out;
}

function rebaseDocuments(base, desired, current, path) {
    if (JSON.stringify(desired) === JSON.stringify(base)
            || JSON.stringify(desired) === JSON.stringify(current))
        return current;
    if (JSON.stringify(current) === JSON.stringify(base))
        return desired;
    if (base && desired && current && [base, desired, current].every(function(value) {
        return typeof value === "object" && !(Array.isArray(value) || value instanceof Array);
    })) {
        var out = clone(current);
        Object.keys(base).concat(Object.keys(desired)).forEach(function(key) {
            if (key === "__proto__" || key === "constructor" || key === "prototype")
                return;
            if (!path && key === "v") {
                out.v = desired.v;
                return;
            }
            var result = rebaseDocuments(base[key], desired[key], current[key], (path || "") + "/" + key);
            if (result === undefined)
                delete out[key];
            else
                out[key] = result;
        });
        return out;
    }
    throw new Error("Another writer changed " + (path || "/") + "; reload before retrying");
}

// Distinguishing "no settings yet" from "settings we could not read" is what
// keeps a corrupt file recoverable: both merge to defaults, but only the empty
// case may be overwritten. Returns { status, value } where status is one of:
//   "empty"   — nothing on disk yet (or a whitespace-only file); first run.
//   "ok"      — a settings object; value is it.
//   "corrupt" — bytes exist but are not a settings object. Value is null and
//               the caller must preserve the file before saving over it.
function parse(text) {
    if (typeof text !== "string" || text.trim() === "")
        return { status: "empty", value: null };
    var parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return { status: "corrupt", value: null };
    }
    if (!parsed || typeof parsed !== "object" || (Array.isArray(parsed) || parsed instanceof Array))
        return { status: "corrupt", value: null };
    return { status: "ok", value: parsed };
}

var exported = {
    QUIET_NIGHTS: QUIET_NIGHTS,
    quietRange: quietRange,
    quietActive: quietActive,
    formatMinutes: formatMinutes,
    parseClockMinutes: parseClockMinutes,
    clone: clone,
    restoreSnapshot: restoreSnapshot,
    listIn: listIn,
    unknownFields: unknownFields,
    preserveUnknown: preserveUnknown,
    preserveUnknownMods: preserveUnknownMods,
    rebaseDocuments: rebaseDocuments,
    parse: parse
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
