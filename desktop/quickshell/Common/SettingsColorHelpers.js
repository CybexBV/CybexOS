.pragma library

// Pure colour, contrast, bar-colour and theme-palette helpers for SettingsHelpers.js.
// Keep this file free of Qt APIs so QML and Node tests share the exact same math.

// Named menubar colours. `default` and `macos` are adaptive pairs; the
// remaining presets are intentionally fixed so changing the shell theme does
// not silently change a colour the user chose explicitly. Custom is stored as
// HSL components so hue survives even at zero saturation/lightness.
var BAR_COLOR_CHOICES = [
    { id: "default", label: "Shell Default" },
    { id: "macos", label: "macOS" },
    { id: "black", label: "Black" },
    { id: "graphite", label: "Graphite" },
    { id: "slate", label: "Slate" },
    { id: "white", label: "White" },
    { id: "custom", label: "Custom" }
];

var BAR_COLOR_IDS = BAR_COLOR_CHOICES.map(function(choice) { return choice.id; });

var BAR_COLOR_PRESETS = {
    // The 2026-09 "edge drawer" redesign (Claude Design project 8cf85161,
    // direction 2) rests the shell on a warm charcoal instead of the earlier
    // cool near-black. The light half is a soft grey, Theme.lightBackground,
    // rather than white: a full-width white strip read as glare, and the
    // bar's attached panels share its fill. "White" remains an explicit choice.
    "default": { dark: "#1a1917", light: "#eae9ef" },
    "macos": { dark: "#1d1d1f", light: "#f5f5f7" },
    "black": { dark: "#000000", light: "#000000" },
    "graphite": { dark: "#2c2c2e", light: "#2c2c2e" },
    "slate": { dark: "#344054", light: "#344054" },
    "white": { dark: "#ffffff", light: "#ffffff" }
};

function hexIn(value, fallback) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function channelHex(value) {
    return Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16).padStart(2, "0");
}

