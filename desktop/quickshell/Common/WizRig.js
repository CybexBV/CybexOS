// Wiz, the Cybex OS Assistant's character: his artwork, poses and timing.
// Shared by Assistant/Wiz.qml, Common/WizArt.qml, scripts/export-wiz and the
// Node tests, so plain JavaScript with no Qt or DOM APIs. Geometry lives in a
// 120 × 120 unit box.
//
// Quickshell never runs the drawing code below per frame. scripts/export-wiz
// renders each layer once, at rest, into assets/wiz/<layer>.svg; Wiz.qml
// stacks those layers and moves them declaratively, reading POSES, META,
// LAYOUT and LAYERS from here. ops() still describes the complete motion
// (breathing, blinks, runes, the spell, his hands, the star on its thread) at
// any moment, which documents what the QML reproduces and lets toSVG() draw
// any pose as a still picture. While he is dragged, follow() and carry() turn
// the pointer's motion into how he swings, where his hat goes and whether he
// has been shaken dizzy.
//
//   var rig = WizRig.create(seed)
//   rig.update(dtSeconds, state, { reducedMotion, unread, progress, accent, light })
//   var ops = rig.ops({ effects })                          // draw list
//   WizRig.toSVG(ops, size, viewBox, idPrefix)              // still SVG
//   WizRig.layerSVG(name, { accent, scale })                // one layer at rest
//   WizRig.stillSVG(state, { unread, progress, accent })    // a whole pose at rest
//   WizRig.arcSVG(progress, { light, accent, scale })       // the progress ring's arc
//
// States: see STATES. Magic (runes, the spell, the star when he works or has
// a reply, the orb, the cauldron, the wisp, written lines, light from below)
// is drawn in `accent`, Cybex blue unless one is given.

