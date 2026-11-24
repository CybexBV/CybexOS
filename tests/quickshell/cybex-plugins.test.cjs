// Settings -> Plugins lists Cybex OS's own plugins: the six widgets that left
// the built-in bar on 2026-11-24 (Common/CybexPlugins.js). Install adds one
// with the plugin helper and switches it on.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { shellDir, load } = require("./shell.cjs");

const P = load("CybexPlugins.js");
const read = name => fs.readFileSync(path.join(shellDir, name), "utf8");

test("the list names the six plugins that replaced built-in widgets", () => {
    assert.deepEqual(P.PLUGINS.map(plugin => plugin.id).sort(), [
        "digitalpals.fusebox", "digitalpals.github-inbox", "digitalpals.hermes",
        "digitalpals.model-usage", "digitalpals.remote-server", "digitalpals.t3code"
    ]);
    for (const plugin of P.PLUGINS) {
        assert.match(plugin.url, /^https:\/\/github\.com\/DigitalPals\/[A-Za-z0-9-]+$/, plugin.id);
        assert.ok(plugin.name.length > 0 && plugin.name.length <= 20, plugin.id);
        assert.match(plugin.description, /^[A-Z].{20,90}\.$/, plugin.id);
    }
    assert.equal(new Set(P.PLUGINS.map(plugin => plugin.url)).size, P.PLUGINS.length);
});

test("installed is decided by the plugin id in the helper's listing", () => {
    assert.equal(P.installed([{ id: "digitalpals.hermes" }], "digitalpals.hermes"), true);
    assert.equal(P.installed([{ id: "digitalpals.hermes.copy" }], "digitalpals.hermes"), false);
    assert.equal(P.installed(undefined, "digitalpals.hermes"), false);
});

test("the Plugins page offers each one with an Install button", () => {
    const page = read("Settings/PluginsPage.qml");
    assert.match(page, /import "\.\.\/Common\/CybexPlugins\.js" as CybexPlugins/);
    assert.match(page, /title: I18n\.tr\("Cybex OS plugins"\)[\s\S]*?model: CybexPlugins\.PLUGINS/);
    assert.match(page, /enabled: !cybexRow\.installed && !UserPlugins\.busy/);
    assert.match(page, /onTriggered: page\.installCybex\(cybexRow\.modelData\)/);
    assert.match(page,
        /function installCybex\(plugin\)[\s\S]*?UserPlugins\.enqueue\(CybexPlugins\.installCommand\(UserPlugins\.helper, plugin\)\)/);
    // Its result reads under its own list, not under Source.
    assert.match(page, /text: page\.cybexTarget \? page\.status : ""/);
    assert.match(page, /text: page\.targetListed \|\| page\.cybexTarget \? "" : page\.status/);
    // The Cybex OS list comes before the community how-to.
    assert.ok(page.indexOf('"Cybex OS plugins"') < page.indexOf('"Add a plugin"'));
});

// The command Install queues, run for real against a local Git package that
// stands in for a plugin repository.
function run(command, args, options) {
    const result = spawnSync(command, args, { encoding: "utf8", ...options });
    assert.equal(result.status, 0, `${command} ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
}

test("Install adds the package and switches it on, and stops when adding fails", () => {
    const helper = path.join(shellDir, "scripts/user-plugins.py");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cybexos-cybex-plugins-"));
    try {
        const env = { ...process.env, CYBEXOS_PLUGIN_ROOT: path.join(base, "plugins"),
            CYBEXOS_USER_CONFIG_ROOT: path.join(base, "config"),
            XDG_DATA_HOME: path.join(base, "data"), PYTHONDONTWRITEBYTECODE: "1",
            GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
        const source = path.join(base, "source");
        fs.mkdirSync(source);
        const git = (...args) => run("git", ["-C", source, ...args], { env });
        git("init", "-q", "-b", "main");
        git("config", "user.email", "test@example.invalid");
        git("config", "user.name", "Test");
        fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
            id: "digitalpals.hermes", schemaVersion: 1, name: "Hermes Agent", version: "1.0.0",
            kinds: ["bar-widget"], entryPoints: { barWidget: "Widget.qml" }
        }));
        fs.writeFileSync(path.join(source, "Widget.qml"), "import QtQuick\nItem {}\n");
        git("add", ".");
        git("commit", "-q", "-m", "initial");

        const plugin = { ...P.PLUGINS.find(item => item.id === "digitalpals.hermes"), url: source };
        const [command, ...args] = P.installCommand(helper, plugin);
        run(command, args, { env });
        const listing = JSON.parse(run("python3", [helper, "list"], { env }));
        const listed = listing.plugins.find(item => item.id === "digitalpals.hermes");
        assert.ok(listed && listed.enabled && !listed.error, JSON.stringify(listed));
        assert.ok(P.installed(listing.plugins, "digitalpals.hermes"));
        assert.equal(listed.width, 120, "without a width the default slot");

        // A second Install fails at `add`, and `enable` never runs.
        const again = spawnSync(command, args, { encoding: "utf8", env });
        assert.notEqual(again.status, 0);
        const missing = { ...plugin, id: "digitalpals.fusebox", url: path.join(base, "nowhere") };
        const [c2, ...a2] = P.installCommand(helper, missing);
        const failed = spawnSync(c2, a2, { encoding: "utf8", env });
        assert.notEqual(failed.status, 0);
        assert.doesNotMatch(failed.stderr, /enable/i, "enable ran after a failed add");
        assert.ok(!JSON.parse(run("python3", [helper, "list"], { env })).plugins
            .some(item => item.id === "digitalpals.fusebox"));
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("Install gives a plugin that needs it a wider bar slot", () => {
    const t3 = P.PLUGINS.find(item => item.id === "digitalpals.t3code");
    const [, , line, , helper, url, id, width] = P.installCommand("/helper.py", t3);
    assert.match(line, /enable "\$3" --width "\$4"$/);
    assert.deepEqual([helper, url, id, width], ["/helper.py", t3.url, t3.id, "140"]);
    const hermes = P.PLUGINS.find(item => item.id === "digitalpals.hermes");
    assert.equal(P.installCommand("/helper.py", hermes).length, 7, "no width argument without a width");
});
