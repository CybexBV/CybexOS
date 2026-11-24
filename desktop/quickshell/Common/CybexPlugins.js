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
        name: "Model Usage",
        description: "Claude, Codex and Kimi quota limits, resets and cost estimates.",
        url: "https://github.com/DigitalPals/omarchy-modelusage"
    },
    {
        id: "digitalpals.github-inbox",
        name: "GitHub",
        description: "Pull requests, issues and workflow runs from the repositories you watch.",
        url: "https://github.com/DigitalPals/cybexos-github"
    },
    {
        id: "digitalpals.t3code",
        name: "T3 Code",
        description: "Follow and answer your T3 Code sessions from the bar.",
        url: "https://github.com/DigitalPals/cybexos-t3code"
    },
    {
        id: "digitalpals.hermes",
        name: "Hermes Agent",
        description: "Talk to a Hermes Agent and follow what it is doing.",
        url: "https://github.com/DigitalPals/cybexos-hermes"
    },
    {
        id: "digitalpals.fusebox",
        name: "Fusebox",
        description: "Watch a Fusebox server: faults, live load, account health and requests.",
        url: "https://github.com/DigitalPals/cybexos-fusebox"
    },
    {
        id: "digitalpals.remote-server",
        name: "Remote Server",
        description: "CPU, memory, storage and network of a server you reach over SSH.",
        url: "https://github.com/DigitalPals/cybexos-remote-server"
    }
];

// The helper commands Install queues, as one shell line so `enable` runs
// only after `add` succeeded: its own error would otherwise replace the
// reason the install failed.
function installCommand(helper, plugin) {
    return ["sh", "-c", 'python3 "$1" add "$2" && python3 "$1" enable "$3"',
        "sh", helper, plugin.url, plugin.id];
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