var WizRig = (function () {
  var C = {
    cloak: "#262A31", cloakHi: "#343A44", edge: "#4D5562", rim: "#8D9AB0", seam: "#15171B",
    face: "#090B0E",
    cape: "#30353F", capeEdge: "#5A6372", capeHi: "#6C7686", clasp: "#C9D3E0",
    eye: "#EEF6FF", eyeGlow: "#78BEFF",
    brimUnder: "#1C1F24", brim: "#31363F", brimHi: "#566070",
    hat: "#363B45", hatEdge: "#525A67", crease: "#1A1D22",
    band: "#DC1E37", bandHi: "#FF6B7D", bandLo: "#8E1223", buckle: "#DDE5F0",
    glove: "#D6DEE9", gloveLo: "#97A5B8", gloveEdge: "#4E5868",
    boot: "#31363F", bootHi: "#566070",
    wand: "#DCE3EC", wandGrip: "#8E1223", dark: "#0E1014",
    magic: "#4FA3F7", magicHi: "#9BD3FF", spellCore: "#E4F4FF", particle: "#BFE3FF", spark: "#D6EEFF",
    amber: "#F5B83D", bad: "#FF5D73", starOff: "#5B6472",
    page: "#EEF2F8", pageLo: "#C3CCD9", ink: "#64708A", cover: "#8E1223", coverHi: "#DC1E37",
    pot: "#1B1E24", potHi: "#707B8C", orb: "#0F1C2E", dust: "#8A919C"
  };

  // What the star on his hat says: its colour ([red, green, blue], or null
  // for the accent), how bright it is and how it moves.
  var LIGHT = {
    rest: { c: [190, 214, 240], k: 0.28, beat: "none" },    // nothing to say
    busy: { c: null, k: 1, beat: "twinkle" },               // at work
    ready: { c: null, k: 1, beat: "none" },                 // a reply, or attentive
    ask: { c: [245, 184, 61], k: 1, beat: "pulse" },        // your move
    bad: { c: [255, 93, 115], k: 0.9, beat: "none" },       // it failed
    off: { c: [91, 100, 114], k: 0, beat: "none" }          // asleep
  };

  var BASE = {
    lean: 0, sc: 1, sy: 1, bodyY: 0, hatY: 0, hatRot: 0, hatLift: 0,
    eyeOpen: 1, eyeX: 0, eyeY: 0, happy: 0, lid: 0, lidR: 0, brow: 0, big: 0,
    bob: 1, sway: 1, tip: 0, voice: 0, glow: 1, feet: 0,
    spell: 0, runes: 0, zzz: 0,
    arms: 0, lx: 37, ly: 100, rx: 83, ry: 100, point: 0, pointA: -90, palms: 0,
    wand: 0, wandA: -60,
    book: 0, orb: 0, scroll: 0, pot: 0, wisp: 0
  };
  function pose(o) { var p = {}, k; for (k in BASE) p[k] = BASE[k]; for (k in o) p[k] = o[k]; return p; }

  // lid and lidR lower the eyelids (lidR his right one alone); brow slants
  // them, set (above 0) or worried (below); big widens his right eye. arms
  // brings his hands out to (lx, ly) and (rx, ry); point sticks a finger out
  // along pointA and palms opens his hands. The rest say what he holds.
  var CAST = { lean: -3, sc: 1.02, hatY: -1.5, hatRot: -3, eyeOpen: 1.08, eyeX: 1.6, eyeY: -1.2, brow: 0.85, bob: 0.5, sway: 0.6,
    arms: 1, lx: 34, ly: 94, rx: 89, ry: 78, wand: 1, wandA: -58, spell: 1 };
  var POSES = {
    "idle": pose({ arms: 1, lx: 35.5, ly: 99, rx: 84.5, ry: 99 }),
    // A long quiet while: half asleep, hands tucked in.
    "drowsy": pose({ sy: 0.98, bodyY: 1, hatY: 2.4, hatRot: -3, lid: 0.55, eyeY: 1.2, bob: 0.6, sway: 0.3, tip: 2, glow: 0.8 }),
    "listening": pose({ lean: 3, sc: 1.05, hatY: -4, hatRot: -5, eyeOpen: 1.15, eyeX: 0.8, eyeY: -0.6, big: 0.35, bob: 0.4, sway: 0.5, tip: -1, voice: 1,
      arms: 1, rx: 85.5, ry: 73, lx: 38, ly: 98 }),
    "thinking": pose({ lean: -2, hatY: -1, hatRot: 3, eyeOpen: 0.9, eyeX: -2.2, eyeY: -2.6, lidR: 0.25, runes: 1, bob: 0.6, sway: 1.7, tip: 1,
      arms: 1, rx: 67.5, ry: 84, lx: 37, ly: 99 }),
    // Work of no particular kind: it looks like casting.
    "working": pose(CAST),
    // The kinds of work.
    "reading": pose({ hatY: 0.5, hatRot: 1.5, eyeOpen: 0.95, eyeY: 3, lid: 0.18, bob: 0.4, sway: 0.4,
      arms: 1, lx: 47.5, ly: 101.5, rx: 72.5, ry: 101.5, book: 1 }),
    "searching": pose({ lean: 1, hatY: -1, eyeOpen: 1.2, eyeY: 2.8, big: 0.3, bob: 0.4, sway: 0.5,
      arms: 1, lx: 47, ly: 96.5, rx: 73, ry: 96.5, orb: 1 }),
    "writing": pose({ lean: -1.5, hatY: 0.5, hatRot: 2, eyeOpen: 0.95, eyeX: -1.2, eyeY: 2.8, lid: 0.15, brow: 0.35, bob: 0.3, sway: 0.4,
      arms: 1, lx: 43.5, ly: 98.5, rx: 68, ry: 96, scroll: 1 }),
    "casting": pose(CAST),
    "brewing": pose({ lean: 1, hatY: 0.5, eyeOpen: 1, eyeY: 2.6, bob: 0.4, sway: 0.4,
      arms: 1, lx: 46.5, ly: 95, rx: 76, ry: 86.5, wand: 1, wandA: 122, pot: 1 }),
    "delegating": pose({ lean: -2.5, hatRot: 3, eyeOpen: 1, eyeX: -2.8, eyeY: -0.6, bob: 0.6, sway: 0.8,
      arms: 1, lx: 31, ly: 86, rx: 82, ry: 99, palms: 1, wisp: 1 }),
    // Your move.
    "needs-input": pose({ lean: 2, sy: 0.98, hatY: 3, hatLift: -8, eyeOpen: 1.2, eyeX: 0.8, eyeY: -0.8, big: 0.2, bob: 0.4, sway: 0.6, tip: -2,
      arms: 1, lx: 38, ly: 98, rx: 99, ry: 64 }),
    "pointing": pose({ lean: 2.5, hatRot: -3, eyeOpen: 1.05, eyeX: 2.6, eyeY: 1.2, happy: 0.25, bob: 0.5, sway: 0.5,
      arms: 1, lx: 38, ly: 98, rx: 88, ry: 90, wand: 1, wandA: 6 }),
    // How it went.
    "finished": pose({ happy: 1, eyeY: 0.4, bob: 0.8, arms: 1, lx: 35.5, ly: 99, rx: 84.5, ry: 99 }),
    "proud": pose({ lean: -1.5, sc: 1.03, hatY: -2, hatRot: 4, happy: 1, eyeY: 0.2, bob: 0.9, tip: -2,
      arms: 1, lx: 36, ly: 97, rx: 90, ry: 82, point: 1, pointA: -90 }),
    // A happy moment that is not a finished turn: no sparkle, no nod.
    "happy": pose({ happy: 1, eyeY: 0.4, bob: 0.8, arms: 1, lx: 35.5, ly: 99, rx: 84.5, ry: 99 }),
    // Hello: he tips his hat and waves.
    "greeting": pose({ lean: 1.5, hatY: -4, hatRot: -12, happy: 1, eyeY: 0.2, bob: 0.9, tip: -2,
      arms: 1, lx: 24, ly: 78, rx: 88.5, ry: 50.5, palms: 1 }),
    "shrug": pose({ sy: 0.985, hatY: 1.5, hatRot: 5, eyeOpen: 0.9, eyeX: 1.6, eyeY: -0.4, brow: -0.7, lidR: 0.2, bob: 0.4, sway: 0.5, tip: 1.5,
      arms: 1, lx: 26.5, ly: 87, rx: 93.5, ry: 87, palms: 1 }),
    // The reply failed: hat tipped down, eyes lowered, wringing his hands.
    "sorry": pose({ lean: -1.5, sc: 0.98, sy: 0.98, bodyY: 1, hatY: 2.5, hatRot: -7, eyeOpen: 0.95, eyeX: -0.8, eyeY: 2.6, brow: -0.8, lid: 0.06, bob: 0.3, sway: 0.4, tip: 2.5,
      arms: 1, lx: 55.2, ly: 97.5, rx: 64.8, ry: 97.5 }),
    "curious": pose({ lean: 4, hatY: -2, hatRot: 7, eyeOpen: 1.2, eyeX: 1.2, eyeY: -0.6, big: 1, bob: 0.5, sway: 0.8, tip: -2,
      arms: 1, lx: 40, ly: 89, rx: 80, ry: 89, palms: 1 }),
    // The assistant service is not there: hat down, eyes closed and dim.
    "asleep": pose({ sy: 0.97, bodyY: 1.5, hatY: 4.5, hatRot: -5, eyeOpen: 0.08, eyeY: 2.4, bob: 0.5, sway: 0.3, tip: 3, glow: 0.5, zzz: 1 }),
    // Picked up: stretched, eyes huge, hands up, feet out of the cloak.
    // carry() adds the motion on top.
    "carried": pose({ sc: 1.02, sy: 1.04, bodyY: -1, hatY: -3, eyeOpen: 1.4, eyeY: -0.6, big: 0.4, brow: -0.5, bob: 0, sway: 0.3, feet: 1,
      arms: 1, lx: 27, ly: 76, rx: 93, ry: 76, palms: 1 })
  };
  // light: what the star shows (a key of LIGHT). act: the small repeated
  // motion on top of the pose (act() below).
  var META = {
    "idle": { light: "rest" }, "drowsy": { light: "rest" },
    "listening": { light: "ready", act: "listen" },
    "thinking": { light: "busy", act: "ponder" },
    "working": { light: "busy", act: "cast" },
    "reading": { light: "busy", act: "read" }, "searching": { light: "busy", act: "gaze" },
    "writing": { light: "busy", act: "write" }, "casting": { light: "busy", act: "cast" },
    "brewing": { light: "busy", act: "stir" }, "delegating": { light: "busy", act: "send" },
    "needs-input": { light: "ask", act: "raise" }, "pointing": { light: "ready", act: "point" },
    "finished": { light: "ready" }, "proud": { light: "ready", act: "cheer" }, "happy": { light: "ready" },
    "greeting": { light: "ready", act: "wave" }, "shrug": { light: "rest", act: "shrug" },
    "sorry": { light: "bad", act: "wring" }, "curious": { light: "ready", act: "peer" },
    "asleep": { light: "off" }, "carried": { light: "rest", act: "flail" }
  };
  var STATES = ["idle", "drowsy", "listening", "thinking", "working", "reading", "searching", "writing", "casting",
    "brewing", "delegating", "needs-input", "pointing", "finished", "proud", "happy", "greeting", "shrug", "sorry",
    "curious", "asleep", "carried"];
  // The star's light for a state. A reply not yet seen lights a resting star.
  function light(state, unread) {
    var name = (META[state] || META.idle).light;
    return unread && name === "rest" ? "ready" : name;
  }

  var BLEND_RATE = 7;        // pose easing, 1/s
  var FINISH_CYCLE = 3.4;    // s, sparkle + nod length when looping
  var KAPPA = 0.5523;
  var RUNES = [
    [["M", -2, -3], ["L", -2, 3], ["M", -2, -3], ["L", 1.8, -1.2], ["L", -2, 0.6], ["L", 2, 3]],
    [["M", 0, -3.2], ["L", 0, 3.2], ["M", -2.4, -0.8], ["L", 0, -3.2], ["L", 2.4, -0.8]],
    [["M", 0, -3.2], ["L", 2.6, 0], ["L", 0, 3.2], ["L", -2.6, 0], ["Z"]],
    [["M", -2, -3], ["L", -2, 3], ["M", 2, -3], ["L", 2, 3], ["M", -2, 1], ["L", 2, -1]]
  ];
  var STAR = [["M", 0, -5], ["Q", 0.9, -0.9, 5, 0], ["Q", 0.9, 0.9, 0, 5], ["Q", -0.9, 0.9, -5, 0], ["Q", -0.9, -0.9, 0, -5], ["Z"]];
  // [x, y, delay s, size] of the five sparkles a finished turn shows.
  var SPARKS = [[96, 2, 0, 1.2], [22, 30, 0.1, 0.85], [104, 44, 0.2, 0.75], [15, 66, 0.3, 0.65], [58, -3.5, 0.06, 0.6]];
  var ZED = [["M", -2.2, -2.4], ["L", 2.2, -2.4], ["L", -2.2, 2.4], ["L", 2.2, 2.4]];
  // Being dragged: a bead of sweat, "?!" drawn as strokes (no font), a puff
  // of dust on landing, and a spiral for each dizzy eye. All in local units
  // around 0.
  var SWEAT = [["M", 0, -4], ["C", 2.6, -0.6, 3, 1.6, 0, 3.6], ["C", -3, 1.6, -2.6, -0.6, 0, -4], ["Z"]];
  var QUESTION = [["M", -3.4, -4.6], ["C", -3.4, -8.4, 3.2, -8.4, 3.2, -4.6], ["C", 3.2, -2.2, 0, -1.8, 0, 1.2]];
  var BANG = [["M", 7.6, -7.8], ["L", 7.6, 1.2]];
  var PUFFS = [[-2.2, 0, 2.6, 2.2], [1.8, -0.6, 2.1, 1.8], [0.4, 1, 2.4, 1.6]];
  // Built when drawn: a QML import can run this file's top level before
  // globals such as Math exist (Qt 6.11, a component's first instance in a
  // Repeater), so nothing here computes at load time.
  function spiral() {
    var d = [], n = 36;
    for (var i = 0; i <= n; i++) {
      var a = i / n * 4.5 * Math.PI, r = 0.5 + 4.1 * i / n;
      d.push([i ? "L" : "M", r * Math.cos(a), r * Math.sin(a)]);
    }
    return d;
  }

  // Pivots and places the drawing and Wiz.qml share, in rig units.
  var LAYOUT = {
    ground: [60, 110],       // the body leans and scales about this point
    eyes: [60, 72.5],        // eye centre line; blinks close towards it
    eyeGap: 6.7,             // each eye's distance from the middle
    eye: [3.5, 4.7],         // an open eye's half width and half height
    brim: [60, 57],          // the hat tilts about the brim's centre...
    peek: [24, 57],          // ...and lifts about its left edge
    cone: [60, 57],          // Wiz.qml sways the cone about its base; ops() bends it
    tip: [81.1, 11.9],       // where the star's thread hangs from the cone...
    drop: 10.4,              // ...and how far below it the star hangs
    shoulders: [[44.5, 87], [75.5, 87]],   // where his sleeves come out from under the cape
    reach: 24,               // the arm's length in the sleeve layer...
    cuff: 3.4,               // ...and how far short of the hand its cuff sits
    wand: 19,                // the wand's length past the hand that holds it
    orbit: { cx: 61, cy: 30, rx: 32, ry: 6.5, rate: 1.25 },   // the thinking runes
    sparks: SPARKS,
    wisp: [17, 72],          // the helper floats beside him
    // The lines he writes on the scroll, in the scroll's own turned frame:
    // where the first starts, how far apart they are and how long.
    scroll: { turn: -5, size: 1.1, left: -7, top: -2.6, step: 2.7, length: 14 },
    // The z's of a sleeping Wiz when nothing moves: [x, y, size, strength].
    zzz: [[93, 33.5, 0.78, 0.71], [94.3, 27, 0.95, 1], [95, 20.5, 1.13, 0.71]],
    // Pointing at the box under him, or over him: the hand, the wand and
    // where he looks. The pose itself points sideways.
    aim: {
      below: { rx: 87, ry: 95, wandA: 70, eyeX: 1.4, eyeY: 2.4 },
      above: { rx: 95, ry: 80, wandA: -78, eyeX: 1.4, eyeY: -1.8 }
    },
    // Dragged: where the legs hang from, under the cloak, and how far the
    // boots drop; the middle the body stretches about along the drag; the
    // "?!", the sweat, the dust and the dizzy stars' orbit round the cone.
    feet: [[52, 102], [68, 102]],
    boots: [[51, 108], [69, 108]],
    dangle: 6,
    core: [60, 82],
    shout: [97, 20],
    sweat: [[40.5, 64], [79.5, 64]],
    phew: [80.5, 70],
    dust: [[36, 110], [84, 110]],
    dizzy: { cx: 61, cy: 28, rx: 24, ry: 5, rate: 3.9 }
  };

  // ---- carried --------------------------------------------------------------
  // While dragged, the pointer's velocity drives him: loose parts lag behind
  // the motion, his eyes look where he is going, his body stretches along it
  // (so a diagonal drag reads as diagonal), and a few quick reversals make him
  // dizzy. Velocities are in output pixels per second, y pointing down.
  var CARRY = {
    speed: 1400,        // what reads as a fling: reactions approach full strength
    smoothing: 0.35,    // share of a new sample in the running velocity
    minStep: 12,        // ms; closer samples wait for the next one
    stale: 150,         // ms; a pause longer than this starts from rest
    shakeSpeed: 650,    // a reversal counts as shaking above this speed...
    shakeTurns: 3,      // ...this many of them...
    shakeWindow: 1200   // ...within this many ms
  };
  // Full-strength reaction per unit of normalised velocity (carry()).
  var REACTION = {
    swing: 18,       // degrees about the grab: the bottom trails the motion
    hatX: -5,        // the hat slides back...
    hatUp: 8,        // ...is shoved down over the eyes when lifted...
    hatDown: -16,    // ...and floats off above him when he drops
    hatTilt: -14, hatTumble: -10,
    tip: -6,         // degrees: the tip of the hat blows back
    star: -34,       // degrees: the star streams out behind on its thread
    eyeX: 3.2, eyeUp: -2.2, eyeDown: -2.4,   // ahead, or up at the floating hat
    smear: 0.12,     // stretch along the motion
    feet: 30,        // degrees: the feet trail behind
    hands: -3        // units: his hands are left behind
  };

  // The drag's running velocity and shake count, from successive positions.
  function follow(state, x, y, now) {
    var s = state || {};
    if (s.at != null && now - s.at >= 0 && now - s.at < CARRY.minStep) return s;
    var fresh = s.at == null || now - s.at > CARRY.stale;
    var next = { x: x, y: y, at: now, vx: 0, vy: 0, dirX: s.dirX || 0, dirY: s.dirY || 0, turns: [] };
    if (!fresh) {
      var dt = (now - s.at) / 1000;
      next.vx = s.vx + ((x - s.x) / dt - s.vx) * CARRY.smoothing;
      next.vy = s.vy + ((y - s.y) / dt - s.vy) * CARRY.smoothing;
    }
    var turns = s.turns || [];
    for (var i = 0; i < turns.length; i++)
      if (now - turns[i] <= CARRY.shakeWindow) next.turns.push(turns[i]);
    var dirX = Math.abs(next.vx) > CARRY.shakeSpeed ? (next.vx > 0 ? 1 : -1) : 0;
    var dirY = Math.abs(next.vy) > CARRY.shakeSpeed ? (next.vy > 0 ? 1 : -1) : 0;
    if ((dirX && next.dirX && dirX !== next.dirX) || (dirY && next.dirY && dirY !== next.dirY))
      next.turns.push(now);
    if (dirX) next.dirX = dirX;
    if (dirY) next.dirY = dirY;
    return next;
  }
  function shaken(state) { return !!state && !!state.turns && state.turns.length >= CARRY.shakeTurns; }
  // Velocity to -1..1 per axis, saturating gently past a fling.
  function normal(v) { return Math.tanh(v / CARRY.speed); }
  // How he reacts to a normalised velocity (ux, uy).
  function carry(ux, uy) {
    var up = Math.max(0, -uy), down = Math.max(0, uy), m = Math.min(1, Math.sqrt(ux * ux + uy * uy));
    var R = REACTION;
    return {
      swing: R.swing * ux,
      hatX: R.hatX * ux,
      hatY: R.hatUp * up + R.hatDown * down,
      hatTilt: R.hatTilt * ux + R.hatTumble * down,
      tip: R.tip * ux,
      star: R.star * ux,
      eyeX: R.eyeX * ux,
      eyeY: R.eyeUp * up + R.eyeDown * down,
      smear: R.smear * m,
      angle: m > 0.001 ? Math.atan2(uy, ux) * 180 / Math.PI : 0,
      feet: R.feet * ux,
      handX: R.hands * ux,
      handY: R.hands * uy
    };
  }

  // ---- helpers ------------------------------------------------------------
  function ell(cx, cy, rx, ry) {
    var kx = rx * KAPPA, ky = ry * KAPPA;
    return [["M", cx - rx, cy],
      ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
      ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy], ["Z"]];
  }
  function arc(cx, cy, r, a0, a1) {
    var segs = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), step = (a1 - a0) / n;
    var k = 4 / 3 * Math.tan(step / 4);
    segs.push(["M", cx + r * Math.cos(a0), cy + r * Math.sin(a0)]);
    for (var i = 0; i < n; i++) {
      var s = a0 + i * step, e = s + step;
      segs.push(["C", cx + r * (Math.cos(s) - k * Math.sin(s)), cy + r * (Math.sin(s) + k * Math.cos(s)),
        cx + r * (Math.cos(e) + k * Math.sin(e)), cy + r * (Math.sin(e) - k * Math.cos(e)),
        cx + r * Math.cos(e), cy + r * Math.sin(e)]);
    }
    return segs;
  }
  function P(d, s) { var o = { k: "path", d: d }; for (var key in s) o[key] = s[key]; return o; }
  function G(t, a) { return { k: "g", t: t, a: a == null ? 1 : a }; }
  var END = { k: "end" };
  // Names the part the ops after it belong to; tagged() turns it into each
  // op's `layer`.
  function M(name) { return { k: "mark", n: name }; }
  function tagged(ops) {
    var out = [], at = "";
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.k === "mark") { at = o.n; continue; }
      if (o.k === "path" || o.k === "radial") o.layer = at;
      out.push(o);
    }
    return out;
  }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function hex(c) {
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(c[i]))).toString(16).toUpperCase();
      out += v.length < 2 ? "0" + v : v;
    }
    return out;
  }
  // "#RRGGBB" from what a theme gives ("#rgb", "#rrggbb", "#aarrggbb"), or
  // Cybex blue.
  function colour(value) {
    var v = String(value || "");
    if (/^#[0-9a-fA-F]{8}$/.test(v)) v = "#" + v.slice(3);
    else if (/^#[0-9a-fA-F]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : C.magic;
  }

  function cloak() {
    return [["M", 60, 59], ["C", 47, 59, 40.5, 67, 40.5, 77], ["C", 40.5, 88, 36, 98, 32, 104.5],
      ["Q", 39, 108.8, 46, 107.6], ["Q", 53, 110.2, 60, 108.9], ["Q", 67, 110.2, 74, 107.6], ["Q", 81, 108.8, 88, 104.5],
      ["C", 84, 98, 79.5, 88, 79.5, 77], ["C", 79.5, 67, 73, 59, 60, 59], ["Z"]];
  }
  function cape() {
    return [["M", 41, 77.5], ["C", 48, 85.6, 72, 85.6, 79, 77.5], ["C", 82, 81, 84.2, 86, 85, 91],
      ["Q", 73, 95.6, 60, 95.6], ["Q", 47, 95.6, 35, 91],
      ["C", 35.8, 86, 38, 81, 41, 77.5], ["Z"]];
  }

  // ---- rig ----------------------------------------------------------------
  function Rig(seed) {
    this.seed = seed == null ? Math.random() * 10 : seed;
    this.clock = this.seed * 3;
    this.state = "idle";
    this.enter = this.clock;
    this.cur = null;
    this.reduced = false;
    this.loop = true;
    this.unread = false;
    this.progress = -1;
    this.accent = C.magic;
    this.shine = { c: LIGHT.rest.c.slice(), k: LIGHT.rest.k };
    this.beat = "none";
    // The star swings on its thread, and the hat's tip follows, a beat late.
    this.swing = 0; this.swingV = 0; this.last = 0;
  }
  Rig.prototype.rnd = function (n) {
    var x = Math.sin(n * 12.9898 + this.seed * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  Rig.prototype.target = function () {
    var tg = pose(POSES[this.state]);
    if (this.reduced) return tg;
    var g = Math.floor(this.clock / 2.3 + this.seed);
    if (this.state === "idle") { tg.eyeX += this.rnd(g) * 2; tg.eyeY += this.rnd(g + 31) * 0.8; }
    else if (this.state === "needs-input") tg.eyeX += this.rnd(g * 3) * 1.1;
    else if (this.state === "thinking") tg.eyeX += this.rnd(g) * 0.9;
    return tg;
  };
  // A push on the star's thread, as a drag gives it.
  Rig.prototype.nudge = function (v) { this.swingV += v; };
  // dt: seconds since last frame (already multiplied by any speed factor).
  Rig.prototype.update = function (dt, state, opts) {
    opts = opts || {};
    this.reduced = !!opts.reducedMotion;
    this.loop = opts.loop !== false;
    this.unread = !!opts.unread;
    this.progress = opts.progress == null ? -1 : opts.progress;
    this.accent = colour(opts.accent);
    if (!POSES[state]) state = "idle";
    this.clock += dt;
    if (state !== this.state) { this.state = state; this.enter = this.clock; }
    var tg = this.target();
    if (!this.cur) this.cur = tg;
    var r = this.reduced ? 1 : 1 - Math.exp(-dt * BLEND_RATE);
    for (var k in tg) this.cur[k] += (tg[k] - this.cur[k]) * r;
    // The star's light eases as the pose does.
    var L = LIGHT[opts.light] || LIGHT[light(state, this.unread)];
    this.shine.c = mix(this.shine.c, L.c || rgb(this.accent), r);
    this.shine.k += (L.k - this.shine.k) * r;
    this.beat = L.beat;
    // The star on its thread: a damped spring pulled by how the hat moves.
    var lead = this.cur.hatRot + this.cur.lean * 1.5 + this.cur.tip * 2;
    var push = dt > 0 ? (lead - this.last) / dt : 0;
    this.last = lead;
    if (this.reduced) { this.swing = 0; this.swingV = 0; }
    else {
      var steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
      for (var i = 0; i < steps; i++) {
        this.swingV += (-42 * this.swing - 3.2 * this.swingV + push * 9) * h;
        this.swing += this.swingV * h;
      }
      this.swing = Math.max(-55, Math.min(55, this.swing));
    }
  };

  // The small repeated motion a state adds to its pose: where his hands, his
  // wand and his eyes go at time t.
  function act(name, t) {
    var o = { lx: 0, ly: 0, rx: 0, ry: 0, wandA: 0, eyeX: 0, eyeY: 0 };
    if (name === "wave") { o.lx = Math.sin(t * 8.5) * 3.4; o.ly = -Math.abs(Math.cos(t * 8.5)) * 1.4; }
    else if (name === "cast") { o.rx = Math.cos(t * 5.2) * 1.5; o.ry = Math.sin(t * 5.2) * 1.5; o.wandA = Math.sin(t * 5.2) * 10; o.ly = Math.sin(t * 2.6) * 0.8; }
    else if (name === "stir") { o.rx = Math.cos(t * 3.2) * 3.4; o.ry = Math.sin(t * 3.2) * 1.1; o.wandA = -Math.cos(t * 3.2) * 9; }
    else if (name === "write") { var u = (t * 0.55) % 1; o.rx = -6 + u * 10; o.ry = Math.sin(t * 19) * 0.55 + Math.floor(((t * 0.55) % 3)) * 1.7 - 1.7; o.eyeX = -1 + u * 2; }
    else if (name === "read") { var v = (t * 0.45) % 1; o.eyeX = -2.2 + v * 4.4; }
    else if (name === "gaze") { o.ly = Math.sin(t * 2.3) * 1.3; o.ry = Math.sin(t * 2.3 + Math.PI) * 1.3; o.lx = Math.cos(t * 2.3) * 0.8; o.rx = -Math.cos(t * 2.3 + Math.PI) * 0.8; o.eyeX = Math.sin(t * 1.1) * 1.2; }
    else if (name === "ponder") { o.ry = -Math.max(0, Math.sin(t * 3.4)) * 0.9; }
    else if (name === "raise") { o.rx = Math.sin(t * 5.5) * 2.2; o.ry = -Math.abs(Math.cos(t * 5.5)) * 0.8; }
    else if (name === "listen") { o.rx = Math.sin(t * 2.2) * 0.5; }
    else if (name === "send") { o.lx = Math.sin(t * 2.1) * 1; o.ly = Math.cos(t * 2.1) * 1.2; }
    else if (name === "cheer") { o.ry = -Math.abs(Math.sin(t * 4.2)) * 2.2; }
    else if (name === "shrug") { o.ly = Math.sin(t * 2.4) * 0.8; o.ry = Math.sin(t * 2.4) * 0.8; }
    else if (name === "wring") { o.lx = Math.sin(t * 3) * 0.7; o.rx = -Math.sin(t * 3) * 0.7; }
    else if (name === "peer") { o.ly = Math.sin(t * 2.6) * 0.7; o.ry = Math.sin(t * 2.6 + 1) * 0.7; }
    else if (name === "point") { o.rx = Math.max(0, Math.sin(t * 4)) * 1.8; o.wandA = Math.sin(t * 4) * 2; }
    else if (name === "flail") { o.lx = Math.sin(t * 17) * 2.4; o.ly = Math.cos(t * 15) * 2.4; o.rx = Math.sin(t * 16 + 1) * 2.4; o.ry = Math.cos(t * 18 + 2) * 2.4; }
    return o;
  }

  // A sleeve from the shoulder S to the hand H: narrow at the shoulder, wide
  // at the cuff, with the cuff's dark opening. Stretchy, like a cartoon's.
  function sleeve(O, S, H, a) {
    var dx = H[0] - S[0], dy = H[1] - S[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var thin = Math.max(0.7, Math.min(1, 27 / len));
    var kx = H[0] - ux * LAYOUT.cuff, ky = H[1] - uy * LAYOUT.cuff, w0 = 3.9 * thin, w1 = 5.5 * (0.5 + thin * 0.5);
    var mid = [S[0] + dx * 0.5, S[1] + dy * 0.5 + 1.2];
    O.push(M("sleeve"));
    O.push(P([["M", S[0] + nx * w0, S[1] + ny * w0],
      ["Q", mid[0] + nx * (w0 + 0.6), mid[1] + ny * (w0 + 0.6), kx + nx * w1, ky + ny * w1],
      ["L", kx - nx * w1, ky - ny * w1],
      ["Q", mid[0] - nx * (w0 + 0.6), mid[1] - ny * (w0 + 0.6), S[0] - nx * w0, S[1] - ny * w0], ["Z"]],
      { fill: C.cloakHi, stroke: C.edge, lw: 1.1, join: "round", a: a }));
    O.push(M("cuff"));
    O.push(G([["t", kx, ky], ["r", Math.atan2(uy, ux) * 180 / Math.PI, 0, 0]], a));
    O.push(P(ell(0, 0, 1.9, w1), { fill: C.seam, stroke: C.capeEdge, lw: 0.9 }));
    O.push(END);
  }
  // A mitten at H on the arm from S: a round hand and a thumb on the inner
  // side (`inner` is the thumb's side, seen along the arm). `point` sticks a
  // finger out along `angle` (degrees): a pointer, or straight up a
  // thumbs-up. `palms` opens the hand.
  function hand(O, S, H, inner, a, point, angle, palms, name) {
    var along = Math.atan2(H[1] - S[1], H[0] - S[0]) * 180 / Math.PI;
    O.push(G([["t", H[0], H[1]], ["r", along, 0, 0]], a));
    if (point > 0.02) {
      var r = (angle - along) * Math.PI / 180, L = 3.2 + 4.8 * point;
      O.push(M("finger"));
      O.push(P([["M", 0, 0], ["L", Math.cos(r) * L, Math.sin(r) * L]], { stroke: C.gloveEdge, lw: 4.6, cap: "round" }));
      O.push(P([["M", 0, 0], ["L", Math.cos(r) * L, Math.sin(r) * L]], { stroke: C.glove, lw: 3, cap: "round" }));
    }
    O.push(M(name));
    var tx = palms > 0.5 ? 1.2 : -0.2, ty = inner * (palms > 0.5 ? 4.3 : 3.7);
    O.push(P(ell(tx, ty, 2.3, 1.9), { fill: C.glove, stroke: C.gloveEdge, lw: 0.9 }));
    O.push(P(ell(0.9, 0, 4.7, 4.1), { fill: C.glove, stroke: C.gloveEdge, lw: 0.9 }));
    O.push(P(ell(tx + 0.3, ty - inner * 0.9, 1.5, 1.2), { fill: C.glove }));
    O.push(P(arc(0.9, 0, 3, -inner * 0.3, -inner * 1.9), { stroke: C.gloveLo, lw: 1, cap: "round", a: 0.75 }));
    O.push(END);
  }

  // Every leaf carries `layer`: the part it belongs to (LAYERS).
  Rig.prototype.ops = function (opts) {
    opts = opts || {};
    var c = this.cur || this.target(), st = this.state, red = this.reduced;
    var t = red ? 0 : this.clock, O = [], fx = opts.effects || {};
    var Lg = LAYOUT.ground, Le = LAYOUT.eyes, Lb = LAYOUT.brim, Lk = LAYOUT.peek, Lo = LAYOUT.orbit, Ly = LAYOUT.eye;
    var accent = colour(opts.accent || this.accent), accentHi = hex(mix(rgb(accent), [255, 255, 255], 0.45));
    var m = act(red ? "" : (META[st] || {}).act, t);

    var bobV = Math.sin(t * 2.1) * 0.9 * c.bob;
    var voiceV = Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) * 1.6 * c.voice;
    var nod = 0, spark = -1;
    if (st === "finished" || st === "proud") {
      var tE = this.clock - this.enter;
      if (this.loop) tE = tE % FINISH_CYCLE;
      if (red) spark = 0.5;
      else { spark = tE; if (st === "finished" && tE > 0.15 && tE < 0.95) nod = Math.abs(Math.sin(Math.PI * (tE - 0.15) / 0.4)); }
    }
    var bodyY = c.bodyY + bobV + nod * 0.8;
    // The hat breathes a moment after the body.
    var hatY = c.hatY + (red ? 0 : Math.sin(t * 2.1 - 0.7) * 0.6 * c.bob) - voiceV + nod * 3.4;
    var w = c.tip + Math.sin(t * 1.4 + this.seed) * 1.3 * c.sway + nod * 1.2 - this.swing * 0.05;

    var drowsy = st === "drowsy";
    var per = (drowsy ? 5.5 : 3.4) + (this.seed % 1.6), ph = (this.clock + this.seed * 2) % per, blink = 1;
    var blinkLen = drowsy ? 0.5 : 0.16;
    if (!red && ph < blinkLen) blink = 1 - 0.92 * Math.sin(Math.PI * ph / blinkLen);
    blink = blink + (1 - blink) * Math.min(1, c.happy * 1.5);
    var eyeY0 = Le[1] + c.eyeY + m.eyeY + nod * 2.2 + c.happy * 1.2, eyeX0 = c.eyeX + m.eyeX;
    function eye(cx, size) {
      var a = Ly[0] * size, open = Math.max(0.06, c.eyeOpen * blink), h = Ly[1] * open * size;
      var top = eyeY0 - h * 1.33, bot = eyeY0 + h * 1.33 * (1 - 1.6 * c.happy);
      return [["M", cx - a, eyeY0], ["C", cx - a, top, cx + a, top, cx + a, eyeY0], ["C", cx + a, bot, cx - a, bot, cx - a, eyeY0], ["Z"]];
    }
    // An eyelid: the dark of the hood coming down over an eye. `side` is -1
    // for his left eye; brow > 0 slants both down towards the middle (set,
    // sure), brow < 0 away from it (worried).
    function lid(cx, side, lower, size) {
      var h = Ly[1] * c.eyeOpen * size, a = Ly[0] * size + 2.2, slant = c.brow * 2.6;
      var cover = lower * 2 * h + Math.abs(slant) * 0.55, base = eyeY0 - h - 0.9 + cover;
      var yIn = base + slant, yOut = base - slant;
      var xl = cx - a, xr = cx + a;
      return [["M", xl, eyeY0 - h - 9], ["L", xr, eyeY0 - h - 9], ["L", xr, side < 0 ? yIn : yOut], ["L", xl, side < 0 ? yOut : yIn], ["Z"]];
    }

    O.push(M("shadow"));
    O.push(P(ell(Lg[0], Lg[1] + 0.6, 24 - bobV * 0.8 + (c.sc - 1) * 20, 3.3), { fill: "#000000", a: 0.3 * (1 - 0.65 * c.feet) }));
    if (fx.dust) for (var u = 0; u < LAYOUT.dust.length; u++) {
      O.push(M("dust"));
      O.push(G([["t", LAYOUT.dust[u][0], LAYOUT.dust[u][1]]]));
      for (var v = 0; v < PUFFS.length; v++)
        O.push(P(ell(PUFFS[v][0], PUFFS[v][1], PUFFS[v][2], PUFFS[v][3]), { fill: C.dust, a: 0.55 }));
      O.push(END);
    }
    O.push(G([["t", Lg[0], Lg[1]], ["r", c.lean, 0, 0], ["s", c.sc, c.sc * c.sy], ["t", -Lg[0], -Lg[1]], ["t", 0, bodyY]]));

    // Boot tips under the hem; carried, his legs come out and kick.
    for (var f = 0; f < 2; f++) {
      var hip = LAYOUT.feet[f], boot = LAYOUT.boots[f], kick = c.feet * Math.sin(t * 14 + f * 2.4) * 16;
      if (c.feet > 0.02) {
        O.push(M("leg"));
        O.push(G([["t", hip[0], hip[1]], ["r", kick, 0, 0]], c.feet));
        O.push(P([["M", -1.5, 0], ["L", 1.5, 0], ["L", 1.5, 10], ["L", -1.5, 10], ["Z"]], { fill: C.seam }));
        O.push(END);
      }
      O.push(M("boot"));
      O.push(G([["t", boot[0], boot[1] + c.feet * LAYOUT.dangle], ["r", kick, 0, hip[1] - boot[1]]]));
      O.push(P(ell(0, 0, 5.9, 3.1), { fill: C.boot, stroke: C.edge, lw: 1.1 }));
      O.push(P([["M", -3.6, -1.1], ["Q", 0, -2.5, 3.2, -1.4]], { stroke: C.bootHi, lw: 0.9, cap: "round" }));
      O.push(END);
    }

    // The cloak, the face that fills its hood, and its outline over both: a
    // darker edge with a lit rim on his left, so he stands off a dark wallpaper.
    O.push(M("body"));
    O.push(P(cloak(), { fill: C.cloak }));
    O.push(P([["M", 60, 59], ["C", 73, 59, 79.5, 67, 79.5, 77], ["C", 79.5, 88, 84, 98, 88, 104.5], ["Q", 81, 108.8, 74, 107.6],
      ["C", 70, 96, 69, 76, 60, 59], ["Z"]], { fill: "#000000", a: 0.2 }));
    O.push(P([["M", 46, 107.2], ["Q", 47.5, 100, 49.5, 95.5], ["M", 74, 107.2], ["Q", 72.5, 100, 70.5, 95.5], ["M", 60, 95], ["L", 60, 108.4]],
      { stroke: C.seam, lw: 1.1, cap: "round", a: 0.85 }));
    O.push(P([["M", 60, 59], ["C", 47, 59, 40.5, 67, 40.5, 77], ["L", 41, 77.5], ["C", 48, 85.6, 72, 85.6, 79, 77.5], ["L", 79.5, 77],
      ["C", 79.5, 67, 73, 59, 60, 59], ["Z"]], { fill: C.face }));
    O.push(P(cloak(), { stroke: C.edge, lw: 1.2, join: "round" }));
    O.push(P([["M", 49.5, 61.5], ["C", 43.5, 64.5, 40.5, 70, 40.5, 77], ["C", 40.5, 88, 36, 98, 32, 104.5]], { stroke: C.rim, lw: 1.2, cap: "round", a: 0.7 }));
    // His eyes light the inside of the hood.
    O.push(M("glow"));
    O.push({ k: "radial", cx: 60 + eyeX0 * 0.5, cy: eyeY0 + 1, r: 17, sy: 0.7, color: C.eyeGlow, stops: [[0, 0.22], [0.6, 0.08], [1, 0]], a: c.glow });

    // Light from below: a book, an orb, a cauldron.
    var under = Math.max(c.book * 0.7, c.orb, c.pot * 0.8);
    if (under > 0.02) {
      O.push(M("underlight"));
      O.push({ k: "radial", cx: 60, cy: 80, r: 19, sy: 0.6, color: accent, stops: [[0, 0.5], [0.6, 0.2], [1, 0]], a: under });
    }

    // Eyes and lids, or a spiral for each eye while he is dizzy.
    var sizeL = 1 - c.big * 0.06, sizeR = 1 + c.big * 0.2;
    var exL = Le[0] - LAYOUT.eyeGap + eyeX0, exR = Le[0] + LAYOUT.eyeGap + eyeX0 + c.big * 0.5;
    if (fx.dizzy) for (var e = 0; e < 2; e++) {
      O.push(M("dizzy-eye"));
      O.push(G([["t", e ? exR : exL, Le[1] + c.eyeY]]));
      O.push(P(spiral(), { stroke: C.eye, lw: 1.25, cap: "round", join: "round", glow: { c: C.eyeGlow, o: 0.95, s: 1.2 } }));
      O.push(END);
    } else {
      O.push(M("eyes"));
      O.push(P(eye(exL, sizeL), { fill: C.eye, a: c.glow, glow: { c: C.eyeGlow, o: 0.95, s: 1.7 } }));
      O.push(P(eye(exR, sizeR), { fill: C.eye, a: c.glow, glow: { c: C.eyeGlow, o: 0.95, s: 1.7 } }));
      if (c.lid > 0.01 || c.lidR > 0.01 || Math.abs(c.brow) > 0.02) {
        O.push(M("lids"));
        O.push(P(lid(exL, -1, c.lid, sizeL), { fill: C.face }));
        O.push(P(lid(exR, 1, Math.max(c.lid, c.lidR), sizeR), { fill: C.face }));
      }
    }

    // Arms: the sleeves come out from under the cape.
    var Sh = LAYOUT.shoulders, arms = c.arms;
    var HL = [Sh[0][0] + (c.lx + m.lx - Sh[0][0]) * arms, Sh[0][1] + (c.ly + m.ly - Sh[0][1]) * arms + bobV * 0.3];
    var HR = [Sh[1][0] + (c.rx + m.rx - Sh[1][0]) * arms, Sh[1][1] + (c.ry + m.ry - Sh[1][1]) * arms + bobV * 0.3];
    if (arms > 0.05) {
      sleeve(O, Sh[0], HL, clamp(arms * 1.5));
      sleeve(O, Sh[1], HR, clamp(arms * 1.5));
    }

    O.push(M("cape"));
    O.push(P(cape(), { fill: C.cape }));
    O.push(P([["M", 60, 85.4], ["C", 70, 85, 76, 81, 79, 77.5], ["C", 82, 81, 84.2, 86, 85, 91], ["Q", 73, 95.6, 60, 95.6], ["Z"]], { fill: "#000000", a: 0.16 }));
    O.push(P(cape(), { stroke: C.capeEdge, lw: 1.1, join: "round" }));
    O.push(P([["M", 41.7, 78.4], ["C", 48.4, 86, 71.6, 86, 78.3, 78.4]], { stroke: C.capeHi, lw: 1.3, cap: "round" }));
    O.push(P(ell(60, 88.7, 2.3, 2.3), { fill: C.clasp, stroke: C.gloveEdge, lw: 0.8 }));
    O.push(P(ell(59.3, 88, 0.8, 0.8), { fill: "#FFFFFF", a: 0.9 }));

    // The hat.
    O.push(G([["t", 0, hatY], ["r", c.hatRot, Lb[0], Lb[1]], ["r", c.hatLift, Lk[0], Lk[1]]]));
    var front = [];
    if (c.runes > 0.02) for (var q = 0; q < 4; q++) {
      var ra = t * Lo.rate + q * Math.PI / 2 + 0.4, sn = Math.sin(ra), rk = (0.82 + 0.22 * sn) * c.runes;
      var rune = [M("rune" + q), G([["t", Lo.cx + Lo.rx * Math.cos(ra), Lo.cy + Lo.ry * sn + Math.sin(t * 2.2 + q) * 1.3], ["s", rk, rk]], c.runes * (sn > 0 ? 1 : 0.5)),
        P(RUNES[q], { stroke: accentHi, lw: 1.15, cap: "round", join: "round", glow: { c: accent, o: 1, s: 1.5 } }), END];
      if (sn > 0) front = front.concat(rune); else O = O.concat(rune);
    }
    O.push(M("brim"));
    O.push(P(ell(60, 57.9, 36, 7.3), { fill: C.brimUnder, stroke: C.edge, lw: 1.1 }));
    O.push(P(ell(60, 57, 36, 7.3), { fill: C.brim }));
    O.push(P([["M", 24.6, 56.2], ["C", 24.6, 48.5, 95.4, 48.5, 95.4, 56.2]], { stroke: C.brimHi, lw: 1.1 }));
    // The band sits on the cone and sways with it; the cone's outline is
    // drawn again over the band's ends, so the band never paints over it.
    O.push(M("cone"));
    var tipX = 81.5 + w * 1.4, tipY = 12.5 + w * 0.8;
    var cone = [["M", 40.5, 57], ["C", 44.5, 43, 49.5, 30, 56 + w * .2, 22], ["C", 61 + w * .4, 14.5, 68 + w * .7, 8.5 + w * .1, 75.5 + w, 6.3 + w * .2],
      ["C", 79.5 + w * 1.2, 5.3 + w * .4, 83 + w * 1.4, 7.4 + w * .6, tipX + 0.6, tipY],
      ["C", 78 + w * 1.1, 10 + w * .5, 71.5 + w * .6, 13.5 + w * .2, 69.5 + w * .4, 19.5],
      ["C", 68 + w * .2, 27.5, 72.5, 43, 79.5, 57], ["Q", 60, 63, 40.5, 57], ["Z"]];
    O.push(P(cone, { fill: C.hat }));
    O.push(P([["M", 69.5 + w * .4, 19.5], ["C", 68 + w * .2, 27.5, 72.5, 43, 79.5, 57], ["Q", 70, 60.8, 63, 60.2], ["C", 62.5, 47, 64, 31, 69.5 + w * .4, 19.5], ["Z"]], { fill: "#000000", a: 0.22 }));
    O.push(P([["M", 57.5 + w * .25, 21.8], ["Q", 63 + w * .5, 18.6, 69 + w * .4, 20]], { stroke: C.crease, lw: 1, cap: "round" }));
    O.push(P([["M", 50.6, 34.5], ["Q", 57.5, 37.6, 66.4, 35.6]], { stroke: C.crease, lw: 0.9, cap: "round", a: 0.7 }));
    O.push(P([["M", 42.7, 50], ["Q", 60, 56.5, 76.2, 50], ["L", 78.7, 55.6], ["Q", 60, 62.4, 40.9, 55.6], ["Z"]], { fill: C.band }));
    O.push(P([["M", 42.9, 50.3], ["Q", 60, 56.8, 76, 50.3]], { stroke: C.bandHi, lw: 0.8, a: 0.45 }));
    O.push(P([["M", 41.1, 55.3], ["Q", 60, 62.1, 78.5, 55.3]], { stroke: C.bandLo, lw: 1 }));
    O.push(P([["M", 56.6, 53.4], ["L", 63.4, 53.4], ["L", 63.4, 59.2], ["L", 56.6, 59.2], ["Z"]], { stroke: C.gloveEdge, lw: 2.6, join: "round" }));
    O.push(P([["M", 56.6, 53.4], ["L", 63.4, 53.4], ["L", 63.4, 59.2], ["L", 56.6, 59.2], ["Z"]], { stroke: C.buckle, lw: 1.4, join: "round" }));
    O.push(P(cone, { stroke: C.hatEdge, lw: 1.1, join: "round" }));
    O = O.concat(front);
    if (fx.dizzy) for (var ds = 0; ds < 4; ds++) {
      var da2 = ds * Math.PI / 2 + 0.4, Ld = LAYOUT.dizzy;
      O.push(M("dizzy-star"));
      O.push(G([["t", Ld.cx + Ld.rx * Math.cos(da2), Ld.cy + Ld.ry * Math.sin(da2)], ["s", 0.55, 0.55]]));
      O.push(P(STAR, { fill: C.spark, stroke: C.magic, lw: 1, join: "round", glow: { c: C.magic, o: 0.95, s: 1.6 } }));
      O.push(END);
    }

    // The star on its thread, his one status light, and the ring round it
    // that fills as a job gets on.
    var k = this.shine.k, beat = this.beat, drop = LAYOUT.drop;
    if (!red && beat === "twinkle") k *= 0.72 + 0.28 * Math.sin(t * 6.5);
    else if (!red && beat === "pulse") k *= 0.5 + 0.5 * Math.abs(Math.sin(t * 2.6));
    var lc = this.shine.c, lit = hex(lc), starFill = hex(mix(rgb(C.starOff), mix(lc, [255, 255, 255], 0.62), clamp(k * 1.15)));
    O.push(G([["t", tipX - 0.4, tipY - 0.6], ["r", this.swing + w * 1.5, 0, 0]]));
    O.push(M("thread"));
    O.push(P([["M", 0, 0], ["L", 0, 6.2]], { stroke: C.hatEdge, lw: 0.9, cap: "round" }));
    O.push(M("star"));
    if (k > 0.04) O.push({ k: "radial", cx: 0, cy: drop, r: 11 + 3 * k, sy: 1, color: lit, stops: [[0, 0.75], [0.4, 0.3], [1, 0]], a: clamp(k) });
    if (this.progress >= 0) {
      O.push(M("ring"));
      O.push(P(ell(0, drop, 7.4, 7.4), { stroke: C.dark, lw: 2.2, a: 0.5 }));
      O.push(P(ell(0, drop, 7.4, 7.4), { stroke: C.hatEdge, lw: 0.8, a: 0.9 }));
      if (this.progress > 0.005) {
        O.push(M("ring-arc"));
        O.push(P(arc(0, drop, 7.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(0.999, this.progress)), { stroke: lit, lw: 1.5, cap: "round" }));
      }
    }
    O.push(M("star"));
    O.push(G([["t", 0, drop], ["r", beat === "twinkle" ? (t * 40) % 360 : 0, 0, 0], ["s", 0.92, 0.92]]));
    O.push(P(STAR, { fill: starFill, stroke: k > 0.5 ? lit : C.hatEdge, lw: 0.9, join: "round", glow: k > 0.25 ? { c: lit, o: clamp(k), s: 1.8 } : null }));
    O.push(END); O.push(END);
    O.push(END); // hat

    // ---- the things he works with ----
    if (c.pot > 0.02) {
      O.push(M("pot"));
      O.push(G([["t", 60, 99.4 + (1 - c.pot) * 6], ["s", c.pot * 1.14, c.pot * 1.14]], clamp(c.pot * 1.4)));
      O.push(P([["M", -8, 7.4], ["L", -9.4, 9.6], ["M", 8, 7.4], ["L", 9.4, 9.6]], { stroke: C.potHi, lw: 1.8, cap: "round" }));
      O.push(P([["M", -11.2, -3], ["C", -13.6, 3, -9.5, 8.6, 0, 8.6], ["C", 9.5, 8.6, 13.6, 3, 11.2, -3], ["Z"]], { fill: C.pot, stroke: C.potHi, lw: 1.2, join: "round" }));
      O.push(P([["M", -9.3, 1.2], ["C", -9.4, 4.2, -6.6, 6.4, -3.4, 7]], { stroke: C.potHi, lw: 1, cap: "round", a: 0.7 }));
      O.push(P(ell(0, -3, 12, 2.8), { fill: C.pot, stroke: C.potHi, lw: 1.2 }));
      O.push(P(ell(0, -3, 10, 1.9), { fill: accent, glow: { c: accent, o: 0.9, s: 1.8 } }));
      O.push(P(ell(-2.5, -3.3, 3.4, 0.7), { fill: accentHi, a: 0.8 }));
      O.push(M("bubble"));
      for (var b = 0; b < 5; b++) {
        var bp = red ? b / 5 : (t * 0.6 + b / 5) % 1, br = 0.8 + 1.1 * Math.abs(Math.sin(b * 1.7));
        O.push(P(ell(-6 + b * 3 + Math.sin(t * 2 + b * 1.9) * 1.5, -5 - bp * 15, br * (1 - bp * 0.3), br * (1 - bp * 0.3)),
          { stroke: accentHi, lw: 0.8, fill: accent, a: (1 - bp) * 0.85 }));
      }
      O.push(END);
    }
    if (c.book > 0.02) {
      O.push(M("book"));
      O.push(G([["t", 60, 96.5 + (1 - c.book) * 5], ["s", c.book, c.book]], clamp(c.book * 1.4)));
      O.push(P([["M", -14.2, -5.6], ["L", 0, -3.4], ["L", 14.2, -5.6], ["L", 14.2, 5.4], ["L", 0, 7.6], ["L", -14.2, 5.4], ["Z"]], { fill: C.cover, stroke: C.coverHi, lw: 0.9, join: "round" }));
      O.push(P([["M", -12.8, -6.6], ["Q", -6, -7.6, 0, -4.4], ["L", 0, 5.8], ["Q", -6, 2.8, -12.8, 3.8], ["Z"]], { fill: C.page, stroke: C.pageLo, lw: 0.6, join: "round" }));
      O.push(P([["M", 12.8, -6.6], ["Q", 6, -7.6, 0, -4.4], ["L", 0, 5.8], ["Q", 6, 2.8, 12.8, 3.8], ["Z"]], { fill: C.page, stroke: C.pageLo, lw: 0.6, join: "round" }));
      for (var ln = 0; ln < 3; ln++) {
        O.push(P([["M", -10.8, -4.2 + ln * 2.5], ["Q", -6, -5 + ln * 2.5, -2, -2.6 + ln * 2.5]], { stroke: C.ink, lw: 0.7, cap: "round", a: 0.75 }));
        O.push(P([["M", 10.8, -4.2 + ln * 2.5], ["Q", 6, -5 + ln * 2.5, 2, -2.6 + ln * 2.5]], { stroke: C.ink, lw: 0.7, cap: "round", a: 0.75 }));
      }
      O.push(END);
    }
    if (c.orb > 0.02) {
      O.push(M("orb"));
      O.push(G([["t", 60, 96 + Math.sin(t * 1.8) * 0.8], ["s", c.orb, c.orb]], clamp(c.orb * 1.4)));
      O.push({ k: "radial", cx: 0, cy: 0, r: 15, sy: 1, color: accent, stops: [[0, 0.55], [0.5, 0.25], [1, 0]], a: 1 });
      O.push(P(ell(0, 0, 8.2, 8.2), { fill: C.orb, stroke: accentHi, lw: 1.1 }));
      O.push({ k: "radial", cx: 0, cy: 1, r: 8, sy: 1, color: accent, stops: [[0, 0.9], [0.7, 0.35], [1, 0.05]], a: 1 });
      O.push(M("orb-swirl"));
      for (var sw = 0; sw < 3; sw++) {
        var sa = t * 1.6 + sw * 2.1;
        O.push(P(arc(0, 0, 2.2 + sw * 1.8, sa, sa + 1.9), { stroke: C.spellCore, lw: 0.9, cap: "round", a: 0.85 - sw * 0.2 }));
      }
      O.push(M("orb-shine"));
      O.push(P(arc(0, 0, 6.3, -2.6, -1.5), { stroke: "#FFFFFF", lw: 1.2, cap: "round", a: 0.8 }));
      O.push(END);
    }
    if (c.scroll > 0.02) {
      O.push(M("scroll"));
      var Ls = LAYOUT.scroll;
      O.push(G([["t", 56, 97 + (1 - c.scroll) * 5], ["r", Ls.turn, 0, 0], ["s", c.scroll * Ls.size, c.scroll * Ls.size]], clamp(c.scroll * 1.4)));
      O.push(P([["M", -10, -6.2], ["L", 10, -6.2], ["L", 10, 6.4], ["L", -10, 6.4], ["Z"]], { fill: C.page, stroke: C.pageLo, lw: 0.7, join: "round" }));
      O.push(P([["M", -11.6, -6.4], ["L", 11.6, -6.4]], { stroke: C.gloveEdge, lw: 3.6, cap: "round" }));
      O.push(P([["M", -11.6, -6.4], ["L", 11.6, -6.4]], { stroke: C.pageLo, lw: 2.2, cap: "round" }));
      O.push(P([["M", -11.6, 6.6], ["L", 11.6, 6.6]], { stroke: C.gloveEdge, lw: 3.6, cap: "round" }));
      O.push(P([["M", -11.6, 6.6], ["L", 11.6, 6.6]], { stroke: C.pageLo, lw: 2.2, cap: "round" }));
      // He writes three lines, one after the other, and starts again.
      O.push(M("scroll-line"));
      var row = red ? 2 : Math.floor((t * 0.55) % 3), part = red ? 1 : (t * 0.55) % 1;
      for (var wl = 0; wl < 3; wl++) {
        var done = wl < row ? 1 : wl === row ? part : 0;
        if (done > 0.03) O.push(P([["M", Ls.left, Ls.top + wl * Ls.step], ["L", Ls.left + Ls.length * done, Ls.top + wl * Ls.step]], { stroke: accent, lw: 0.95, cap: "round" }));
      }
      O.push(END);
    }

    // The wand, under the hand that holds it.
    var wa = (c.wandA + m.wandA) * Math.PI / 180, reach = LAYOUT.wand * c.wand;
    var wtx = HR[0] + Math.cos(wa) * reach, wty = HR[1] + Math.sin(wa) * reach;
    if (c.wand > 0.05) {
      var bx = HR[0] - Math.cos(wa) * 3.4, by = HR[1] - Math.sin(wa) * 3.4;
      O.push(M("wand"));
      O.push(P([["M", bx, by], ["L", wtx, wty]], { stroke: C.dark, lw: 3.5, cap: "round", a: 0.9 * c.wand }));
      O.push(P([["M", bx, by], ["L", wtx, wty]], { stroke: C.wand, lw: 1.9, cap: "round", a: c.wand }));
      O.push(P([["M", bx, by], ["L", HR[0] + Math.cos(wa) * 4, HR[1] + Math.sin(wa) * 4]], { stroke: C.wandGrip, lw: 1.9, cap: "round", a: c.wand }));
    }
    // The spell at the wand's tip, or the tip's own glow.
    var s = c.spell;
    if (s > 0.02) {
      var fl = red ? 1 : 1 + 0.07 * Math.sin(t * 17) + 0.05 * Math.sin(t * 29 + 1);
      var ringR = 6.2 * s, rot = ((t * 140) % 360) * Math.PI / 180;
      O.push(G([], Math.min(1, s * 1.4)));
      O.push(M("spell-glow"));
      O.push({ k: "radial", cx: wtx, cy: wty, r: 9 * s * fl + 6, sy: 1, color: accent, stops: [[0, 0.6], [0.5, 0.3], [1, 0]], a: 1 });
      var dashes = [], n = Math.max(6, Math.floor(2 * Math.PI * ringR / 4.8));
      for (var i = 0; i < n; i++) { var da = rot + i * 2 * Math.PI / n; dashes = dashes.concat(arc(wtx, wty, ringR, da, da + 2.2 / ringR)); }
      O.push(M("spell-ring"));
      O.push(P(dashes, { stroke: accentHi, lw: 0.9 }));
      O.push(M("spell-core"));
      O.push(P(ell(wtx, wty, 2.7 * s * fl, 2.7 * s * fl), { fill: C.spellCore, glow: { c: accent, o: 1, s: 2.5 } }));
      // Motes fly off it and fall.
      O.push(M("mote"));
      for (var j = 0; j < 5; j++) {
        var pp = red ? j / 5 : (t * 0.9 + j / 5) % 1, ang = j * 2.4 + 1, pr = 0.95 * (1 - pp * 0.4);
        O.push(P(ell(wtx + Math.cos(ang) * pp * 13, wty + Math.sin(ang) * pp * 13 + pp * pp * 5, pr, pr), { fill: C.particle, a: s * (1 - pp) }));
      }
      O.push(END);
    } else if (c.wand > 0.3) {
      O.push(M("wand-tip"));
      O.push(P(ell(wtx, wty, 1.7, 1.7), { fill: C.spellCore, glow: { c: accent, o: 1, s: 1.8 }, a: c.wand }));
    }

    // The quill, in the writing hand.
    if (c.scroll > 0.3) {
      O.push(M("quill"));
      O.push(G([["t", HR[0] - 1.5, HR[1] + 1], ["r", 28, 0, 0]], c.scroll));
      O.push(P([["M", -0.6, 4.6], ["L", 1.4, -15]], { stroke: C.gloveEdge, lw: 2.4, cap: "round" }));
      O.push(P([["M", 1.4, -15.5], ["C", 7.6, -13, 7.6, -4.5, 0.4, -1], ["C", -4, -5, -3, -12, 1.4, -15.5], ["Z"]], { fill: C.page, stroke: C.gloveEdge, lw: 0.9, join: "round" }));
      O.push(P([["M", -0.6, 4.6], ["L", 1.4, -15]], { stroke: C.pageLo, lw: 1, cap: "round" }));
      O.push(P([["M", 0.9, -8], ["L", 4.3, -9.4], ["M", 0.6, -5], ["L", 3.6, -6.2]], { stroke: C.pageLo, lw: 0.7, cap: "round" }));
      O.push(END);
    }

    // His hands, over everything he holds.
    if (arms > 0.05) {
      hand(O, Sh[0], HL, -1, clamp(arms * 1.5), 0, 0, c.palms, "hand");
      hand(O, Sh[1], HR, 1, clamp(arms * 1.5), c.point, c.pointA, c.palms, "hand");
    }

    // The wisp: a helper at work beside him.
    if (c.wisp > 0.02) {
      var wx = LAYOUT.wisp[0] + Math.sin(t * 1.3) * 2.4, wy = LAYOUT.wisp[1] + Math.sin(t * 2.2) * 2.2;
      O.push(M("wisp"));
      O.push(G([["t", wx, wy], ["s", c.wisp, c.wisp]], clamp(c.wisp * 1.4)));
      O.push({ k: "radial", cx: 0, cy: 0, r: 13, sy: 1, color: accent, stops: [[0, 0.6], [0.5, 0.25], [1, 0]], a: 1 });
      var fl2 = Math.sin(t * 6) * 1.2;
      O.push(P([["M", 0, -10 + fl2 * 0.4], ["C", 2.8 + fl2 * 0.5, -6, 6.2, -2.6, 6.2, 1.2], ["C", 6.2, 4.8, 3.4, 7, 0, 7], ["C", -3.4, 7, -6.2, 4.8, -6.2, 1.2], ["C", -6.2, -2.6, -2.2 + fl2, -5.4, 0, -10 + fl2 * 0.4], ["Z"]],
        { fill: accentHi, stroke: C.spellCore, lw: 0.9, join: "round", glow: { c: accent, o: 1, s: 2 } }));
      O.push(P(ell(-2.1, 1.4, 1, 1.5).concat(ell(2.1, 1.4, 1, 1.5)), { fill: C.dark }));
      O.push(END);
    }

    // Z's while he is out.
    if (c.zzz > 0.02) for (var z = 0; z < 3; z++) {
      var zp = (t * 0.28 + z / 3) % 1, still = LAYOUT.zzz[z];
      O.push(M("zzz"));
      O.push(red ? G([["t", still[0], still[1]], ["s", still[2], still[2]]], c.zzz * still[3])
        : G([["t", 88 + zp * 12 + Math.sin(zp * 6) * 2, 40 - zp * 26], ["s", 0.6 + zp * 0.7, 0.6 + zp * 0.7]], c.zzz * Math.sin(Math.PI * zp)));
      O.push(P(ZED, { stroke: C.dark, lw: 2.6, cap: "round", join: "round", a: 0.7 }));
      O.push(P(ZED, { stroke: C.eye, lw: 1.2, cap: "round", join: "round" }));
      O.push(END);
    }

    // Carried: "?!" and a bead of sweat.
    if (fx.shout) {
      O.push(M("shout"));
      O.push(G([["t", LAYOUT.shout[0], LAYOUT.shout[1]]]));
      // A dark outline under the light strokes keeps it legible on light wallpapers.
      O.push(P(QUESTION.concat(BANG), { stroke: C.face, lw: 4.1, cap: "round", join: "round", a: 0.85 }));
      O.push(P(ell(0, 4.6, 2.25, 2.25).concat(ell(7.6, 4.6, 2.25, 2.25)), { fill: C.face, a: 0.85 }));
      O.push(P(QUESTION.concat(BANG), { stroke: C.eye, lw: 2.3, cap: "round", join: "round", glow: { c: C.eyeGlow, o: 0.9, s: 1.3 } }));
      O.push(P(ell(0, 4.6, 1.35, 1.35).concat(ell(7.6, 4.6, 1.35, 1.35)), { fill: C.eye, glow: { c: C.eyeGlow, o: 0.9, s: 1.3 } }));
      O.push(END);
    }
    if (fx.sweat) {
      O.push(M("sweat"));
      O.push(G([["t", LAYOUT.sweat[1][0], LAYOUT.sweat[1][1]]]));
      O.push(P(SWEAT, { fill: C.magicHi, stroke: C.magic, lw: 0.8 }));
      O.push(END);
    }

    // The sparkle of a finished turn.
    if (spark >= 0) for (var zz = 0; zz < SPARKS.length; zz++) {
      var S = SPARKS[zz], sp = (spark - S[2]) / 0.6, grown = sp > 0 && sp < 1 ? Math.sin(Math.PI * sp) : 0;
      if (grown < 0.01) continue;
      O.push(M("sparkle"));
      O.push(G([["t", S[0], S[1]], ["r", sp * 70, 0, 0], ["s", S[3] * grown, S[3] * grown]]));
      O.push(P(STAR, { fill: C.spark, glow: { c: accent, o: 0.95, s: 2 } }));
      O.push(END);
    }

    O.push(END); // root
    return tagged(O);
  };

  // ---- layers -------------------------------------------------------------
  // What Wiz.qml stacks, each exported at rest into assets/wiz/<name>.svg.
  // `box` is [x, y, width, height] in rig units. A layer without `at` keeps
  // its place in the 120-unit box. One with `at` is drawn in place too, but
  // its box is measured from that point, the one Wiz.qml moves, turns or
  // scales it about. A `local` layer drops the transforms around it and
  // lies about its own origin. `tag` picks the ops a layer shares with
  // another; `state`, `patch`, `light`, `progress` and `effects` set what it
  // is drawn in; `first` keeps that many ops of a part drawn several times.
  // `accent` marks the layers drawn in the magic colour (WizArt.qml).
  //
  // REST is a pose with nothing leaning, so a part lands where the shell
  // expects it. HELD puts the wand hand at one place for the wand's layers.
  var REST = { lean: 0, sc: 1, sy: 1, bodyY: 0, hatY: 0, hatRot: 0, hatLift: 0, tip: 0, eyeX: 0, eyeY: 0 };
  function rest(o) { var p = {}, k; for (k in REST) p[k] = REST[k]; for (k in o) p[k] = o[k]; return p; }
  var HELD = { rx: 60, ry: 60, wandA: 0 };
  var LAYERS = {
    "shadow": { box: [34, 106, 52, 9] },
    "leg": { state: "carried", local: true, box: [-2, -0.5, 4, 11], first: 1 },
    "boot": { local: true, box: [-7, -4.2, 14, 8.4], first: 2 },
    "body": { box: [30, 57, 60, 55] },
    "glow": { box: [42, 61, 36, 25.5] },
    "underlight": { state: "searching", patch: rest({}), box: [40, 68, 40, 24], accent: true },
    // His left eye; the right one is the same picture.
    "eye": { tag: "eyes", at: [53.3, 72.5], box: [-9, -12, 18, 24], first: 1 },
    "eye-happy": { tag: "eyes", patch: { happy: 1 }, at: [53.3, 73.7], box: [-9, -12, 18, 18], first: 1 },
    "dizzy-eye": { effects: { dizzy: true }, local: true, box: [-9, -9, 18, 18], first: 1 },
    // An arm hanging straight down from the left shoulder, LAYOUT.reach
    // long, and the cuff at its end, which keeps its shape as the arm stretches.
    "sleeve": { patch: { lx: 44.5, ly: 111 }, at: [44.5, 87], box: [-7, -1.5, 14, 23], first: 1 },
    "cuff": { patch: { lx: 44.5, ly: 111 }, at: [44.5, 107.6], box: [-6.5, -3, 13, 6], first: 1 },
    "cape": { box: [33, 76, 54, 21.5] },
    "brim": { box: [22, 47, 76, 20] },
    "cone": { at: [60, 57], box: [-22, -54, 48, 62] },
    "thread": { at: [81.1, 11.9], box: [-1.5, -1.5, 3, 9.5] },
    // The star in each light, about its own centre.
    "star-rest": { tag: "star", light: "rest", at: [81.1, 22.3], box: [-12, -12, 24, 24] },
    "star-lit": { tag: "star", light: "ready", at: [81.1, 22.3], box: [-14, -14, 28, 28], accent: true },
    "star-ask": { tag: "star", light: "ask", at: [81.1, 22.3], box: [-14, -14, 28, 28] },
    "star-bad": { tag: "star", light: "bad", at: [81.1, 22.3], box: [-14, -14, 28, 28] },
    "star-off": { tag: "star", light: "off", at: [81.1, 22.3], box: [-6, -6, 12, 12] },
    "ring": { progress: 0, at: [81.1, 22.3], box: [-9, -9, 18, 18] },
    "rune0": { state: "thinking", local: true, box: [-9, -9, 18, 18], accent: true },
    "rune1": { state: "thinking", local: true, box: [-9, -9, 18, 18], accent: true },
    "rune2": { state: "thinking", local: true, box: [-9, -9, 18, 18], accent: true },
    "rune3": { state: "thinking", local: true, box: [-9, -9, 18, 18], accent: true },
    "dizzy-star": { effects: { dizzy: true }, local: true, box: [-11, -11, 22, 22], first: 1 },
    "pot": { state: "brewing", patch: rest({}), at: [60, 99.4], box: [-18, -12.5, 36, 25.5], accent: true },
    "bubble": { state: "brewing", patch: rest({}), at: [53.16, 93.7], box: [-1.6, -1.6, 3.2, 3.2], first: 1, accent: true },
    "book": { state: "reading", patch: rest({}), at: [60, 96.5], box: [-15.5, -9, 31, 18] },
    "orb": { state: "searching", patch: rest({}), at: [60, 96], box: [-15, -15, 30, 30], accent: true },
    "orb-swirl": { state: "searching", patch: rest({}), at: [60, 96], box: [-7, -7, 14, 14] },
    "orb-shine": { state: "searching", patch: rest({}), at: [60, 96], box: [-7.5, -7.5, 9, 7.5] },
    "scroll": { state: "writing", patch: rest({}), at: [56, 97], box: [-16, -11, 32, 22] },
    "scroll-line": { state: "writing", local: true, box: [-8, -3.6, 16, 2], first: 1, accent: true },
    "wand": { state: "pointing", patch: rest(HELD), at: [60, 60], box: [-6, -2.5, 28, 5] },
    "wand-tip": { state: "pointing", patch: rest(HELD), at: [79, 60], box: [-7.5, -7.5, 15, 15], accent: true },
    "spell-glow": { state: "casting", patch: rest(HELD), at: [79, 60], box: [-15, -15, 30, 30], accent: true },
    "spell-ring": { state: "casting", patch: rest(HELD), at: [79, 60], box: [-7.5, -7.5, 15, 15], accent: true },
    "spell-core": { state: "casting", patch: rest(HELD), at: [79, 60], box: [-11, -11, 22, 22], accent: true },
    "mote": { state: "casting", patch: rest(HELD), at: [79, 60], box: [-2, -2, 4, 4], first: 1 },
    "quill": { state: "writing", local: true, box: [-5.5, -17.5, 15, 24] },
    // A mitten at the end of that arm, closed and open; the right hand is
    // its mirror image. The finger points along x from the hand.
    "hand": { patch: { lx: 44.5, ly: 111 }, at: [44.5, 111], box: [-7, -5, 14, 12], first: 4 },
    "hand-open": { tag: "hand", patch: { lx: 44.5, ly: 111, palms: 1 }, at: [44.5, 111], box: [-7, -5, 14, 12], first: 4 },
    "finger": { state: "proud", patch: { rx: 75.5, ry: 111, pointA: 90 }, local: true, box: [-3, -3, 14, 6] },
    "wisp": { state: "delegating", local: true, box: [-14, -17, 28, 31], accent: true },
    "zzz": { state: "asleep", local: true, box: [-4, -4.2, 8, 8.4], first: 2 },
    "sparkle": { state: "finished", local: true, box: [-12, -12, 24, 24], first: 1, accent: true },
    "sweat": { effects: { sweat: true }, local: true, box: [-4, -5, 8, 10] },
    "shout": { effects: { shout: true }, local: true, box: [-9, -14, 22, 24] },
    "dust": { effects: { dust: true }, local: true, box: [-6, -4, 12, 8], first: 3 }
  };

  // A transform list without the steps that do nothing, neighbouring moves
  // added up.
  function tidy(t) {
    var out = [];
    for (var i = 0; i < t.length; i++) {
      var o = t[i], last = out[out.length - 1];
      if (o[0] === "t" && last && last[0] === "t") out[out.length - 1] = ["t", last[1] + o[1], last[2] + o[2]];
      else if (!(o[0] === "r" && o[1] === 0) && !(o[0] === "s" && o[1] === 1 && o[2] === 1)) out.push(o);
      last = out[out.length - 1];
      if (last && last[0] === "t" && Math.abs(last[1]) < 1e-9 && Math.abs(last[2]) < 1e-9) out.pop();
    }
    return out;
  }
  // A layer's ops at rest: its drawing ops alone for a local layer, else
  // with the groups that place them.
  function layerOps(name, opts) {
    opts = opts || {};
    var L = LAYERS[name], rig = new Rig(0), tag = L.tag || name, out = [], kept = 0;
    rig.update(0, L.state || "idle", { reducedMotion: true, light: L.light, progress: L.progress, accent: opts.accent });
    for (var k in L.patch || {}) rig.cur[k] = L.patch[k];
    var ops = rig.ops({ effects: L.effects });
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.k === "g") { if (!L.local) out.push(G(tidy(o.t), 1)); }
      else if (o.k === "end") {
        // A group that holds nothing of this layer goes.
        if (!L.local) { if (out.length && out[out.length - 1].k === "g") out.pop(); else out.push(o); }
      } else if (o.layer === tag && !(L.first && kept >= L.first)) { out.push(o); kept++; }
    }
    return out;
  }
  function layerBox(name) {
    var L = LAYERS[name], at = L.at || [0, 0], b = L.box;
    return [at[0] + b[0], at[1] + b[1], b[2], b[3]];
  }
  // opts.scale: pixels per rig unit for the picture's own size (the box's
  // size in units by default).
  function layerSVG(name, opts) {
    opts = opts || {};
    var box = layerBox(name), ops = layerOps(name, opts);
    if (LAYERS[name].local) ops = [G([])].concat(ops, [END]);
    return toSVG(ops, opts.scale ? box[2] * opts.scale : null, box) + "\n";
  }
  // The progress ring's arc alone, in the ring layer's box: `progress` of
  // the way round, in the colour of the star's light.
  function arcSVG(progress, opts) {
    opts = opts || {};
    var box = layerBox("ring"), at = LAYERS.ring.at, L = LIGHT[opts.light] || LIGHT.busy;
    var lit = L.c ? hex(L.c) : colour(opts.accent), p = Math.max(0, Math.min(0.999, progress));
    var ops = p > 0.005 ? [P(arc(at[0], at[1], 7.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p), { stroke: lit, lw: 1.5, cap: "round" })] : [];
    return toSVG([G([])].concat(ops, [END]), opts.scale ? box[2] * opts.scale : null, box) + "\n";
  }

  // A whole pose at rest as one picture: what the terminal and the
  // assistant's notifications show (scripts/export-wiz, rendered with
  // librsvg); the installer cuts its pictures from stillOps(). Every still
  // shares one box, so poses swapped in place line up. `without` leaves out
  // layers, which the installer moves on its own.
  var STILL_BOX = [-8, -12, 136, 132];
  function stillOps(state, opts) {
    opts = opts || {};
    var rig = new Rig(0), skip = opts.without || [];
    rig.update(0, state, { reducedMotion: true, unread: opts.unread, progress: opts.progress, accent: opts.accent, light: opts.light });
    for (var k in opts.patch || {}) rig.cur[k] = opts.patch[k];
    return rig.ops({ effects: opts.effects }).filter(function (o) {
      return (o.k !== "path" && o.k !== "radial") || skip.indexOf(o.layer) === -1;
    });
  }
  function stillSVG(state, opts) {
    opts = opts || {};
    return toSVG(upright(stillOps(state, opts)), opts.size || null, opts.box || STILL_BOX, opts.id) + "\n";
  }
  // librsvg cuts off the glow of a turned shape, the more the further it is
  // turned: at 45 degrees all but a strip of a sparkle's glow is gone (librsvg
  // 2.63; Chromium and Qt draw it whole). So in a still each glowing shape
  // under a turn is drawn unturned: its points carried through the groups
  // around it, inside a group that undoes them, its line and blur scaled
  // with them. It looks the same, and its filter works in the picture's own
  // frame.
  function affine(m, step) {
    var n;
    if (step[0] === "t") n = [1, 0, 0, 1, step[1], step[2]];
    else if (step[0] === "s") n = [step[1], 0, 0, step[2], 0, 0];
    else if (step[0] === "m") n = step.slice(1);
    else {
      var a = step[1] * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), x = step[2], y = step[3];
      n = [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y];
    }
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function upright(ops) {
    var stack = [[1, 0, 0, 1, 0, 0]], out = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i], m = stack[stack.length - 1];
      if (o.k === "g") stack.push(o.t.reduce(affine, m));
      else if (o.k === "end") stack.pop();
      if (o.k !== "path" || !o.glow || (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9)) { out.push(o); continue; }
      var det = m[0] * m[3] - m[1] * m[2], k = Math.sqrt(Math.abs(det)), p = {};
      var undo = ["m", m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
      for (var key in o) p[key] = o[key];
      p.d = o.d.map(function (seg) {
        var s = [seg[0]];
        for (var j = 1; j < seg.length; j += 2) s.push(m[0] * seg[j] + m[2] * seg[j + 1] + m[4], m[1] * seg[j] + m[3] * seg[j + 1] + m[5]);
        return s;
      });
      if (o.stroke) p.lw = (o.lw || 1) * k;
      p.glow = { c: o.glow.c, o: o.glow.o, s: o.glow.s * k };
      out.push(G([undo]), p, END);
    }
    return out;
  }

  // ---- still SVG ----------------------------------------------------------
  function num(n) { return Math.round(n * 100) / 100; }
  function dStr(d) {
    var out = [];
    for (var i = 0; i < d.length; i++) out.push(d[i][0] + d[i].slice(1).map(num).join(" "));
    return out.join("");
  }
  function tStr(t) {
    return t.map(function (o) {
      if (o[0] === "t") return "translate(" + num(o[1]) + " " + num(o[2]) + ")";
      if (o[0] === "s") return "scale(" + num(o[1]) + " " + num(o[2]) + ")";
      // A whole matrix (upright()) keeps four decimals: it undoes others.
      if (o[0] === "m") return "matrix(" + o.slice(1).map(function (v) { return Math.round(v * 10000) / 10000; }).join(" ") + ")";
      return "rotate(" + num(o[1]) + " " + num(o[2]) + " " + num(o[3]) + ")";
    }).join(" ");
  }
  // size: the width attribute (the height follows the viewBox); viewBox:
  // [x, y, w, h] in rig units, the whole 120-unit box by default; idPrefix
  // keeps gradients and filters apart when several pictures share a page.
  function toSVG(ops, size, viewBox, idPrefix) {
    var vb = viewBox || [0, 0, 120, 120], scale = (size || vb[2]) / vb[2], pre = idPrefix || "w";
    var defs = [], body = [], filters = {}, gid = 0;
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.k === "g") body.push('<g' + (o.t.length ? ' transform="' + tStr(o.t) + '"' : '') + (o.a < 1 ? ' opacity="' + num(o.a) + '"' : '') + '>');
      else if (o.k === "end") body.push('</g>');
      else if (o.k === "radial") {
        var id = pre + "r" + (gid++);
        defs.push('<radialGradient id="' + id + '">' + o.stops.map(function (s) {
          return '<stop offset="' + s[0] + '" stop-color="' + o.color + '" stop-opacity="' + s[1] + '"/>';
        }).join("") + '</radialGradient>');
        body.push('<ellipse cx="' + num(o.cx) + '" cy="' + num(o.cy) + '" rx="' + num(o.r) + '" ry="' + num(o.r * o.sy) + '" fill="url(#' + id + ')"' + (o.a < 1 ? ' opacity="' + num(o.a) + '"' : '') + '/>');
      } else if (o.k === "path") {
        var f = "";
        if (o.glow) {
          var key = o.glow.c + num(o.glow.o) + "_" + o.glow.s;
          if (!filters[key]) {
            filters[key] = pre + "g" + (gid++);
            defs.push('<filter id="' + filters[key] + '" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceAlpha" stdDeviation="' + o.glow.s + '" result="b"/><feFlood flood-color="' + o.glow.c + '" flood-opacity="' + num(o.glow.o) + '"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
          }
          f = ' filter="url(#' + filters[key] + ')"';
        }
        body.push('<path d="' + dStr(o.d) + '" fill="' + (o.fill || "none") + '"' +
          (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.lw || 1) + '"' + (o.cap ? ' stroke-linecap="' + o.cap + '"' : '') + (o.join ? ' stroke-linejoin="' + o.join + '"' : '') : '') +
          (o.a != null && o.a < 1 ? ' opacity="' + num(o.a) + '"' : '') + f + '/>');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + num(vb[2] * scale) + '" height="' + num(vb[3] * scale) +
      '" viewBox="' + vb.map(num).join(" ") + '">' +
      (defs.length ? '<defs>' + defs.join("") + '</defs>' : '') + body.join("") + '</svg>';
  }

  return {
    create: function (seed) { return new Rig(seed); },
    follow: follow,
    shaken: shaken,
    normal: normal,
    carry: carry,
    CARRY: CARRY,
    REACTION: REACTION,
    light: light,
    colour: colour,
    toSVG: toSVG,
    layerOps: layerOps,
    layerBox: layerBox,
    layerSVG: layerSVG,
    arcSVG: arcSVG,
    stillOps: stillOps,
    stillSVG: stillSVG,
    STILL_BOX: STILL_BOX,
    STATES: STATES,
    POSES: POSES,
    META: META,
    LIGHT: LIGHT,
    LAYOUT: LAYOUT,
    LAYERS: LAYERS,
    COLORS: C
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WizRig;
