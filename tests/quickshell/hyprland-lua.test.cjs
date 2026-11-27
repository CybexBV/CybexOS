const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {root, luaBinary} = require('./keybindings-support.cjs');
const lua = luaBinary();
// Hyprland 0.56.2 statically embeds Lua 5.5, which rejects at compile time what
// 5.4 accepts, such as assigning to a for-loop variable. The Lua tests must run
// the same language version as the compositor.
function luaFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? luaFiles(file) : entry.name.endsWith('.lua') ? [file] : [];
    });
}
test('the Lua tests run the Lua version Hyprland embeds', () => {
    assert.ok(lua, 'Lua is required: run these tests through nix develop');
    const result = spawnSync(lua, ['-v'], {encoding: 'utf8'});
    assert.match(result.stdout + result.stderr, /^Lua 5\.5\./);
});
test('every Hyprland configuration and fixture Lua file compiles under Lua 5.5', () => {
    const files = [...luaFiles(path.join(root, 'desktop/hypr')), ...luaFiles(path.join(root, 'tests/fixtures'))];
    assert.ok(files.some(file => file.endsWith('keybinding_helpers.lua')));
    for (const file of files) {
        const result = spawnSync(lua, ['-', file], {input: 'assert(loadfile(arg[1]))', encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
    }
});
test('the workspace and mode fixtures pass under Lua 5.5', () => {
    assert.ok(lua, 'Lua is required: run these tests through nix develop');
    // The modules keep state under HOME and the XDG directories: all of them private.
    const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cybexos-hypr-lua-'));
    const env = {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.local/state'), XDG_RUNTIME_DIR: path.join(home, 'run')};
    for (const directory of [env.XDG_CONFIG_HOME, env.XDG_STATE_HOME, env.XDG_RUNTIME_DIR])
        fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    try {
        const result = spawnSync(lua, ['tests/fixtures/hyprland-workspace-modes.lua'],
            {cwd: root, encoding: 'utf8', env});
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /fixtures passed \(\d+ assertions\)/);
    } finally {
        fs.rmSync(home, {recursive: true, force: true});
    }
});
