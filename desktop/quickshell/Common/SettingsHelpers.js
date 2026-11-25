.pragma library
.import "SettingsColorHelpers.js" as ColorHelpers
.import "SettingsDictationHelpers.js" as DictationHelpers
.import "SettingsDocumentHelpers.js" as DocumentHelpers

// Pure settings-schema helpers shared by QML and Node tests.
// Keep this file free of Qt APIs so persistence stays deterministic.
// Colour/palette math lives in SettingsColorHelpers.js, dictation rules in
// SettingsDictationHelpers.js, and document/clock utilities in SettingsDocumentHelpers.js.

var VERSION = 36;

var BAR_STYLES = ["hug", "floating", "attached"];
var PALETTE_MODES = ["wallpaper", "fixed"];

// The edge drawer's tabs, in default strip order. Overview is the drawer's
// front door — the Cybex OS button and the session footer live there — so it
// can be reordered but never disabled.
var DRAWER_TAB_IDS = ["overview", "sound", "network", "bluetooth", "power",
    "notifications"];

// How hovering a status glyph treats the drawer. "open" is the desktop-menu
// default: a click latches the session, then crossing switches tabs in place.
var DRAWER_HOVER_MODES = ["off", "open", "always"];

// The Overview tab's optional sections; machine stats and the session footer
// are fixed. A section added later (`processes`, Top processes) needs no
// schema change: normalization fills a missing section in, on.
var DRAWER_OVERVIEW_KEYS = ["media", "sliders", "tiles", "updates", "processes"];
// Idle timeout choices in minutes, 0 meaning never. scripts/hypridle-config.py
// accepts exactly these values when it renders the idle configuration.
var IDLE_LOCK_MINS = [0, 1, 2, 5, 10, 15, 30];
var IDLE_SCREEN_OFF_MINS = [0, 1, 2, 5, 10, 15, 30];
var IDLE_SUSPEND_MINS = [0, 15, 30, 60, 120];

// Schema 31 adds the pointer (Settings -> Appearance -> Pointer). Sizes are
// pixels before the display's scale; "default" is the installation's own (24
// unless a personal module says otherwise). Hyprland hides an idle pointer
// after at most 20 seconds.
var POINTER_SIZES = { large: 32, larger: 48, largest: 64 };
var POINTER_SIZE_IDS = ["default", "large", "larger", "largest"];
var POINTER_IDLE_SECONDS = [0, 3, 10, 20];
// An XCursor theme's directory name; "" is the installation's default. The
// same pattern guards scripts/pointer_xcursor.py and cybexos-session.
var POINTER_THEME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;

function pointerThemeIn(value) {
    return typeof value === "string" && POINTER_THEME.test(value) ? value : "";
}

// Schema 32 adds the Control Center button's icon, which the fish prompt
// shows too: "cybex" (the Cybex OS mark), "os" (the operating system's logo)
// or "nf:<name>:<code>", a Nerd Font icon and its private-use codepoint.
// Common/ControlIconHelpers.js reads these; its normalize() must agree.
var CONTROL_ICON_CUSTOM = /^nf:([a-z0-9]+(?:-[a-z0-9_]+)+):([0-9a-f]{4,5})$/;

function controlIconIn(value, fallback) {
    if (value === "cybex" || value === "os")
        return value;
    var match = typeof value === "string" && value.length <= 80
        ? CONTROL_ICON_CUSTOM.exec(value) : null;
    if (!match)
        return fallback;
    var code = parseInt(match[2], 16);
    return (code >= 0xE000 && code <= 0xF8FF) || (code >= 0xF0000 && code <= 0xFFFFD)
        ? value : fallback;
}

// Reads in default layout order: left, then center, then right. The order
// only decides where an id the settings file has never seen is appended, but
// keeping the two lists in step is what makes that placement predictable.
//
// Schema 4 (the glass menubar) retired three ids. `bell` was absorbed by the
// old combined centre pill; schema 11 deliberately introduces the distinct
// `notifications` id rather than reviving that historical key. `idle` became
// a Control Panel toggle. Schema 24 restores `control` as a configurable
// widget, with the Cybex OS button's existing rightmost placement by default.
// Schema 25 retired `usage`, the first built-in model usage widget, and its
// drawer tab. Schema 26 built Model Usage in as `modelusage`, vendored from
// the digitalpals.model-usage Omarchy plugin, and schema 28 added `fusebox`.
// Schema 30 adds `assistant`, the button that shows and hides the Cybex OS
// Assistant, before the notification and status widgets. Schema 32 moved
// the default `control` to the start of the left column; schema 33 put it
// back at the far right when it still led the left column. Schema 34 returns
// it to the far right from wherever an older file holds it, and drops the
// layout leftovers older writers kept after a reset (migrateMods,
// staleModsLeftover). Schema 36 retires the six connected-service widgets
// (Model Usage, Fusebox, GitHub, T3 Code, Hermes Agent and Remote Server):
// they are Cybex OS plugins now, installed from Settings -> Plugins
// (docs/omarchy-plugin-compatibility.md). Their layout entries are dropped
// from the file on its next save (dropRetired); their options stay in it,
// untouched, so installing the plugin from Settings -> Plugins brings them
// along (Settings.retiredWidgetOptions, CybexPlugins.installCommand).
var MODULE_IDS = [
    "ws", "media", "indicators", "clock", "weather", "notes", "updates",
    "tray", "assistant",
    "notifications", "vol", "wifi", "bt", "batt", "control"
];

var RETIRED_MODULE_IDS = ["bell", "idle", "usage",
    "modelusage", "fusebox", "gh", "t3", "hermes", "remote"];
// Retired widgets that live on as Cybex OS plugins: their saved options are
// the plugin's settings to import, so the file keeps them.
var PLUGIN_WIDGET_IDS = ["modelusage", "fusebox", "gh", "t3", "hermes", "remote"];

var DETAIL_IDS = ["media", "weather", "clock", "updates",
    "notifications", "vol", "batt"];
var DETAIL_POLICIES = ["auto", "prefer", "compact"];

// Space Grotesk is the installer's and the welcome guide's face, and the
// shell's default since the 2026-11 UI review: a sans for headings, body and
// buttons, beside JetBrains Mono for labels and data (Theme.fontNumeric,
// Theme.fontLabel). Only fresh settings and an Appearance reset take it; a
// saved choice is never rewritten (settings files store explicit keys only).
var FONT_CHOICES = [
    { id: "grotesk", label: "Space Grotesk", family: "Space Grotesk" },
    { id: "figtree", label: "Figtree", family: "Figtree" },
    { id: "google", label: "Google Sans Flex", family: "Google Sans Flex" },
    { id: "urbanist", label: "Urbanist", family: "Urbanist" },
    { id: "plex", label: "IBM Plex Sans", family: "IBM Plex Sans" },
    { id: "inter", label: "Inter", family: "Inter" },
    { id: "mono", label: "JetBrainsMono Nerd Font", family: "JetBrainsMono Nerd Font" }
];

var FONT_IDS = FONT_CHOICES.map(function(choice) { return choice.id; });

var BAR_COLOR_CHOICES = ColorHelpers.BAR_COLOR_CHOICES;
var BAR_COLOR_IDS = ColorHelpers.BAR_COLOR_IDS;
var BAR_COLOR_PRESETS = ColorHelpers.BAR_COLOR_PRESETS;

// How a module draws itself in the bar, which is also how the bar groups a
// run of them. `chip` modules retain their shared ordering and separator
// contract; `solo` modules bring their own independent pointer target.
// `time` (clock + weather) and `status` (notifications plus the
// vol/wifi/bt/batt glyph run) group the same way but rest on a filled pill,
// per the edge-drawer design. Notifications can opt back out in modOpts.
var MODULE_GROUPS = {
    ws: "solo", media: "solo", indicators: "solo", clock: "time", weather: "time",
    notes: "solo", updates: "solo", tray: "solo",
    assistant: "solo",
    notifications: "status",
    vol: "status", wifi: "status", bt: "status", batt: "status", control: "solo"
};

var NOTIFICATION_GROUPS = ["solo", "status"];

