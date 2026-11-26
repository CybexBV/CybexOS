const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shellDir, load } = require("./shell.cjs");

const themePath = path.join(shellDir, "Common", "Theme.qml");
const theme = fs.readFileSync(themePath, "utf8");

// Recursive: the bar's modules live in Bar/Modules/, and a font literal
// hides just as well one directory down.
function qmlFiles(directory) {
    const out = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== "tests")
                walk(full);
            else if (entry.name.endsWith(".qml"))
                out.push(full);
        }
    };
    walk(path.join(shellDir, directory));
    return out;
}

function hexToken(name) {
    const match = theme.match(new RegExp(`readonly property color ${name}:\\s*"(#[0-9a-fA-F]{6})"`));
    assert.ok(match, `Theme.${name} must be a six-digit hex color`);
    return match[1];
}

function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045
        ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
    const lighter = Math.max(luminance(a), luminance(b));
    const darker = Math.min(luminance(a), luminance(b));
    return (lighter + 0.05) / (darker + 0.05);
}

test("every dialog shares the menubar's face", () => {
    for (const file of [...qmlFiles("Bar"), ...qmlFiles("Popovers"), ...qmlFiles("Settings")]) {
        const source = fs.readFileSync(file, "utf8");
        const label = path.relative(shellDir, file);
        assert.doesNotMatch(source, /Theme\.fontSans/,
            `${label} bypasses Theme.fontMenu`);
    }

    // Nothing draws the default family directly any more: it is what fontMenu
    // falls back to, and naming it in a view is how a surface opts out of the
    // Typography setting. That is the whole bug this pass closed.
    assert.match(theme, /return choice \? choice\.family : fontSans;/,
        "fontMenu must fall back to the shipped default rather than a literal");
    const walk = dir => {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== "tests") out.push(...walk(full));
            else if (entry.name.endsWith(".qml")) out.push(full);
        }
        return out;
    };
    for (const file of walk(shellDir)) {
        if (path.relative(shellDir, file) === path.join("Common", "Theme.qml"))
            continue;
        const source = fs.readFileSync(file, "utf8");
        assert.doesNotMatch(source, /Theme\.fontSans/,
            `${path.relative(shellDir, file)} bypasses Theme.fontMenu`);
        // The widget editor once drew a fixed Figtree through Theme.fontUi,
        // so Widgets read as a different face from every other settings page.
        assert.doesNotMatch(source, /(?<![A-Za-z0-9])Theme\.fontUi/,
            `${path.relative(shellDir, file)} bypasses Theme.fontMenu`);
    }
    assert.doesNotMatch(theme, /property string fontUi/,
        "Theme must not offer a second, fixed UI face beside fontMenu");
});

test("the semantic copy ladder keeps a real step at every level", () => {
    // Material's on-surface-variant role already clears the highest target on
    // a deep container, and `ensureContrast` only ever raises a colour, so the
    // wallpaper palette used to return one tone for all five steps: metadata,
    // labels and values rendered identically. Each step must land on its own
    // floor, and be visibly quieter than the step above it.
    const H = load("SettingsHelpers.js");
    const cases = [
        ["wallpaper dark", "#292a2f", "#e3e1e9", "#c6c5d0"],
        ["wallpaper light", "#e9e7ef", "#1b1b21", "#45464f"],
        ["fixed dark", "#171526", "#f5f4fb", "#a1a0a9"]
    ];
    const floors = { textMid: 7.0, icon: 6.0, textLow: 5.5, textDim: 4.8, textFaint: 4.5 };
    for (const [label, bg, onSurface, onVariant] of cases) {
        const ladder = H.semanticPalette(bg, onSurface, onVariant);
        const seen = new Set();
        for (const [step, floor] of Object.entries(floors)) {
            const ratio = H.contrastRatio(ladder[step], bg);
            assert.ok(ratio >= floor,
                `${label}: ${step} falls to ${ratio.toFixed(2)}:1, below its ${floor}:1 floor`);
            assert.ok(ratio < floor + 1.5,
                `${label}: ${step} sits at ${ratio.toFixed(2)}:1, far above its ${floor}:1 floor`);
            seen.add(ladder[step]);
        }
        assert.equal(seen.size, Object.keys(floors).length,
            `${label}: the ladder collapsed to ${seen.size} tone(s)`);
        assert.ok(H.contrastRatio(ladder.textHi, bg) >= 7.0, `${label}: textHi`);
    }
});

test("bar and popovers use semantic sizes with an Omarchy ten-pixel caption floor", () => {
    const files = [...qmlFiles("Bar"), ...qmlFiles("Popovers"), ...qmlFiles("Settings"),
        path.join(shellDir, "OsdWindow.qml")];
    for (const [name, value] of Object.entries(load("Typography.js").resolve(12)))
        assert.ok(value >= 10, `${name} falls below the 10 px caption floor`);

    for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const label = path.relative(shellDir, file);
        assert.doesNotMatch(source, /font\.pixelSize:\s*\d+(?:\.\d+)?/,
            `${label} contains a raw numeric text size`);
        assert.doesNotMatch(source, /font-size\s*:/i,
            `${label} contains an inline HTML text size`);
        assert.doesNotMatch(source, /font\.weight:\s*\d+/,
            `${label} contains a weight that does not map to an installed face`);
    }
});

test("low-emphasis text remains WCAG AA in both palettes", () => {
    // Glass has no fixed background, so contrast is checked against the opaque
    // reference each palette declares: what a panel reads as over the shell's
    // own dimmed wallpaper. The design's own low tone lands at 3.2:1 there,
    // which is why these are lifted rather than copied. Light copy is held on
    // its least favorable backdrop: a hovered chip over the grey base, which
    // is darker than any panel.
    const H = load("SettingsHelpers.js");
    const hover = Number(theme.match(/readonly property real chipHoverAlpha:\s*([\d.]+)/)[1]);
    const lightInk = theme.match(/readonly property color lightInk:[^\n]*"(#[0-9a-fA-F]{6})"/)[1];
    // Dark copy also sits on cards: a tile (darkCardAlpha white) on either
    // panel surface, which is lighter than any bare surface (2026-11 review).
    const card = H.DARK_CARD_ALPHA;
    const references = {
        dark: [hexToken("darkPopBg"), hexToken("darkBackground"), hexToken("darkMenuBg"),
            H.mixHex(hexToken("darkPopBg"), "#ffffff", card),
            H.mixHex(hexToken("darkBackground"), "#ffffff", card)],
        light: [hexToken("lightPopBg"), hexToken("lightBackground"),
            H.mixHex(hexToken("lightBackground"), lightInk, hover)]
    };
    for (const mode of ["dark", "light"]) {
        for (const background of references[mode]) {
            for (const step of ["TextMid", "TextLow", "TextDim", "TextFaint", "Icon"]) {
                const name = mode + step;
                assert.ok(contrast(hexToken(name), background) >= 4.5,
                    `Theme.${name} must have at least 4.5:1 contrast against ${background}`);
            }
        }
    }
    // The one decorative token, and the reason the others cannot be lowered
    // to meet the design: it exists so nothing else has to be.
    assert.match(theme, /\/\/ Decorative only[\s\S]*?readonly property color dotDim/);
});

