// Cybex OS's own plugins: widgets that were built into the bar until
// 2026-11-24 and now ship on their own, each from its own repository and
// with its own version. Settings -> Plugins lists them so they stay easy to
// find; Install runs the same helper as `cybex plugin add <url>` and then
// `cybex plugin enable <id>`. The id is each package's manifest id.
//
// `description` is English and translated where it is shown
// (tests/quickshell/i18n-keys.cjs). Names are product names and stay as they
// are. Pure: no Qt APIs, so it loads under Node in tests.

var PLUGINS = [
    {
        id: "digitalpals.model-usage",
        // The built-in widget it replaces (schema 36), whose options it imports.
        widget: "modelusage",
        name: "Model Usage",
        description: "Claude, Codex and Kimi quota limits, resets and cost estimates.",
        url: "https://github.com/DigitalPals/omarchy-modelusage"
    },
    {
        id: "digitalpals.github-inbox",
        widget: "gh",
        name: "GitHub",
        description: "Pull requests, issues and workflow runs from the repositories you watch.",
        url: "https://github.com/DigitalPals/cybexos-github"
    },
    {
        id: "digitalpals.t3code",
        widget: "t3",
        name: "T3 Code",
        description: "Follow and answer your T3 Code sessions from the bar.",
        url: "https://github.com/DigitalPals/cybexos-t3code",
        // Its chip's longest status word needs more than the default 120.
        width: 140
    },
    {
        id: "digitalpals.hermes",
        widget: "hermes",
        name: "Hermes Agent",
        description: "Talk to a Hermes Agent and follow what it is doing.",
        url: "https://github.com/DigitalPals/cybexos-hermes"
    },
    {
        id: "digitalpals.fusebox",
        widget: "fusebox",
        name: "Fusebox",
        description: "Watch a Fusebox server: faults, live load, account health and requests.",
        url: "https://github.com/DigitalPals/cybexos-fusebox"
    },
    {
        id: "digitalpals.remote-server",
        widget: "remote",
        name: "Remote Server",
        description: "CPU, memory, storage and network of a server you reach over SSH.",
        url: "https://github.com/DigitalPals/cybexos-remote-server"
    }
];

// The helper commands Install queues, as one shell line so `enable` runs
// only after `add` succeeded: its own error would otherwise replace the
// reason the install failed. A plugin's `width` is the bar slot it needs;
// `options`, the built-in widget's saved options, become its settings.
function installCommand(helper, plugin, options) {
    var args = [helper, plugin.url, plugin.id];
    var line = 'python3 "$1" add "$2" && python3 "$1" enable "$3"';
    if (plugin.width) {
        args.push(String(plugin.width));
        line += ' --width "$' + args.length + '"';
    }
    if (options && typeof options === "object" && Object.keys(options).length) {
        args.push(JSON.stringify(options));
        // Only what the plugin has no setting for yet: a reinstall keeps the
        // settings it saved since (removal keeps them).
        line += ' && python3 "$1" merge --only-missing "$3" "$' + args.length + '"';
    }
    return ["sh", "-c", line, "sh"].concat(args);
}

function installed(plugins, id) {
    return (plugins || []).some(function(plugin) { return plugin && plugin.id === id; });
}

var exported = {
    PLUGINS: PLUGINS,
    installCommand: installCommand,
    installed: installed
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