// The clock-side action inventory is schema, not presentation: persisted
// order and visibility lists are normalized against it so an upgrade can add
// an action without losing the user's existing arrangement. Labels and glyphs
// are shared by the bar and its settings editor to keep both surfaces honest.
var INDICATOR_ACTION_CHOICES = [
    { id: "dictation", label: "Dictation", glyph: "mic" },
    { id: "recording", label: "Screen recording", glyph: "radio_button_checked" },
    { id: "ocr", label: "OCR", glyph: "document_scanner" },
    { id: "reminder", label: "Reminders", glyph: "notifications_active" },
    { id: "night-light", label: "Night light", glyph: "nightlight" },
    { id: "dnd", label: "Focus", glyph: "do_not_disturb_on" },
    { id: "stay-awake", label: "Stay awake", glyph: "coffee" }
];
var INDICATOR_ACTION_IDS = INDICATOR_ACTION_CHOICES.map(
    function(choice) { return choice.id; });

// Dictation comes with the developer tooling feature, which installs voxtype,
// its model and its keys. Without it the action is left off the bar and out
// of the editor, but its saved place and visibility stay, so enabling the
// feature brings it back where it was.
function availableIndicatorIds(ids, dictationAvailable) {
    return ((Array.isArray(ids) || ids instanceof Array) ? ids : []).filter(function(id) {
        return id !== "dictation" || dictationAvailable === true;
    });
}

// A reorder of the shown actions, written back with each action the editor
// did not show returned to its saved index.
function mergeIndicatorOrder(shown, saved) {
    var out = shown.slice();
    ((Array.isArray(saved) || saved instanceof Array) ? saved : []).forEach(function(id, index) {
        if (out.indexOf(id) === -1)
            out.splice(Math.min(index, out.length), 0, id);
    });
    return out;
}

var DICTATION_MODEL_CHOICES = DictationHelpers.DICTATION_MODEL_CHOICES;
var DICTATION_MODELS = DictationHelpers.DICTATION_MODELS;
var DICTATION_LANGUAGES = DictationHelpers.DICTATION_LANGUAGES;
var PARAKEET_LANGUAGES = DictationHelpers.PARAKEET_LANGUAGES;
var DICTATION_CORRECTIONS_MAX = DictationHelpers.DICTATION_CORRECTIONS_MAX;
var DICTATION_CORRECTION_LENGTH = DictationHelpers.DICTATION_CORRECTION_LENGTH;

function parakeetSupports(primary, secondary) {
    return DictationHelpers.parakeetSupports(primary, secondary);
}

function dictationTerms(value) {
    return DictationHelpers.dictationTerms(value);
}

function dictationTermsLine(terms) {
    return DictationHelpers.dictationTermsLine(terms);
}

function dictationCorrectionsIn(value, fallback) {
    return DictationHelpers.dictationCorrectionsIn(value, fallback);
}

function applyDictationCorrections(text, rules) {
    return DictationHelpers.applyDictationCorrections(text, rules);
}

function dictationVocabularyIn(value, fallback) {
    return DictationHelpers.dictationVocabularyIn(value, fallback);
}

// Notes title generation deliberately uses a small, reviewed model catalog.
// Besides making the settings selectable, this prevents a typo from reaching
// either CLI. Claude's aliases are the ones advertised by the installed CLI;
// the Codex tiers and effort support come from the OpenAI model catalog.
var NOTE_CODEX_MODEL_CHOICES = [
    { value: "gpt-5.6-luna", label: "Luna" },
    { value: "gpt-5.6-terra", label: "Terra" },
    { value: "gpt-5.6-sol", label: "Sol" }
];
var NOTE_CLAUDE_MODEL_CHOICES = [
    { value: "fable", label: "Fable" },
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" }
];
var NOTE_CODEX_EFFORT_CHOICES = [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "XHigh" },
    { value: "max", label: "Max" }
];
var NOTE_CLAUDE_EFFORT_CHOICES = NOTE_CODEX_EFFORT_CHOICES.filter(
    function(choice) { return choice.value !== "none"; });
var NOTE_CODEX_MODELS = NOTE_CODEX_MODEL_CHOICES.map(
    function(choice) { return choice.value; });
var NOTE_CLAUDE_MODELS = NOTE_CLAUDE_MODEL_CHOICES.map(
    function(choice) { return choice.value; });
var NOTE_CODEX_EFFORTS = NOTE_CODEX_EFFORT_CHOICES.map(
    function(choice) { return choice.value; });
var NOTE_CLAUDE_EFFORTS = NOTE_CLAUDE_EFFORT_CHOICES.map(
    function(choice) { return choice.value; });

// The Cybex OS Assistant (docs/assistant.md). "auto" follows the `cybex agent`
// default when it is one of the two, else whichever is installed. The model
// lists reuse the reviewed Notes catalogs; "default" leaves the choice to the
// agent's own configuration.
var ASSISTANT_AGENTS = ["auto", "claude", "codex"];
var ASSISTANT_CLAUDE_MODELS = ["default"].concat(NOTE_CLAUDE_MODELS);
var ASSISTANT_CODEX_MODELS = ["default"].concat(NOTE_CODEX_MODELS);
var ASSISTANT_HISTORY = ["month", "forever", "session"];
// When Wiz says a question finished or needs an answer (notifications):
// only while the box is closed, always, or never.
var ASSISTANT_NOTIFY = ["closed", "always", "never"];
// What resting the pointer on Wiz does: a status line, the box, or nothing.
var ASSISTANT_HOVER = ["status", "open", "nothing"];
// The screen edge Wiz is tucked behind; "" when he stands free.
var ASSISTANT_TUCK = ["", "left", "right"];

// Group kinds that rest on a visible pill fill rather than transparent
// furniture. Cluster.qml reads this so the decision lives beside the map.
var FILLED_GROUP_KINDS = ["time", "status"];

function groupFilled(kind) {
    return FILLED_GROUP_KINDS.indexOf(kind) !== -1;
}

function moduleGroup(id, options) {
    var fallback = MODULE_GROUPS[id] || "solo";
    if (id !== "notifications")
        return fallback;
    var entry = options && options.notifications;
    return entry ? enumIn(entry.group, NOTIFICATION_GROUPS, fallback) : fallback;
}

function defaultMods() {
    function mod(id, on) {
        return { id: id, on: on, detail: "auto" };
    }
    return {
        left: [mod("ws", true), mod("media", true)],
        center: [mod("indicators", true), mod("clock", true), mod("weather", false),
            mod("notes", true)],
        right: [
            mod("updates", true),
            mod("tray", false), mod("assistant", true), mod("notifications", true), mod("vol", true),
            mod("wifi", true), mod("bt", true), mod("batt", true), mod("control", true)
        ]
    };
}

// Per-module options: one object per configurable module id. Modules absent
// here have no option controls; a detail-only module may still get a settings
// page for its compaction policy.
function defaultModOpts() {
    return {
        ws: { minSlots: 5, hideEmpty: false, style: "numbers" },
        media: { titleFormat: "title-artist", maxWidth: 180 },
        indicators: {
            mode: "hover",
            order: INDICATOR_ACTION_IDS.slice(),
            enabled: INDICATOR_ACTION_IDS.slice(),
            dictationPrimaryLanguage: "en",
            dictationSecondaryLanguage: "off",
            dictationModel: "base",
            dictationLiveText: true,
            dictationVocabulary: "",
            dictationPrompted: false,
            dictationCorrections: [],
            dictationTidy: "basic",
            dictationPolishAgent: "claude",
            dictationTidyCode: false,
            dictationHistory: "month",
            dictationKeepAudio: false,
            recordingMode: "region",
            recordingShowElapsed: true,
            reminderDisplay: "icon",
            reminderClick: "list",
            reminderMinutes: 15,
            nightLightStartup: "remember",
            dndStartup: "remember",
            dndDefaultMode: "always",
            idleStartup: "off",
            idleDefaultMode: "always",
            idleShowRemaining: false
        },
        clock: {
            seconds: false, showDate: true, dateFormat: "ddd dd",
            showEvents: true, daysAhead: 14, pollMins: 15
        },
        weather: { place: "", lat: 0, lon: 0, pollMins: 20 },
        notes: {
            titleProvider: "off",
            codexModel: "gpt-5.6-luna",
            codexEffort: "none",
            claudeModel: "fable",
            claudeEffort: "low"
        },
        updates: { pollMins: 30, flatpak: true, notify: true },
        tray: { expanded: false },
        notifications: { group: "status" },
        vol: { step: 5, showPct: true, middleClick: "mute" },
        batt: { showPct: true, warnAt: 20, critAt: 10 }
    };
}

function defaultDrawerTabs() {
    return DRAWER_TAB_IDS.map(function(id) {
        return { id: id, on: true };
    });
}

