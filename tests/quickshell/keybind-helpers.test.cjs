const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { shellDir, load } = require("./shell.cjs");

const H = load("KeybindHelpers.js");

const SUPER = 64;
const SHIFT = 1;
const CTRL = 4;

function bind(modmask, key, description, extra = {}) {
    return {
        modmask, key, keycode: 0, submap: "", mouse: false, locked: false,
        dispatcher: "__lua", arg: "1", has_description: description !== "",
        description, ...extra
    };
}

// ---- key caps ----------------------------------------------------------------

test("keysyms become the words printed on the keys", () => {
    for (const [key, cap] of [
        ["Return", "Enter"], ["SPACE", "Space"], ["comma", ","], ["SLASH", "/"],
        ["grave", "`"], ["BACKSPACE", "Backspace"], ["left", "←"], ["q", "Q"],
        ["F9", "F9"], ["Print", "Print"], ["mouse_down", "Scroll down"],
        ["mouse:272", "Left button"], ["mouse:273", "Right button"],
        ["XF86AudioRaiseVolume", "Volume up"], ["XF86AudioMicMute", "Mic mute"],
        ["XF86MonBrightnessDown", "Brightness down"],
        ["XF86Launch5", "Launch5"], ["XF86KbdLightOnOff", "Kbd Light On Off"],
        ["code:10", "Key 10"], ["Caps_Lock", "Caps Lock"]
    ])
        assert.equal(H.keyName(key), cap, key);
    assert.equal(H.keyName("", 38), "Key 38");
});

test("descriptions split into group and label at the first colon-space", () => {
    assert.deepEqual(H.parseDescription("Apps: Terminal"), { group: "Apps", label: "Terminal" });
    assert.deepEqual(H.parseDescription("Capture: Copy text: OCR"),
        { group: "Capture", label: "Copy text: OCR" });
    assert.deepEqual(H.parseDescription("Open my notes"), { group: "Other", label: "Open my notes" });
    assert.deepEqual(H.parseDescription("Weird:no space"), { group: "Other", label: "Weird:no space" });
});

// ---- grouping ----------------------------------------------------------------

test("unreadable hyprctl output is an error, not an empty sheet", () => {
    assert.match(H.fromJson("not json").error, /could not be read/);
    assert.match(H.fromJson('{"ok":true}').error, /could not be read/);
    assert.deepEqual(H.fromJson("[]"), { groups: [], error: "" });
    assert.deepEqual(H.groupsFromBinds(null), []);
});

// ---- the shipped bindings ----------------------------------------------------

// Run bindings.lua against a stub `hl`, then shape what it registered the way
// `hyprctl binds -j` reports it, so the vendor file and the parser are checked
// together rather than against a copy of the list.
function vendorBinds(features) {
    const lua = `
local results = {}
local function dispatcher(value) return value or true end
hl = { dsp = { exec_cmd = dispatcher, global = dispatcher, send_key_state = dispatcher,
  layout = dispatcher, focus = dispatcher, exit = dispatcher,
  window = { close = dispatcher, float = dispatcher, move = dispatcher, set_prop = dispatcher,
    drag = dispatcher, resize = dispatcher },
  workspace = { toggle_special = dispatcher },
  group = { toggle = dispatcher, next = dispatcher, prev = dispatcher } } }
local active, order = {}, {}
function hl.unbind(keys) active[keys] = nil end
function hl.bind(keys, _, options)
  if active[keys] == nil then table.insert(order, keys) end
  active[keys] = options or {}
  return { remove = function() end }
end
package.preload.features = function() return { ${features} } end
dofile(arg[1])
for _, keys in ipairs(order) do
  local options = active[keys]
  if options then
    print(keys .. "\\t" .. (options.description or ""))
  end
end
`;
    const result = spawnSync(require("./keybindings-support.cjs").luaBinary(), ["-", path.resolve(shellDir, "../hypr/bindings.lua")],
        { input: lua, encoding: "utf8", env: { ...process.env, HOME: "/home/test" } });
    assert.equal(result.status, 0, result.stderr);
    const masks = { SUPER, SHIFT, CTRL, ALT: 8 };
    return result.stdout.trim().split("\n").map(line => {
        const [keys, description] = line.split("\t");
        const parts = keys.split(" + ");
        const key = parts.pop();
        const modmask = parts.reduce((mask, name) => mask | masks[name], 0);
        return bind(modmask, key, description);
    });
}

