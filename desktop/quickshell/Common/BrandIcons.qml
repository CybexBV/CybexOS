pragma Singleton
import QtQuick
import Quickshell

// The allow-list for product marks bundled with the shell.
//
// Generic interface glyphs belong in Sym, and installed applications belong
// to the desktop icon theme. Only an identity that must keep its own mark is
// admitted here. Keeping the filenames behind this boundary also prevents
// provider/service data from becoming an arbitrary asset path.
Singleton {
    id: root

    readonly property var names: [
        "claude", "cybexos", "gemini", "grok", "kimi", "openai",
        "slack", "tailscale", "whatsapp", "youtube"
    ]
    readonly property var files: ({
        claude: "claude.svg",
        cybexos: "cybexos.svg",
        gemini: "gemini.svg",
        grok: "grok.svg",
        kimi: "kimi.svg",
        openai: "openai.svg",
        slack: "slack.svg",
        tailscale: "tailscale.svg",
        whatsapp: "whatsapp.svg",
        youtube: "youtube.svg"
    })
    // Hover marks are real SVG paint variants rather than alpha masks.  Their
    // paths and viewBoxes match the canonical files byte-for-byte, which
    // keeps thin outlines (notably OpenAI's) at their original weight.
    readonly property var highlightFiles: ({
        claude: "claude-white.svg",
        cybexos: "cybexos-white.svg",
        gemini: "gemini-white.svg",
        grok: "grok-white.svg",
        kimi: "kimi-white.svg",
        openai: "openai-white.svg",
        slack: "slack-white.svg",
        tailscale: "tailscale-white.svg",
        whatsapp: "whatsapp-white.svg",
        youtube: "youtube-white.svg"
    })
    readonly property var labels: ({
        claude: "Claude",
        cybexos: "Cybex OS",
        gemini: "Gemini",
        grok: "Grok",
        kimi: "Kimi",
        openai: "OpenAI",
        slack: "Slack",
        tailscale: "Tailscale",
        whatsapp: "WhatsApp",
        youtube: "YouTube"
    })

    function key(value) {
        return String(value ?? "").trim().toLowerCase();
    }

    function has(value) {
        return names.indexOf(key(value)) >= 0;
    }

    function source(value) {
        const name = key(value);
        return has(name) ? Quickshell.shellDir + "/assets/" + files[name] : "";
    }

    function highlightSource(value) {
        const name = key(value);
        return has(name)
            ? Quickshell.shellDir + "/assets/" + highlightFiles[name] : "";
    }

    function label(value) {
        const name = key(value);
        return has(name) ? labels[name] : "";
    }
}