function hslToHex(hue, saturation, lightness) {
    var h = ((Number(hue) % 360) + 360) % 360 / 360;
    var s = Math.min(100, Math.max(0, Number(saturation))) / 100;
    var l = Math.min(100, Math.max(0, Number(lightness))) / 100;
    if (!isFinite(h) || !isFinite(s) || !isFinite(l))
        return "#000000";

    if (s === 0)
        return "#" + channelHex(l) + channelHex(l) + channelHex(l);

    function hueChannel(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return "#" + [
        hueChannel(p, q, h + 1 / 3),
        hueChannel(p, q, h),
        hueChannel(p, q, h - 1 / 3)
    ].map(channelHex).join("");
}

function hueToHex(degrees) {
    return hslToHex(degrees, 50, 75);
}

function hexHue(value, fallback) {
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
        return fallback === undefined ? 0 : fallback;
    var r = parseInt(value.slice(1, 3), 16) / 255;
    var g = parseInt(value.slice(3, 5), 16) / 255;
    var b = parseInt(value.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    if (max === min)
        return fallback === undefined ? 0 : fallback;
    var d = max - min;
    var h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
        : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round(h * 60) % 360;
}

function resolveBarColor(mode, themeMode, hue, saturation, lightness) {
    var selected = BAR_COLOR_IDS.indexOf(mode) !== -1 ? mode : "default";
    if (selected === "custom")
        return hslToHex(hue, saturation, lightness);
    var preset = BAR_COLOR_PRESETS[selected] || BAR_COLOR_PRESETS["default"];
    return themeMode === "light" ? preset.light : preset.dark;
}

function rgbIn(value, fallback) {
    var valid = hexIn(value, fallback || "#000000").toLowerCase();
    return [1, 3, 5].map(function(offset) {
        return parseInt(valid.slice(offset, offset + 2), 16) / 255;
    });
}

function relativeLuminance(value) {
    var linear = rgbIn(value).map(function(channel) {
        return channel <= 0.04045 ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
    var first = relativeLuminance(a);
    var second = relativeLuminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mixHex(from, to, amount) {
    var start = rgbIn(from);
    var end = rgbIn(to);
    var t = Math.min(1, Math.max(0, amount));
    return "#" + start.map(function(channel, index) {
        return channelHex(channel + (end[index] - channel) * t);
    }).join("");
}

function foregroundFor(background) {
    return contrastRatio("#ffffff", background) >= contrastRatio("#000000", background)
        ? "#ffffff" : "#000000";
}

// The least foreground mixed over a background that reaches the requested
// contrast. On a mid-luminance colour the hierarchy may collapse to the full
// black/white foreground; readability wins over artificial tonal separation.
function contrastTone(background, foreground, target) {
    if (contrastRatio(foreground, background) < target)
        return foreground;
    var low = 0;
    var high = 1;
    for (var i = 0; i < 16; i++) {
        var mid = (low + high) / 2;
        if (contrastRatio(mixHex(background, foreground, mid), background) >= target)
            high = mid;
        else
            low = mid;
    }
    return mixHex(background, foreground, high);
}

// Disabled content (2026-11, docs/shell-states.md): dimmed so it reads as
// unavailable, but still readable at about 3:1 over the least favourable
// backdrop, a step below the 4.5:1 floor every other piece of copy holds.
var DISABLED_CONTRAST = 3.0;

function disabledTone(background, foreground) {
    return contrastTone(background, foreground, DISABLED_CONTRAST);
}

// The brightest resting card a dark panel carries: Theme.tile, white at this
// alpha over the panel. Dark copy is held against such a card on the lightest
// panel surface rather than against the bare surface, where secondary text on
// a card used to fall to about 3.4:1. Light mode needs no counterpart: its
// reference, a hovered chip on the base, is already darker than any card.
var DARK_CARD_ALPHA = 0.09;

// Preserve a semantic colour when it already reads; otherwise pull it toward
// the bar's automatically selected foreground until it does.
function ensureContrast(value, background, target) {
    var source = hexIn(value, foregroundFor(background)).toLowerCase();
    if (contrastRatio(source, background) >= target)
        return source;
    var foreground = foregroundFor(background);
    var low = 0;
    var high = 1;
    for (var i = 0; i < 16; i++) {
        var mid = (low + high) / 2;
        if (contrastRatio(mixHex(source, foreground, mid), background) >= target)
            high = mid;
        else
            low = mid;
    }
    return mixHex(source, foreground, high);
}

// The 2026-11 state system (docs/shell-states.md). Hover keeps the neutral
// chip; the current item takes an accent tint, so hover and selection can no
// longer look alike (they used to share one fill). The accent marks drawn on
// top of state — a rail's 3 px edge, a selected tile's border, the keyboard
// focus ring — are graphics a person must find, so they are lifted to 3:1
// (WCAG 1.4.11) over `reference`, the least favourable backdrop copy sits on.
// Pure, so state-tokens.test.cjs checks every theme pack in its mode.
function stateTokens(accent, reference, dark) {
    var bg = hexIn(reference, dark ? "#201e1b" : "#e3e2ea").toLowerCase();
    var tone = hexIn(accent, "#60a5fa").toLowerCase();
    var mark = ensureContrast(tone, bg, 3.0);
    return {
        // Alpha of the accent laid over whatever surface hosts the item.
        selectedAlpha: dark ? 0.18 : 0.14,
        selectedMark: mark,
        focusRing: mark,
        // An off switch's track is a quiet tint of the faint ink; its border
        // and knob carry the 3:1 boundary instead (textMid clears 4.5:1).
        switchOffTrackAlpha: dark ? 0.30 : 0.22
    };
}

function barPalette(background) {
    var bg = hexIn(background, "#161424").toLowerCase();
    var foreground = foregroundFor(bg);
    // Small status glyphs need stronger ink than the adjacent secondary copy.
    // The dark anchor matches the bright silver that already reads correctly
    // on the GitHub mark; light bars use its established deep-ink counterpart.
    // Pull either toward the selected foreground only when a custom bar colour
    // needs more contrast.
    var iconBase = foreground === "#ffffff" ? "#c2c6d1" : "#3a3850";
    return {
        background: bg,
        foreground: foreground,
        textHi: foreground,
        textMid: contrastTone(bg, foreground, 7.0),
        textLow: contrastTone(bg, foreground, 5.5),
        textDim: contrastTone(bg, foreground, 4.8),
        textFaint: contrastTone(bg, foreground, 4.5),
        textDisabled: disabledTone(bg, foreground),
        icon: ensureContrast(iconBase, bg, 10.5)
    };
}

// One step of a semantic ladder, in whichever direction the source needs.
// `ensureContrast` only ever *raises* a colour toward the foreground, so a
// palette whose variant already clears the highest target returns that same
// variant for every step and the ladder collapses to one tone — which is
// exactly what Material's own on-surface roles do on a deep container. Fold
// the tone back toward the background in that case, the way the menubar
// builds its own ladder, so each step lands on its floor rather than above it.
function paletteTone(background, source, target) {
    return contrastRatio(source, background) < target
        ? ensureContrast(source, background, target)
        : contrastTone(background, source, target);
}

// Material palettes provide their own on-surface tones. Build the established
// semantic ladder from those roles while retaining the shell-wide AA floor.
function semanticPalette(background, onSurface, onSurfaceVariant) {
    var bg = hexIn(background, "#161424").toLowerCase();
    var hi = ensureContrast(onSurface, bg, 7.0);
    var variant = ensureContrast(onSurfaceVariant, bg, 4.5);
    return {
        background: bg,
        foreground: hi,
        textHi: hi,
        textMid: paletteTone(bg, variant, 7.0),
        textLow: paletteTone(bg, variant, 5.5),
        textDim: paletteTone(bg, variant, 4.8),
        textFaint: paletteTone(bg, variant, 4.5),
        textDisabled: disabledTone(bg, hi),
        icon: paletteTone(bg, variant, 6.0)
    };
}

// ---- named theme palettes ---------------------------------------------------
// A named theme (scripts/theme_packs.py) may set its own surfaces, text and
// status colours. Applying it copies them into `themePalette`, so the look
// survives the theme's removal and loads with the settings, without reading
// any theme file. Theme.qml uses them only while `mode` is the shell's mode
// and the accent source is fixed; the keys left empty are derived.
var THEME_PALETTE_KEYS = ["background", "surface", "surfaceRaised", "text", "textMuted",
    "textDim", "red", "amber", "green"];

// Theme.qml's fixed references, for whatever a theme palette leaves out.
var THEME_FALLBACKS = {
    dark: { background: "#1a1917", text: "#f2f0ea", red: "#ff8f8f", amber: "#ffc26e",
        green: "#63d68c" },
    light: { background: "#eae9ef", text: "#1f1d2b", red: "#c22f2f", amber: "#b5761e",
        green: "#1f9d57" }
};

function defaultThemePalette() {
    var out = { mode: "" };
    THEME_PALETTE_KEYS.forEach(function(key) { out[key] = ""; });
    return out;
}

function themePaletteIn(value) {
    var out = defaultThemePalette();
    if (!value || typeof value !== "object" || (Array.isArray(value) || value instanceof Array))
        return out;
    out.mode = value.mode === "dark" || value.mode === "light" ? value.mode : "";
    THEME_PALETTE_KEYS.forEach(function(key) {
        out[key] = hexIn(value[key], "").toLowerCase();
    });
    return out;
}

function themeIdIn(value) {
    return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(value)
        ? value : "";
}

// A theme palette's surfaces and inks, deriving what it leaves out the way
// Theme.qml layers its own: in both modes a raised surface steps toward
// white, and quieter text steps toward the base. Surfaces are held to their
// mode — at least 7.5:1 against white in dark mode, for the two panel
// surfaces even under a resting card (DARK_CARD_ALPHA), and 9:1 against black
// in light mode — so a theme cannot put light panels in a dark shell, and the
// text floors below are always reachable. Real themes sit far inside both.
function themeSurfaces(palette) {
    var p = themePaletteIn(palette);
    var dark = p.mode !== "light";
    var fallback = THEME_FALLBACKS[dark ? "dark" : "light"];
    function polar(value) {
        return dark ? ensureContrast(value, "#ffffff", 7.5) : ensureContrast(value, "#000000", 9);
    }
    function panel(value) {
        var out = polar(value);
        for (var i = 0; dark && i < 40
                && contrastRatio(mixHex(out, "#ffffff", DARK_CARD_ALPHA), "#ffffff") < 7.5; i++)
            out = mixHex(out, "#000000", 0.05);
        return out;
    }
    var background = panel(p.background || fallback.background);
    var surface = panel(p.surface || mixHex(background, "#ffffff", dark ? 0.03 : 0.35));
    var text = p.text || fallback.text;
    var muted = p.textMuted || mixHex(text, background, 0.25);
    return {
        mode: dark ? "dark" : "light",
        background: background,
        surface: surface,
        surfaceRaised: polar(p.surfaceRaised || mixHex(surface, "#ffffff", dark ? 0.04 : 0.5)),
        text: text,
        // What light mode draws its chips, hover layers and hairlines in.
        ink: ensureContrast(text, background, 7.0),
        textMuted: muted,
        textDim: p.textDim || mixHex(text, background, 0.42),
        red: p.red || fallback.red,
        amber: p.amber || fallback.amber,
        green: p.green || fallback.green
    };
}

// The least favourable backdrop for copy in a themed shell
// (Theme.copyReferenceBg): in dark mode the lightest of the raised surface and
// a resting card (`cardAlpha`, default DARK_CARD_ALPHA) on either panel
// surface; in light mode the darkest surface under a hovered chip of the
// theme's ink.
function themeReference(palette, chipAlpha, cardAlpha) {
    var s = themeSurfaces(palette);
    var byLuminance = function(a, b) { return relativeLuminance(a) - relativeLuminance(b); };
    if (s.mode !== "dark") {
        var darkest = [s.background, s.surface, s.surfaceRaised].sort(byLuminance)[0];
        return mixHex(darkest, s.ink, chipAlpha);
    }
    var card = cardAlpha === undefined ? DARK_CARD_ALPHA : cardAlpha;
    return [s.surfaceRaised, mixHex(s.background, "#ffffff", card),
        mixHex(s.surface, "#ffffff", card)].sort(byLuminance)[2];
}

// The text ladder of a theme palette over `reference`, its least favourable
// backdrop (themeReference). A theme's own colours stay wherever they
// already read; the floors only ever raise them — 7:1 for primary text,
// 4.5:1 for every quieter step — so no theme can make copy unreadable.
function themeTextPalette(reference, palette) {
    var s = themeSurfaces(palette);
    var bg = hexIn(reference, s.background).toLowerCase();
    var hi = ensureContrast(s.text, bg, 7.0);
    return {
        background: bg,
        foreground: hi,
        textHi: hi,
        textMid: ensureContrast(s.textMuted, bg, 4.5),
        textLow: ensureContrast(mixHex(s.textMuted, s.textDim, 0.5), bg, 4.5),
        textDim: ensureContrast(s.textDim, bg, 4.5),
        textFaint: ensureContrast(mixHex(s.textDim, s.background, 0.12), bg, 4.5),
        textDisabled: disabledTone(bg, hi),
        icon: ensureContrast(mixHex(s.text, s.textMuted, 0.5), bg, 4.5)
    };
}

var exported = {
    BAR_COLOR_CHOICES: BAR_COLOR_CHOICES,
    BAR_COLOR_IDS: BAR_COLOR_IDS,
    BAR_COLOR_PRESETS: BAR_COLOR_PRESETS,
    hexIn: hexIn,
    channelHex: channelHex,
    hslToHex: hslToHex,
    hueToHex: hueToHex,
    hexHue: hexHue,
    resolveBarColor: resolveBarColor,
    rgbIn: rgbIn,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    mixHex: mixHex,
    foregroundFor: foregroundFor,
    contrastTone: contrastTone,
    DISABLED_CONTRAST: DISABLED_CONTRAST,
    disabledTone: disabledTone,
    DARK_CARD_ALPHA: DARK_CARD_ALPHA,
    ensureContrast: ensureContrast,
    stateTokens: stateTokens,
    barPalette: barPalette,
    paletteTone: paletteTone,
    semanticPalette: semanticPalette,
    THEME_PALETTE_KEYS: THEME_PALETTE_KEYS,
    THEME_FALLBACKS: THEME_FALLBACKS,
    defaultThemePalette: defaultThemePalette,
    themePaletteIn: themePaletteIn,
    themeIdIn: themeIdIn,
    themeSurfaces: themeSurfaces,
    themeReference: themeReference,
    themeTextPalette: themeTextPalette
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