function defaultDrawerOverview() {
    var out = {};
    DRAWER_OVERVIEW_KEYS.forEach(function(key) { out[key] = true; });
    return out;
}

// Sanitize the persisted drawer tab strip: known ids only, first occurrence
// wins, ids the file has never seen are appended in default order, and
// Overview can never be switched off.
function normalizeDrawerTabs(raw) {
    var list = (Array.isArray(raw) || raw instanceof Array) ? raw : [];
    var seen = {};
    var next = [];
    list.forEach(function(entry) {
        var id = entry ? entry.id : undefined;
        if (DRAWER_TAB_IDS.indexOf(id) === -1 || seen[id])
            return;
        seen[id] = true;
        next.push({
            id: id,
            on: id === "overview" ? true
                : typeof entry.on === "boolean" ? entry.on : true
        });
    });
    DRAWER_TAB_IDS.forEach(function(id) {
        if (!seen[id]) {
            // Introduce Bluetooth beside Network without disturbing saved order
            // or visibility. An explicitly positioned Bluetooth stays put.
            var networkIndex = next.findIndex(function(tab) { return tab.id === "network"; });
            if (id === "bluetooth" && networkIndex !== -1)
                next.splice(networkIndex + 1, 0, { id: id, on: true });
            else
                next.push({ id: id, on: true });
        }
    });
    return next;
}

function normalizeDrawerOverview(raw) {
    var next = defaultDrawerOverview();
    if (!raw || typeof raw !== "object")
        return next;
    DRAWER_OVERVIEW_KEYS.forEach(function(key) {
        next[key] = boolIn(raw[key], next[key]);
    });
    return next;
}

function defaults() {
    return {
        wall: "",
        wallDir: "~/Pictures/Wallpapers",
        shuffle: "Off",
        themeMode: "dark",
        glassEnabled: false,
        highContrast: false,
        reducedMotion: false,
        shellFontSize: 14,
        shellScale: 100,
        surfaceBorderMode: "accent",
        surfaceBorderColor: "#9ecbeb",
        surfaceBorderWidth: 0,
        surfaceBorderOpacity: 100,
        surfaceCornerRadius: 16,
        pluginScale: 100,
        pluginBorderMode: "inherit",
        pluginBorderColor: "#9ecbeb",
        pluginBorderWidth: 2,
        pluginBorderOpacity: 100,
        pluginRadius: -1,
        pluginThemeOverrides: {},
        textScale: "default",
        interfaceDensity: "default",
        barColorMode: "default",
        barCustomHue: 230,
        barCustomSaturation: 14,
        barCustomLightness: 9,
        barHeight: 36,
        barRadius: 11,
        font: "grotesk",
        accent: "#60a5fa",
        paletteMode: "wallpaper",
        // The named theme applied last ("" for none) and its explicit
        // palette, copied in when it was applied (ThemeHelpers.js).
        theme: "",
        themePalette: defaultThemePalette(),
        position: "top",
        barStyle: "hug",
        gap: 8,
        autoHide: false,
        exclusive: true,
        clock24: true,
        unit: "c",
        warmth: 3400,
        osd: "bottom",
        scrollFactor: 1.0,
        nightLight: false,
        // Idle timeouts in minutes; 0 disables that step. The defaults match
        // the vendor hypridle.conf, which the idle service falls back to.
        idleLockMins: 5,
        idleScreenOffMins: 10,
        idleSuspendMins: 30,
        idleSuspendBatteryOnly: true,
        // Runtime choices are persisted so a Quickshell service reload can
        // resume them. The Indicators startup policy decides what survives a
        // new login; timed modes retain an absolute deadline rather than
        // receiving a fresh duration after every reload.
        idleInhibitMode: "off",
        idleInhibitUntilMs: 0,
        notifDnd: false,
        notifDndUntilMs: 0,
        notifQuiet: "off",
        notifQuietStart: 1320,
        notifQuietEnd: 420,
        notifDuration: 8,
        notifPosition: "top-right",
        notifDensity: "default",
        notifIcons: true,
        notifProgress: true,
        notifBodyLines: 2,
        // History remains in memory unless the user explicitly opts in.
        notifHistoryPersist: false,
        notifHistoryCount: 50,
        notifHistoryHours: 24,
        notifHistoryBytes: 262144,
        notifDedupeSeconds: 10,
        notifBurstLimit: 5,
        notifPopupGroups: 3,
        notifPopupPerGroup: 3,
        notifFullscreen: "away",
        drawerTabs: defaultDrawerTabs(),
        drawerOverview: defaultDrawerOverview(),
        drawerHover: "open",
        drawerWidth: 400,
        // The Control Center button's icon, and whether the fish prompt
        // shows it too (off: the prompt keeps the operating system's icon).
        controlIcon: "cybex",
        controlIconPrompt: true,
        mods: defaultMods(),
        modOpts: defaultModOpts(),
        // Show the dock in all layouts (Floating always shows it). Pins are desktop
        // entry ids; an empty default lets the dock suggest the browser, Files
        // and the terminal until the person pins or unpins something.
        dock: false,
        dockAutoHide: false,
        dockPinned: [],
        assistantAgent: "auto",
        assistantApprovalPolicy: "always",
        assistantClaudeModel: "default",
        assistantCodexModel: "default",
        assistantSpeak: false,
        // Off until enabled: the screen button attaches a screenshot only
        // to the question it was pressed for.
        assistantScreenContext: false,
        // How long Wiz keeps conversations (cybexos_assistant/history.py):
        // "month" (30 days), "forever", or "session" (never saved to disk).
        assistantHistory: "month",
        // A notification for a question that finished or needs an answer
        // while the box was not on screen (ASSISTANT_NOTIFY).
        assistantNotify: "closed",
        // Resting the pointer on Wiz shows his status; a click opens the box.
        assistantHover: "status",
        // He fades and lets clicks through while the pointer works under him.
        assistantFade: true,
        // The focused window's app and title go with a new question, as a
        // chip the person can remove.
        assistantWindowContext: true,
        // The wide view for long answers, and its width.
        assistantExpanded: false,
        assistantExpandedWidth: 560,
        assistantTuck: "",
        // Where the character was left. Runtime state, persisted so a shell
        // reload or a new session finds it there; -1 is the default corner.
        assistantShown: false,
        assistantScreen: "",
        assistantX: -1,
        assistantY: -1,
        // The pointer: a theme's directory name ("" for the installation's
        // own), its size and hand, and when Hyprland hides it.
        pointerTheme: "",
        pointerSize: "default",
        pointerLeftHanded: false,
        pointerHideTyping: false,
        pointerHideIdle: 0
    };
}

function pluginThemeOverridesIn(value) {
    var out = {};
    if (!value || typeof value !== "object" || (Array.isArray(value) || value instanceof Array)) return out;
    Object.keys(value).slice(0, 256).forEach(function(key) {
        var v = value[key];
        if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(key)) return;
        if (typeof v === "string" && v.length <= 512
            || typeof v === "boolean" || typeof v === "number" && isFinite(v))
            out[key] = String(v);
    });
    return out;
}

function intIn(value, min, max, step, fallback) {
    if (typeof value !== "number" || !isFinite(value))
        return fallback;
    var snapped = step > 1 ? Math.round(value / step) * step : Math.round(value);
    return Math.min(max, Math.max(min, snapped));
}

