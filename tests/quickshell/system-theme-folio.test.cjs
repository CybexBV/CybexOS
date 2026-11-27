// The Folio system theme target (scripts/theme_folio.py): the file manager
// and the Open and Save dialogs take the shell's colours from a folder of
// their own, the one the Folio package reads (nix/packages/folio.nix).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { darkTokens, lightTokens, renderTarget, runDriver, scratch } = require("./system-theme.cjs");

const repoRoot = path.resolve(__dirname, "../..");
const FILE = "folio/theme/colors.toml";

// Folio's own reading of the file (src/theme.cpp readPalette): `key = "#rrggbb"`
// lines, and `mode = "light"` for a light palette.
function palette(text) {
    const colors = {};
    for (const match of text.matchAll(/^\s*([a-z_]+)\s*=\s*["'](#[0-9a-fA-F]{6})["']/gm))
        colors[match[1]] = match[2];
    return { colors, light: /^\s*mode\s*=\s*["']light["']/m.test(text) };
}

function channels(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
    const linear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const [r, g, b] = channels(hex).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Folio's secondary text (Theme::recomputeColors): mix(background, foreground, 0.68).
function secondary(background, foreground) {
    const [a, b] = [channels(background), channels(foreground)];
    return "#" + a.map((x, i) => Math.round((x + (b[i] - x) * 0.68) * 255).toString(16).padStart(2, "0")).join("");
}

test("Folio takes the shell's ground, text, accent and warning colours", () => {
    for (const tokens of [darkTokens(), lightTokens()]) {
        const files = renderTarget("folio", tokens);
        assert.deepEqual(Object.keys(files), [FILE]);
        const { colors, light } = palette(files[FILE]);
        assert.equal(light, tokens.mode === "light");
        assert.deepEqual(Object.keys(colors), ["accent", "background", "dark_background", "lighter_background",
            "foreground", "bright_foreground", "red", "yellow", "orange", "blue", "magenta", "cyan"]);
        assert.equal(colors.accent, tokens.colors.accent);
        assert.equal(colors.background, tokens.colors.background);
        assert.equal(colors.lighter_background, tokens.colors.surfaceRaised);
        assert.equal(colors.bright_foreground, tokens.colors.text);
        assert.equal(colors.red, tokens.colors.red);
        assert.equal(colors.yellow, tokens.colors.amber);
        assert.ok(luminance(colors.dark_background) < luminance(colors.background), "the darker ground is darker");
    }
});

test("Folio's text, sizes and dates and kinds of file read on its background", () => {
    for (const tokens of [darkTokens(), lightTokens()]) {
        const { colors } = palette(renderTarget("folio", tokens)[FILE]);
        const ground = colors.background;
        assert.ok(contrast(secondary(ground, colors.foreground), ground) >= 4.5,
            `${tokens.mode}: secondary text ${secondary(ground, colors.foreground)} on ${ground}`);
        for (const key of ["foreground", "bright_foreground", "blue", "magenta", "cyan"])
            assert.ok(contrast(colors[key], ground) >= 4.5, `${tokens.mode}: ${key} ${colors[key]} on ${ground}`);
        // Plain text stays a step below emphasis whenever readability allows.
        assert.ok(contrast(colors.foreground, ground) <= contrast(colors.bright_foreground, ground));
    }
    // Where the muted text already keeps sizes and dates readable, it is used as it is.
    const tokens = darkTokens();
    tokens.colors.textMuted = "#c8c4ba";
    assert.equal(palette(renderTarget("folio", tokens)[FILE]).colors.foreground, "#c8c4ba");
});

test("the theme is written where the Folio package looks for it", t => {
    const state = scratch(t);
    const result = runDriver(state, ["apply"], JSON.stringify(darkTokens()) + "\n");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.report.targets.folio, { changed: true, error: null });
    const file = path.join(state, FILE);
    assert.equal(palette(fs.readFileSync(file, "utf8")).colors.accent, darkTokens().colors.accent);
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["colors.toml"], "no temporary file is left beside it");
    assert.equal(runDriver(state, ["apply"], JSON.stringify(darkTokens()) + "\n").report.targets.folio.changed, false);

    // Folio reads <folder>/theme/colors.toml, the folder its package names.
    const recipe = fs.readFileSync(path.join(repoRoot, "nix/packages/folio.nix"), "utf8");
    assert.match(recipe, /--replace-fail '"\/\.local\/state\/omarchy\/current"' '"\/\.local\/state\/cybexos\/theme\/folio"'/,
        "Folio reads ~/.local/state/cybexos/theme/folio, the folder theme-apply.py writes");
});