const lua = require("./keybindings-support.cjs").luaBinary();

test("every shipped vendor group is ordered and the sheet reads well", { skip: !lua && "Lua is not installed" }, () => {
    const full = vendorBinds("podman = true, developer_tools = true, connected_widgets = true, "
        + "proprietary_apps = true, private_portal = true");
    const minimal = vendorBinds("");
    for (const binds of [full, minimal]) {
        const groups = H.groupsFromBinds(binds);
        for (const group of groups)
            assert.ok(H.GROUP_ORDER.includes(group.title),
                `bindings.lua introduced "${group.title}", which GROUP_ORDER does not place`);
        assert.equal(groups.find(group => group.title === "Other"), undefined);
    }

    const groups = H.groupsFromBinds(full);
    const labels = Object.fromEntries(groups.flatMap(group =>
        group.rows.map(row => [`${group.title}: ${row.label}`, row.combos])));
    assert.deepEqual(labels["Shell: Keyboard shortcuts"], [["Super", "K"]]);
    assert.deepEqual(labels["Apps: AI agent"], [["Super", "Ctrl", "Shift", "A"]]);
    assert.deepEqual(labels["Workspaces: Switch to workspace 1–10"], [["Super", "1…0"]]);
    assert.deepEqual(labels["Windows: Move focus"], [["Super", "← → ↑ ↓"]]);
    assert.deepEqual(labels["Windows: Overview"], [["Super", "Tab"]]);
    assert.deepEqual(labels["Dictation: Start or stop dictation"],
        [["Super", "Ctrl", "X"], ["F9"], ["Mic mute"]]);
    assert.deepEqual(labels["Capture: Screenshot a region or window"], [["Super", "`"], ["Print"]]);
    assert.deepEqual(labels["Capture: Scrolling screenshot"], [["Alt", "Print"], ["Super", "Alt", "`"]]);
    assert.deepEqual(labels["Capture: Record with webcam"], [["Super", "Ctrl", "Shift", "`"]]);
    assert.deepEqual(labels["Capture: Pick a colour"], [["Super", "Print"], ["Super", "Shift", "C"]]);
    assert.deepEqual(labels["Capture: Copy text or QR code from a region"], [["Super", "Shift", "O"]]);
    assert.deepEqual(labels["Development: Docker (lazydocker)"], [["Super", "D"]]);
    // Scratchpad, window groups, zoom and game mode.
    assert.deepEqual(labels["Windows: Show or hide the scratchpad"], [["Super", "-"]]);
    assert.deepEqual(labels["Windows: Move window to the scratchpad"], [["Super", "Shift", "-"]]);
    assert.deepEqual(labels["Windows: Toggle window group"], [["Super", "G"]]);
    assert.deepEqual(labels["Windows: Move window out of group"], [["Super", "Ctrl", "G"]]);
    assert.deepEqual(labels["Windows: Previous or next window in group"], [["Super", "Alt", "← →"]]);
    assert.deepEqual(labels["Windows: Zoom in or out"], [["Super", "Z"]]);
    assert.deepEqual(labels["Windows: Adjust zoom"], [["Super", "Ctrl", "="], ["Super", "Ctrl", "-"]]);
    assert.deepEqual(labels["Shell: Game mode"], [["Super", "Shift", "G"]]);
});

// ---- the overlay -------------------------------------------------------------

test("the sheet draws Hyprland's bindings, with no hand-written fallback", () => {
    const session = fs.readFileSync(path.join(shellDir, "Common/Session.qml"), "utf8");
    const overlay = fs.readFileSync(path.join(shellDir, "ShortcutsOverlay.qml"), "utf8");
    assert.match(session, /command: \["hyprctl", "binds", "-j"\]/);
    assert.match(session, /KeybindHelpers\.fromJson\(output\)/);
    assert.match(session, /function openKeys\(targetScreen\) \{[\s\S]*?refreshShortcuts\(\);[\s\S]*?keysOpen = true;/,
        "each opening reads the bindings again");
    assert.doesNotMatch(session, /label:\s*"[^"]+",\s*keys:\s*\[/, "a hand-written row survived");
    assert.match(overlay,
        /model: root\.visible\s*\?\s*KeybindHelpers\.columnsFor\(Session\.shortcutGroups, shortcutColumns\.count\) : \[\]/);
    assert.match(overlay, /Session\.shortcutsError/, "a failed read is shown");
    assert.match(overlay, /model: shortcut\.modelData\.combos/);
});