function realIn(value, min, max, step, fallback) {
    if (typeof value !== "number" || !isFinite(value))
        return fallback;
    var snapped = Math.round(value / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

function enumIn(value, options, fallback) {
    return options.indexOf(value) !== -1 ? value : fallback;
}

function boolIn(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function textIn(value, maxLen, fallback) {
    if (typeof value !== "string")
        return fallback;
    if (value.indexOf("\0") !== -1 || value.indexOf("\n") !== -1 || value.indexOf("\r") !== -1)
        return fallback;
    var trimmed = value.trim();
    return trimmed !== "" && trimmed.length <= maxLen ? trimmed : fallback;
}

function orderedIdsIn(value, known, fallback, appendMissing) {
    if (!(Array.isArray(value) || value instanceof Array))
        return fallback.slice();
    var seen = {};
    var next = [];
    value.forEach(function(id) {
        if (typeof id === "string" && known.indexOf(id) !== -1 && !seen[id]) {
            seen[id] = true;
            next.push(id);
        }
    });
    if (appendMissing) {
        known.forEach(function(id) {
            if (!seen[id])
                next.push(id);
        });
    }
    return next;
}

// Desktop entry ids in order, first occurrence kept, at most 32: the dock's
// pinned apps. Keep the pattern in step with DockHelpers.DESKTOP_ID.
function desktopIdsIn(value, fallback) {
    if (!(Array.isArray(value) || value instanceof Array))
        return fallback.slice();
    var seen = {};
    var next = [];
    value.forEach(function(id) {
        if (typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(id)
                && !seen[id] && next.length < 32) {
            seen[id] = true;
            next.push(id);
        }
    });
    return next;
}

function timestampIn(value, fallback) {
    return typeof value === "number" && isFinite(value)
        && value >= 0 && value <= 1000000000000000
        ? Math.floor(value) : fallback;
}

var DISABLED_CONTRAST = ColorHelpers.DISABLED_CONTRAST;
var DARK_CARD_ALPHA = ColorHelpers.DARK_CARD_ALPHA;
var THEME_PALETTE_KEYS = ColorHelpers.THEME_PALETTE_KEYS;
var THEME_FALLBACKS = ColorHelpers.THEME_FALLBACKS;

function hexIn(value, fallback) { return ColorHelpers.hexIn(value, fallback); }
function hslToHex(hue, saturation, lightness) { return ColorHelpers.hslToHex(hue, saturation, lightness); }
function hueToHex(degrees) { return ColorHelpers.hueToHex(degrees); }
function hexHue(value, fallback) { return ColorHelpers.hexHue(value, fallback); }
function resolveBarColor(mode, themeMode, hue, saturation, lightness) {
    return ColorHelpers.resolveBarColor(mode, themeMode, hue, saturation, lightness);
}
function relativeLuminance(value) { return ColorHelpers.relativeLuminance(value); }
function contrastRatio(a, b) { return ColorHelpers.contrastRatio(a, b); }
function mixHex(from, to, amount) { return ColorHelpers.mixHex(from, to, amount); }
function foregroundFor(background) { return ColorHelpers.foregroundFor(background); }
function disabledTone(background, foreground) { return ColorHelpers.disabledTone(background, foreground); }
function ensureContrast(value, background, target) { return ColorHelpers.ensureContrast(value, background, target); }
function stateTokens(accent, reference, dark) { return ColorHelpers.stateTokens(accent, reference, dark); }
function barPalette(background) { return ColorHelpers.barPalette(background); }
function semanticPalette(background, onSurface, onSurfaceVariant) {
    return ColorHelpers.semanticPalette(background, onSurface, onSurfaceVariant);
}
function defaultThemePalette() { return ColorHelpers.defaultThemePalette(); }
function themePaletteIn(value) { return ColorHelpers.themePaletteIn(value); }
function themeIdIn(value) { return ColorHelpers.themeIdIn(value); }
function themeSurfaces(palette) { return ColorHelpers.themeSurfaces(palette); }
function themeReference(palette, chipAlpha, cardAlpha) {
    return ColorHelpers.themeReference(palette, chipAlpha, cardAlpha);
}
function themeTextPalette(reference, palette) { return ColorHelpers.themeTextPalette(reference, palette); }

function nameIn(value, fallback) {
    return typeof value === "string" && value !== "" && value.indexOf("/") === -1
        ? value : fallback;
}

function pathIn(value, fallback) {
    if (typeof value !== "string" || value === "" || value.indexOf("\0") !== -1
            || value.indexOf("\n") !== -1 || value.indexOf("\r") !== -1)
        return fallback;
    if (value[0] === "/")
        return value.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    if (value === "~" || value.indexOf("~/") === 0) {
        var tail = value === "~" ? "" : value.slice(2);
        if (tail.split("/").some(function(part) { return part === ".."; }))
            return fallback;
        return tail === "" ? "~" : "~/" + tail.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    }
    return fallback;
}

function detailIn(value) {
    return enumIn(value, DETAIL_POLICIES, "auto");
}

// Sanitize a persisted module layout: known ids only, first occurrence wins,
// ids a newer schema knows about but the file does not are appended at their
// default column's end so shipping a new module never requires migration.
function normalizeMods(raw) {
    var base = defaultMods();
    if (!raw || typeof raw !== "object")
        return base;
    var defaultOn = {};
    var defaultCol = {};
    ["left", "center", "right"].forEach(function(col) {
        base[col].forEach(function(entry) {
            defaultOn[entry.id] = entry.on;
            defaultCol[entry.id] = col;
        });
    });
    var seen = {};
    var next = { left: [], center: [], right: [] };
    ["left", "center", "right"].forEach(function(col) {
        var list = (Array.isArray(raw[col]) || raw[col] instanceof Array) ? raw[col] : [];
        list.forEach(function(entry) {
            var id = entry ? entry.id : undefined;
            if (MODULE_IDS.indexOf(id) === -1 || seen[id])
                return;
            seen[id] = true;
            next[col].push({
                id: id,
                on: typeof entry.on === "boolean" ? entry.on : defaultOn[id],
                detail: detailIn(entry.detail)
            });
        });
    });
    MODULE_IDS.forEach(function(id) {
        if (!seen[id])
            next[defaultCol[id]].push({ id: id, on: defaultOn[id], detail: "auto" });
    });
    return next;
}

// Per-key validators for module options. Shared by normalizeModOpts and any
// UI that needs a key's bounds; fallback comes from defaultModOpts.
var MOD_OPT_CHECKS = {
    ws: {
        minSlots: function(v, d) { return intIn(v, 1, 10, 1, d); },
        hideEmpty: boolIn,
        style: function(v, d) { return enumIn(v, ["numbers", "dots"], d); }
    },
    media: {
        titleFormat: function(v, d) {
            return enumIn(v, ["title-artist", "title", "artist-title"], d);
        },
        maxWidth: function(v, d) { return intIn(v, 120, 360, 20, d); }
    },
    indicators: {
        mode: function(v, d) { return enumIn(v, ["hover", "always", "active"], d); },
        order: function(v, d) {
            return orderedIdsIn(v, INDICATOR_ACTION_IDS, d, true);
        },
        enabled: function(v, d) {
            return orderedIdsIn(v, INDICATOR_ACTION_IDS, d, false);
        },
        // One language each, from the offered list: Voxtype is told both
        // (docs/dictation.md), so a list or "auto" here has no meaning.
        dictationPrimaryLanguage: function(v, d) {
            return enumIn(v, DICTATION_LANGUAGES, d);
        },
        dictationSecondaryLanguage: function(v, d) {
            return v === "off" ? v : enumIn(v, DICTATION_LANGUAGES, d);
        },
        dictationModel: function(v, d) { return enumIn(v, DICTATION_MODELS, d); },
        dictationLiveText: boolIn,
        dictationVocabulary: dictationVocabularyIn,
        dictationPrompted: boolIn,
        dictationCorrections: dictationCorrectionsIn,
        dictationTidy: function(v, d) { return enumIn(v, ["off", "basic", "polish"], d); },
        dictationPolishAgent: function(v, d) { return enumIn(v, ["claude", "codex"], d); },
        // Tidy-up in terminals and code editors too (off: they get the words as heard).
        dictationTidyCode: boolIn,
        // Like the assistant's history: 30 days, Forever or Don't save.
        dictationHistory: function(v, d) { return enumIn(v, ["month", "forever", "session"], d); },
        dictationKeepAudio: boolIn,
        recordingMode: function(v, d) {
            return enumIn(v, ["region", "window", "screen"], d);
        },
        recordingShowElapsed: boolIn,
        reminderDisplay: function(v, d) { return enumIn(v, ["icon", "count"], d); },
        reminderClick: function(v, d) { return enumIn(v, ["list", "quick-add"], d); },
        reminderMinutes: function(v, d) { return enumIn(v, [5, 15, 30, 60], d); },
        nightLightStartup: function(v, d) {
            return enumIn(v, ["remember", "off", "on"], d);
        },
        dndStartup: function(v, d) {
            return enumIn(v, ["remember", "off", "on"], d);
        },
        dndDefaultMode: function(v, d) {
            return enumIn(v, ["always", "1h", "quiet-boundary"], d);
        },
        idleStartup: function(v, d) {
            return enumIn(v, ["remember", "off", "on"], d);
        },
        idleDefaultMode: function(v, d) {
            return enumIn(v, ["30m", "1h", "unplugged", "always"], d);
        },
        idleShowRemaining: boolIn
    },
    clock: {
        seconds: boolIn,
        showDate: boolIn,
        showEvents: boolIn,
        daysAhead: function(v, d) { return intIn(v, 1, 31, 1, d); },
        pollMins: function(v, d) { return intIn(v, 5, 60, 5, d); },
        dateFormat: function(v, d) {
            return enumIn(v, ["ddd dd", "ddd d MMM", "dd MMM", "dd-MM"], d);
        }
    },
    weather: {
        place: function(v, d) { return textIn(v, 40, d); },
        lat: function(v, d) { return realIn(v, -90, 90, 0.0001, d); },
        lon: function(v, d) { return realIn(v, -180, 180, 0.0001, d); },
        pollMins: function(v, d) { return intIn(v, 5, 60, 5, d); }
    },
    notes: {
        titleProvider: function(v, d) {
            return enumIn(v, ["off", "codex", "claude"], d);
        },
        codexModel: function(v, d) { return enumIn(v, NOTE_CODEX_MODELS, d); },
        codexEffort: function(v, d) { return enumIn(v, NOTE_CODEX_EFFORTS, d); },
        claudeModel: function(v, d) { return enumIn(v, NOTE_CLAUDE_MODELS, d); },
        claudeEffort: function(v, d) { return enumIn(v, NOTE_CLAUDE_EFFORTS, d); }
    },
    updates: {
        pollMins: function(v, d) { return intIn(v, 10, 240, 10, d); },
        flatpak: boolIn,
        notify: boolIn
    },
    tray: { expanded: boolIn },
    notifications: {
        group: function(v, d) { return enumIn(v, NOTIFICATION_GROUPS, d); }
    },
    vol: {
        step: function(v, d) { return intIn(v, 1, 10, 1, d); },
        showPct: boolIn,
        middleClick: function(v, d) { return enumIn(v, ["mute", "none"], d); }
    },
    batt: {
        showPct: boolIn,
        warnAt: function(v, d) { return intIn(v, 10, 40, 5, d); },
        critAt: function(v, d) { return intIn(v, 5, 20, 5, d); }
    }
};

// Sanitize persisted module options: known modules and keys only, each value
// through its validator; anything unknown or invalid falls back to defaults.
function normalizeModOpts(raw) {
    var next = defaultModOpts();
    if (!raw || typeof raw !== "object")
        return next;
    Object.keys(MOD_OPT_CHECKS).forEach(function(id) {
        var entry = raw[id];
        if (!entry || typeof entry !== "object")
            return;
        Object.keys(MOD_OPT_CHECKS[id]).forEach(function(key) {
            if (key in entry)
                next[id][key] = MOD_OPT_CHECKS[id][key](entry[key], next[id][key]);
        });
    });
    return next;
}

// Provider selection did not exist before schema 21. Even if an older file
// happens to contain a future-shaped key, do not interpret it as consent to
// transmit note text. Model names may migrate harmlessly; enabling a provider
// requires a schema-21-or-newer settings write made through the current UI.
function migrateModOpts(raw, sourceVersion, rawSettings) {
    var next = normalizeModOpts(raw);
    if (typeof sourceVersion !== "number" || sourceVersion < 21)
        next.notes.titleProvider = "off";
    // The old persistent boolean meant the user explicitly chose Always.
    // Preserve that opt-in on the first schema-22 session even though a fresh
    // install's safer startup default is Off.
    if ((typeof sourceVersion !== "number" || sourceVersion < 22)
            && rawSettings && rawSettings.idleInhibited === true)
        next.indicators.idleStartup = "remember";

    // An action order written before OCR existed cannot place the new action:
    // normalization appends unknown-to-that-file ids at the end. Put OCR next
    // to Screen recording instead. If the old visibility list still enabled
    // every action, it was effectively the default, so adopt OCR too; a
    // customized list keeps the new action opt-in. Once OCR appears in the
    // stored order this block no longer runs, so explicitly hiding it sticks.
    var rawIndicators = raw && typeof raw === "object" ? raw.indicators : null;
    if (rawIndicators && (Array.isArray(rawIndicators.order) || rawIndicators.order instanceof Array)
            && rawIndicators.order.indexOf("ocr") === -1) {
        next.indicators.order = next.indicators.order.filter(function(id) {
            return id !== "ocr";
        });
        var recordingIndex = next.indicators.order.indexOf("recording");
        next.indicators.order.splice(recordingIndex === -1
            ? next.indicators.order.length : recordingIndex + 1, 0, "ocr");


    }
    return next;
}

// Older layouts keep every user-chosen column, order, visibility and detail
// policy; each schema addition below places its one new entry. Current-schema
// layouts continue through normal normalization, where missing ids use their
// defaults.
function migrateMods(raw, sourceVersion) {
    if (!raw || typeof raw !== "object")
        return normalizeMods(raw);

    var migrated = { left: [], center: [], right: [] };
    ["left", "center", "right"].forEach(function(col) {
        var list = (Array.isArray(raw[col]) || raw[col] instanceof Array) ? raw[col] : [];
        // Before schema 24 the old control entry was ignored and the Cybex OS
        // button always lived on the right. Replace stale historical entries
        // with that effective placement; later user moves/removals persist.
        if (typeof sourceVersion !== "number" || sourceVersion < 24)
            list = list.filter(function(entry) { return !entry || entry.id !== "control"; });
        migrated[col] = list.map(function(entry) {
            return entry && typeof entry === "object"
                ? { id: entry.id, on: entry.on, detail: entry.detail }
                : entry;
        });
    });

    // Schema 8 adds quick actions beside the clock. Older layouts retain
    // every user-chosen column, order, visibility, and detail policy; the one
    // new entry is inserted immediately before wherever their clock lives.
    var indicatorsPresent = ["left", "center", "right"].some(function(col) {
        return migrated[col].some(function(entry) {
            return entry && entry.id === "indicators";
        });
    });
    if ((typeof sourceVersion !== "number" || sourceVersion < 8)
            && !indicatorsPresent) {
        for (var j = 0; j < 3; j++) {
            var clockCol = ["left", "center", "right"][j];
            var clockIndex = migrated[clockCol].findIndex(function(entry) {
                return entry && entry.id === "clock";
            });
            if (clockIndex === -1)
                continue;
            migrated[clockCol].splice(clockIndex, 0, {
                id: "indicators", on: true, detail: "auto"
            });
            break;
        }
    }

    // Schema 11 gives notification history its own right-side widget. Older
    // layouts retain every existing entry exactly where the user put it; add
    // only the new widget, immediately before the first status item that still
    // lives on the right. If the user moved all status items elsewhere, the
    // right column's end is the least surprising stable fallback.
    var notificationsPresent = ["left", "center", "right"].some(function(col) {
        return migrated[col].some(function(entry) {
            return entry && entry.id === "notifications";
        });
    });
    if ((typeof sourceVersion !== "number" || sourceVersion < 11)
            && !notificationsPresent) {
        var statusIds = ["vol", "wifi", "bt", "batt"];
        var notificationIndex = migrated.right.findIndex(function(entry) {
            return entry && statusIds.indexOf(entry.id) !== -1;
        });
        if (notificationIndex === -1)
            notificationIndex = migrated.right.length;
        migrated.right.splice(notificationIndex, 0, {
            id: "notifications", on: true, detail: "auto"
        });
    }

    // Schema 20 adds local Notes immediately after Weather. Follow Weather to
    // whichever column and position the user chose, preserving every existing
    // module's order, visibility and detail policy byte-for-byte.
    var notesPresent = ["left", "center", "right"].some(function(col) {
        return migrated[col].some(function(entry) {
            return entry && entry.id === "notes";
        });
    });
    if ((typeof sourceVersion !== "number" || sourceVersion < 20)
            && !notesPresent) {
        for (var l = 0; l < 3; l++) {
            var weatherCol = ["left", "center", "right"][l];
            var weatherIndex = migrated[weatherCol].findIndex(function(entry) {
                return entry && entry.id === "weather";
            });
            if (weatherIndex === -1)
                continue;
            migrated[weatherCol].splice(weatherIndex + 1, 0, {
                id: "notes", on: true, detail: "auto"
            });
            break;
        }
    }

    // Schema 30 adds the Cybex OS Assistant's button immediately before the
    // notification and status widgets still on the right, where schema 11
    // put Notifications, so an older layout gains it without anything else
    // moving. Off-feature installs hide it through the bar's auto-rule.
    var assistantPresent = ["left", "center", "right"].some(function(col) {
        return migrated[col].some(function(entry) {
            return entry && entry.id === "assistant";
        });
    });
    if ((typeof sourceVersion !== "number" || sourceVersion < 30)
            && !assistantPresent) {
        var trailingIds = ["notifications", "vol", "wifi", "bt", "batt"];
        var assistantIndex = migrated.right.findIndex(function(entry) {
            return entry && trailingIds.indexOf(entry.id) !== -1;
        });
        if (assistantIndex === -1)
            assistantIndex = migrated.right.length;
        migrated.right.splice(assistantIndex, 0, {
            id: "assistant", on: true, detail: "auto"
        });
    }
    // The Control Center button belongs at the far right. Schema 32 put it
    // first in the left column; schema 33 only moved it back from there, and
    // until schema 34 a widget dragged to another column left a copy behind
    // that won on reload (preserveUnknownMods), so older files can hold it
    // anywhere. It goes to the end of the right column once, keeping its
    // visibility and detail; a later move is the person's own.
    var next = normalizeMods(migrated);
    if (typeof sourceVersion !== "number" || sourceVersion < 34) {
        var control = null;
        ["left", "center", "right"].forEach(function(col) {
            next[col] = next[col].filter(function(entry) {
                if (entry.id !== "control")
                    return true;
                control = entry;
                return false;
            });
        });
        next.right.push(control || { id: "control", on: true, detail: "auto" });
    }
    return next;
}

// Before schema 34 the writer compared a layout entry only with its default
// column, so resetting a layout left behind every widget placed outside its
// default column, and the next load rebuilt a layout around those leftovers.
// A file of that age whose layout holds nothing else never chose a layout.
function staleModsLeftover(raw) {
    if (!raw || typeof raw !== "object" || raw.mods === undefined
            || (typeof raw.v === "number" && raw.v >= 34))
        return false;
    return JSON.stringify(unknownFields(raw.mods, defaultMods())) === JSON.stringify(raw.mods);
}

// Stored legacy values are explicit choices, even when equal to an old
// default. Visual redesigns must never infer ownership from value equality.

// Structural migration keeps the old mode and every explicit value. A
// legacy file with geometry/color fields but no mode retains its old mode;
// a sparse file with neither follows today's default.
function migrateBarStyle(parsed, defaultsValue) {
    if (typeof parsed.v === "number" && parsed.v >= 6)
        return enumIn(parsed.barStyle, BAR_STYLES, defaultsValue);
    if (parsed.floating === false)
        return "attached";
    return parsed.floating === true || ["barHeight", "barRadius", "gap"].some(function(key) {
        return Object.prototype.hasOwnProperty.call(parsed, key);
    }) ? "floating" : defaultsValue;
}

function migratePaletteMode(parsed, defaultsValue) {
    if (typeof parsed.v === "number" && parsed.v >= 6)
        return enumIn(parsed.paletteMode, PALETTE_MODES, defaultsValue);
    if (parsed.accentWall === true)
        return "wallpaper";
    return parsed.accentWall === false || ["accent", "barColorMode", "barCustomHue",
        "barCustomSaturation", "barCustomLightness"].some(function(key) {
        return Object.prototype.hasOwnProperty.call(parsed, key);
    }) ? "fixed" : defaultsValue;
}

function merge(raw) {
    var d = defaults();
    if (!raw || typeof raw !== "object")
        return d;
    var parsed = raw;
    var idleMode = enumIn(parsed.idleInhibitMode,
        ["off", "30m", "1h", "unplugged", "always"],
        parsed.idleInhibited === true ? "always" : d.idleInhibitMode);
    var idleUntil = timestampIn(parsed.idleInhibitUntilMs,
        d.idleInhibitUntilMs);
    if (idleMode !== "30m" && idleMode !== "1h")
        idleUntil = 0;
    var dnd = boolIn(parsed.notifDnd, d.notifDnd);
    var dndUntil = dnd
        ? timestampIn(parsed.notifDndUntilMs, d.notifDndUntilMs) : 0;
    return {
        wall: nameIn(parsed.wall, d.wall),
        wallDir: pathIn(parsed.wallDir, d.wallDir),
        shuffle: enumIn(parsed.shuffle, ["Off", "15m", "1h", "1d"], d.shuffle),
        themeMode: enumIn(parsed.themeMode, ["dark", "light"], d.themeMode),
        glassEnabled: boolIn(parsed.glassEnabled, d.glassEnabled),
        highContrast: boolIn(parsed.highContrast, d.highContrast),
        reducedMotion: boolIn(parsed.reducedMotion, d.reducedMotion),
        shellFontSize: intIn(parsed.shellFontSize, 10, 24, 1, d.shellFontSize),
        shellScale: intIn(parsed.shellScale, 75, 200, 5, d.shellScale),
        surfaceBorderMode: enumIn(parsed.surfaceBorderMode, ["accent", "subtle", "custom"], d.surfaceBorderMode),
        surfaceBorderColor: hexIn(parsed.surfaceBorderColor, d.surfaceBorderColor),
        surfaceBorderWidth: intIn(parsed.surfaceBorderWidth, 0, 8, 1, d.surfaceBorderWidth),
        surfaceBorderOpacity: intIn(parsed.surfaceBorderOpacity, 0, 100, 5, d.surfaceBorderOpacity),
        surfaceCornerRadius: intIn(parsed.surfaceCornerRadius, 0, 30, 1, d.surfaceCornerRadius),
        pluginScale: intIn(parsed.pluginScale, 75, 200, 5, d.pluginScale),
        pluginBorderMode: enumIn(parsed.pluginBorderMode, ["inherit", "accent", "subtle", "custom"], d.pluginBorderMode),
        pluginBorderColor: hexIn(parsed.pluginBorderColor, d.pluginBorderColor),
        pluginBorderWidth: intIn(parsed.pluginBorderWidth, 0, 8, 1, d.pluginBorderWidth),
        pluginBorderOpacity: intIn(parsed.pluginBorderOpacity, 0, 100, 5, d.pluginBorderOpacity),
        pluginRadius: intIn(parsed.pluginRadius, -1, 30, 1, d.pluginRadius),
        pluginThemeOverrides: pluginThemeOverridesIn(parsed.pluginThemeOverrides),
        textScale: enumIn(parsed.textScale, ["default", "large", "larger"], d.textScale),
        interfaceDensity: enumIn(parsed.interfaceDensity,
            ["compact", "default", "comfortable"], d.interfaceDensity),
        barColorMode: enumIn(parsed.barColorMode, BAR_COLOR_IDS, d.barColorMode),
        barCustomHue: intIn(parsed.barCustomHue, 0, 359, 1, d.barCustomHue),
        barCustomSaturation: intIn(parsed.barCustomSaturation, 0, 100, 1,
            d.barCustomSaturation),
        barCustomLightness: intIn(parsed.barCustomLightness, 0, 100, 1,
            d.barCustomLightness),
        barHeight: intIn(parsed.barHeight, 28, 60, 1, d.barHeight),
        barRadius: intIn(parsed.barRadius, 0, 30, 1, d.barRadius),
        font: enumIn(parsed.font, FONT_IDS, d.font),
        accent: hexIn(parsed.accent, d.accent),
        paletteMode: migratePaletteMode(parsed, d.paletteMode),
        theme: themeIdIn(parsed.theme),
        themePalette: themePaletteIn(parsed.themePalette),
        position: enumIn(parsed.position, ["top", "bottom"], d.position),
        barStyle: migrateBarStyle(parsed, d.barStyle),
        gap: intIn(parsed.gap, 4, 24, 1, d.gap),
        autoHide: boolIn(parsed.autoHide, d.autoHide),
        exclusive: boolIn(parsed.exclusive, d.exclusive),
        clock24: boolIn(parsed.clock24, d.clock24),
        unit: enumIn(parsed.unit, ["c", "f"], d.unit),
        warmth: intIn(parsed.warmth, 1900, 4500, 50, d.warmth),
        osd: enumIn(parsed.osd, ["top", "bottom"], d.osd),
        scrollFactor: realIn(parsed.scrollFactor, 0.2, 2.0, 0.1, d.scrollFactor),
        nightLight: boolIn(parsed.nightLight, d.nightLight),
        idleLockMins: enumIn(parsed.idleLockMins, IDLE_LOCK_MINS, d.idleLockMins),
        idleScreenOffMins: enumIn(parsed.idleScreenOffMins, IDLE_SCREEN_OFF_MINS,
            d.idleScreenOffMins),
        idleSuspendMins: enumIn(parsed.idleSuspendMins, IDLE_SUSPEND_MINS,
            d.idleSuspendMins),
        idleSuspendBatteryOnly: boolIn(parsed.idleSuspendBatteryOnly,
            d.idleSuspendBatteryOnly),
        idleInhibitMode: idleMode,
        idleInhibitUntilMs: idleUntil,
        notifDnd: dnd,
        notifDndUntilMs: dndUntil,
        notifQuiet: enumIn(parsed.notifQuiet, ["off", "nights", "custom"], d.notifQuiet),
        notifQuietStart: intIn(parsed.notifQuietStart, 0, 1425, 15, d.notifQuietStart),
        notifQuietEnd: intIn(parsed.notifQuietEnd, 0, 1425, 15, d.notifQuietEnd),
        notifDuration: intIn(parsed.notifDuration, 4, 20, 1, d.notifDuration),
        notifPosition: enumIn(parsed.notifPosition,
            ["top-left", "top-right", "bottom-left", "bottom-right"], d.notifPosition),
        notifDensity: enumIn(parsed.notifDensity,
            ["compact", "default", "roomy"], d.notifDensity),
        notifIcons: boolIn(parsed.notifIcons, d.notifIcons),
        notifProgress: boolIn(parsed.notifProgress, d.notifProgress),
        notifBodyLines: intIn(parsed.notifBodyLines, 0, 3, 1, d.notifBodyLines),
        notifHistoryPersist: boolIn(parsed.notifHistoryPersist, d.notifHistoryPersist),
        notifHistoryCount: intIn(parsed.notifHistoryCount, 10, 200, 1, d.notifHistoryCount),
        notifHistoryHours: intIn(parsed.notifHistoryHours, 1, 168, 1, d.notifHistoryHours),
        notifHistoryBytes: intIn(parsed.notifHistoryBytes, 16384, 1048576, 1, d.notifHistoryBytes),
        notifDedupeSeconds: intIn(parsed.notifDedupeSeconds, 0, 60, 1, d.notifDedupeSeconds),
        notifBurstLimit: intIn(parsed.notifBurstLimit, 1, 20, 1, d.notifBurstLimit),
        notifPopupGroups: intIn(parsed.notifPopupGroups, 1, 5, 1, d.notifPopupGroups),
        notifPopupPerGroup: intIn(parsed.notifPopupPerGroup, 1, 5, 1, d.notifPopupPerGroup),
        notifFullscreen: enumIn(parsed.notifFullscreen, ["away", "show"], d.notifFullscreen),
        drawerTabs: normalizeDrawerTabs(parsed.drawerTabs),
        drawerOverview: normalizeDrawerOverview(parsed.drawerOverview),
        drawerHover: enumIn(parsed.drawerHover, DRAWER_HOVER_MODES, d.drawerHover),
        drawerWidth: intIn(parsed.drawerWidth, 320, 480, 10, d.drawerWidth),
        controlIcon: controlIconIn(parsed.controlIcon, d.controlIcon),
        controlIconPrompt: boolIn(parsed.controlIconPrompt, d.controlIconPrompt),
        mods: parsed.mods === undefined || staleModsLeftover(parsed)
            ? d.mods
            : migrateMods(parsed.mods, parsed.v),
        modOpts: migrateModOpts(parsed.modOpts, parsed.v, parsed),
        dock: boolIn(parsed.dock, d.dock),
        dockAutoHide: boolIn(parsed.dockAutoHide, d.dockAutoHide),
        dockPinned: desktopIdsIn(parsed.dockPinned, d.dockPinned),
        assistantAgent: enumIn(parsed.assistantAgent, ASSISTANT_AGENTS, d.assistantAgent),
        assistantApprovalPolicy: enumIn(parsed.assistantApprovalPolicy, ["always", "ask"],
            d.assistantApprovalPolicy),
        assistantClaudeModel: enumIn(parsed.assistantClaudeModel, ASSISTANT_CLAUDE_MODELS,
            d.assistantClaudeModel),
        assistantCodexModel: enumIn(parsed.assistantCodexModel, ASSISTANT_CODEX_MODELS,
            d.assistantCodexModel),
        assistantSpeak: boolIn(parsed.assistantSpeak, d.assistantSpeak),
        assistantScreenContext: boolIn(parsed.assistantScreenContext, d.assistantScreenContext),
        assistantHistory: enumIn(parsed.assistantHistory, ASSISTANT_HISTORY, d.assistantHistory),
        assistantNotify: enumIn(parsed.assistantNotify, ASSISTANT_NOTIFY, d.assistantNotify),
        assistantHover: enumIn(parsed.assistantHover, ASSISTANT_HOVER, d.assistantHover),
        assistantFade: boolIn(parsed.assistantFade, d.assistantFade),
        assistantWindowContext: boolIn(parsed.assistantWindowContext, d.assistantWindowContext),
        assistantExpanded: boolIn(parsed.assistantExpanded, d.assistantExpanded),
        assistantExpandedWidth: intIn(parsed.assistantExpandedWidth, 420, 1200, 1, d.assistantExpandedWidth),
        assistantTuck: enumIn(parsed.assistantTuck, ASSISTANT_TUCK, d.assistantTuck),
        assistantShown: boolIn(parsed.assistantShown, d.assistantShown),
        assistantScreen: textIn(parsed.assistantScreen, 64, d.assistantScreen),
        assistantX: intIn(parsed.assistantX, -1, 32768, 1, d.assistantX),
        assistantY: intIn(parsed.assistantY, -1, 32768, 1, d.assistantY),
        pointerTheme: pointerThemeIn(parsed.pointerTheme),
        pointerSize: enumIn(parsed.pointerSize, POINTER_SIZE_IDS, d.pointerSize),
        pointerLeftHanded: boolIn(parsed.pointerLeftHanded, d.pointerLeftHanded),
        pointerHideTyping: boolIn(parsed.pointerHideTyping, d.pointerHideTyping),
        pointerHideIdle: enumIn(parsed.pointerHideIdle, POINTER_IDLE_SECONDS, d.pointerHideIdle)
    };
}

function quietRange(quiet, start, end) { return DocumentHelpers.quietRange(quiet, start, end); }
function quietActive(quiet, start, end, minutesNow) {
    return DocumentHelpers.quietActive(quiet, start, end, minutesNow);
}
function formatMinutes(total) { return DocumentHelpers.formatMinutes(total); }
function parseClockMinutes(text, step) { return DocumentHelpers.parseClockMinutes(text, step); }
function clone(value) { return DocumentHelpers.clone(value); }
function restoreSnapshot(current, snapshot) { return DocumentHelpers.restoreSnapshot(current, snapshot); }

// The value one key holds after a save and reload: what merge() makes of it.
// Writers pass values through this so memory never holds one the file cannot
// reproduce — a stepped slider's 0.7000000000000001, an out-of-range number —
// which would make the reload of our own save look like an external edit.
// Two keys depend on another key in merge() (an expiry is dropped while its
// mode is off); callers set those in either order, so they are checked alone.
function normalizeKey(key, value) {
    if (key === "idleInhibitUntilMs" || key === "notifDndUntilMs")
        return timestampIn(value, 0);
    var raw = { v: VERSION };
    raw[key] = value;
    var merged = merge(raw);
    return Object.prototype.hasOwnProperty.call(merged, key) ? merged[key] : value;
}

// A file written by a newer shell carries keys and option values this one
// would drop, so it must not be rewritten here (rollback after an update).
function isNewerSchema(parsed) {
    return !!parsed && typeof parsed.v === "number" && parsed.v > VERSION;
}

// Deterministic serialization: fixed key order so snapshot equality can be
// compared as strings (self-write echo detection) and diffs stay readable.
function serialize(settings) {
    var ordered = { v: VERSION };
    Object.keys(defaults()).forEach(function(key) {
        ordered[key] = settings[key];
    });
    return JSON.stringify(ordered, null, 2) + "\n";
}

// Presence is ownership: a value explicitly set to today's default remains
// an override. New files are sparse; every stored legacy key is conservatively
// adopted as explicit. Unknown fields are carried through without validation.
function overrideKeys(raw) {
    var known = defaults();
    var keys = Object.keys(raw || {}).filter(function(key) {
        if (key === "mods" && staleModsLeftover(raw))
            return false;
        return Object.prototype.hasOwnProperty.call(known, key)
            && JSON.stringify(unknownFields(raw[key], schemaFor(key, known))) !== JSON.stringify(raw[key]);
    });
    return keys;
}

// What a stored value is checked against for fields this schema understands.
// A layout entry is understood in any column, not just its default one:
// every built-in widget may be placed in any section.
function schemaFor(key, known) {
    if (key !== "mods")
        return known[key];
    var entries = MODULE_IDS.map(function(id) {
        return { id: id, on: true, detail: "auto" };
    });
    return { left: entries, center: entries, right: entries };
}

function preserveUnknownMods(original, replacement) {
    return DocumentHelpers.preserveUnknownMods(original, replacement);
}
function unknownFields(original, schema) { return DocumentHelpers.unknownFields(original, schema); }
function preserveUnknown(original, replacement) { return DocumentHelpers.preserveUnknown(original, replacement); }
function rebaseDocuments(base, desired, current, path) {
    return DocumentHelpers.rebaseDocuments(base, desired, current, path);
}

// A retired widget's layout entries and options are not a newer schema's
// fields to carry along: they belong to a widget this shell no longer has.
// A widget that became a plugin keeps its options for the plugin to import.
function dropRetired(document) {
    if (document.mods && typeof document.mods === "object") {
        ["left", "center", "right"].forEach(function(col) {
            if (Array.isArray(document.mods[col]) || document.mods[col] instanceof Array)
                document.mods[col] = document.mods[col].filter(function(entry) {
                    return !entry || RETIRED_MODULE_IDS.indexOf(entry.id) === -1;
                });
        });
    }
    if (document.modOpts && typeof document.modOpts === "object"
            && !(Array.isArray(document.modOpts) || document.modOpts instanceof Array)) {
        RETIRED_MODULE_IDS.forEach(function(id) {
            if (PLUGIN_WIDGET_IDS.indexOf(id) === -1)
                delete document.modOpts[id];
        });
    }
    return document;
}

function serializeDocument(settings, original, explicitKeys) {
    var out = dropRetired(clone(original || {}));
    out.v = VERSION;
    Object.keys(defaults()).forEach(function(key) {
        if (explicitKeys.indexOf(key) !== -1)
            out[key] = key === "mods" ? preserveUnknownMods(out[key], settings[key])
                : preserveUnknown(out[key], settings[key]);
        else {
            var extra = unknownFields(out[key], schemaFor(key, defaults()));
            if (extra === undefined)
                delete out[key];
            else
                out[key] = extra;
        }
    });
    return JSON.stringify(out, null, 2) + "\n";
}

function parse(text) { return DocumentHelpers.parse(text); }

var exported = {
    VERSION: VERSION,
    BAR_STYLES: BAR_STYLES,
    PALETTE_MODES: PALETTE_MODES,
    MODULE_IDS: MODULE_IDS,
    RETIRED_MODULE_IDS: RETIRED_MODULE_IDS,
    PLUGIN_WIDGET_IDS: PLUGIN_WIDGET_IDS,
    MODULE_GROUPS: MODULE_GROUPS,
    NOTIFICATION_GROUPS: NOTIFICATION_GROUPS,
    INDICATOR_ACTION_CHOICES: INDICATOR_ACTION_CHOICES,
    INDICATOR_ACTION_IDS: INDICATOR_ACTION_IDS,
    availableIndicatorIds: availableIndicatorIds,
    mergeIndicatorOrder: mergeIndicatorOrder,
    DICTATION_MODEL_CHOICES: DICTATION_MODEL_CHOICES,
    DICTATION_LANGUAGES: DICTATION_LANGUAGES,
    PARAKEET_LANGUAGES: PARAKEET_LANGUAGES,
    parakeetSupports: parakeetSupports,
    dictationTerms: dictationTerms,
    dictationTermsLine: dictationTermsLine,
    dictationCorrectionsIn: dictationCorrectionsIn,
    applyDictationCorrections: applyDictationCorrections,
    dictationVocabularyIn: dictationVocabularyIn,
    NOTE_CODEX_MODEL_CHOICES: NOTE_CODEX_MODEL_CHOICES,
    NOTE_CLAUDE_MODEL_CHOICES: NOTE_CLAUDE_MODEL_CHOICES,
    NOTE_CODEX_EFFORT_CHOICES: NOTE_CODEX_EFFORT_CHOICES,
    NOTE_CLAUDE_EFFORT_CHOICES: NOTE_CLAUDE_EFFORT_CHOICES,
    ASSISTANT_AGENTS: ASSISTANT_AGENTS,
    ASSISTANT_CLAUDE_MODELS: ASSISTANT_CLAUDE_MODELS,
    ASSISTANT_CODEX_MODELS: ASSISTANT_CODEX_MODELS,
    moduleGroup: moduleGroup,
    FILLED_GROUP_KINDS: FILLED_GROUP_KINDS,
    groupFilled: groupFilled,
    DETAIL_IDS: DETAIL_IDS,
    DETAIL_POLICIES: DETAIL_POLICIES,
    FONT_CHOICES: FONT_CHOICES,
    FONT_IDS: FONT_IDS,
    BAR_COLOR_CHOICES: BAR_COLOR_CHOICES,
    BAR_COLOR_IDS: BAR_COLOR_IDS,
    BAR_COLOR_PRESETS: BAR_COLOR_PRESETS,
    DRAWER_TAB_IDS: DRAWER_TAB_IDS,
    DRAWER_HOVER_MODES: DRAWER_HOVER_MODES,
    DRAWER_OVERVIEW_KEYS: DRAWER_OVERVIEW_KEYS,
    IDLE_LOCK_MINS: IDLE_LOCK_MINS,
    POINTER_SIZES: POINTER_SIZES,
    POINTER_SIZE_IDS: POINTER_SIZE_IDS,
    POINTER_IDLE_SECONDS: POINTER_IDLE_SECONDS,
    pointerThemeIn: pointerThemeIn,
    controlIconIn: controlIconIn,
    IDLE_SCREEN_OFF_MINS: IDLE_SCREEN_OFF_MINS,
    IDLE_SUSPEND_MINS: IDLE_SUSPEND_MINS,
    defaults: defaults,
    defaultMods: defaultMods,
    defaultModOpts: defaultModOpts,
    defaultDrawerTabs: defaultDrawerTabs,
    defaultDrawerOverview: defaultDrawerOverview,
    normalizeDrawerTabs: normalizeDrawerTabs,
    normalizeDrawerOverview: normalizeDrawerOverview,
    normalizeMods: normalizeMods,
    normalizeModOpts: normalizeModOpts,
    migrateModOpts: migrateModOpts,
    migrateMods: migrateMods,
    migrateBarStyle: migrateBarStyle,
    migratePaletteMode: migratePaletteMode,
    pathIn: pathIn,
    detailIn: detailIn,
    quietRange: quietRange,
    quietActive: quietActive,
    formatMinutes: formatMinutes,
    parseClockMinutes: parseClockMinutes,
    hueToHex: hueToHex,
    hexHue: hexHue,
    hslToHex: hslToHex,
    resolveBarColor: resolveBarColor,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    foregroundFor: foregroundFor,
    ensureContrast: ensureContrast,
    DISABLED_CONTRAST: DISABLED_CONTRAST,
    disabledTone: disabledTone,
    DARK_CARD_ALPHA: DARK_CARD_ALPHA,
    stateTokens: stateTokens,
    mixHex: mixHex,
    barPalette: barPalette,
    semanticPalette: semanticPalette,
    THEME_PALETTE_KEYS: THEME_PALETTE_KEYS,
    defaultThemePalette: defaultThemePalette,
    themePaletteIn: themePaletteIn,
    themeIdIn: themeIdIn,
    themeSurfaces: themeSurfaces,
    themeReference: themeReference,
    themeTextPalette: themeTextPalette,
    clone: clone,
    restoreSnapshot: restoreSnapshot,
    merge: merge,
    normalizeKey: normalizeKey,
    isNewerSchema: isNewerSchema,
    serialize: serialize,
    overrideKeys: overrideKeys,
    preserveUnknown: preserveUnknown,
    unknownFields: unknownFields,
    preserveUnknownMods: preserveUnknownMods,
    dropRetired: dropRetired,
    staleModsLeftover: staleModsLeftover,
    serializeDocument: serializeDocument,
    rebaseDocuments: rebaseDocuments,
    parse: parse
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
