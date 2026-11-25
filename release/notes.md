# Cybex OS 1.0.34

Six connected-service widgets — Model Usage, Fusebox, GitHub, T3 Code, Hermes Agent and Remote Server — now ship as Cybex OS plugins that you install from Settings → Plugins instead of being built into the menubar. If you already configured any of them, your saved options stay in place and carry over when you install the plugin.

The desktop UI is cleaner and steadier across the shell, terminal prompt and installer. In Hug bar mode, the two screen corners opposite the bar now round softly to match the bar's corners, and the Cybex OS mark sits centred in the terminal prompt. Control Center toggles show clearly when on, repeated alerts fold together, and Settings, Software, Shortcuts, Welcome and the installer share one primary action per step, plainer error and recovery messages, keyboard-only focus rings, gentler motion under Reduce motion, and updated Dutch translations.

Omawrite updates to 0.7.8 and skips building its test suite on your computer during updates. Brave Origin updates to 1.100.59, Codex to 0.172.0 and Claude Code to 2.1.332.

Wired connections now use the network's own DNS by default while keeping manual DNS choices intact, and LocalSend opens only when local network services are enabled. On Dell XPS laptops, the `intel-lpmd` power daemon now comes prebuilt from Nixpkgs rather than a local source build; this switch has not yet been physically re-qualified on XPS hardware, and the XPS 13 (`0E53`) stays excluded until tested.

Updates and cleanup are steadier: Software Update now reads every page of the release list, keeps boot generations intact when clearing an abandoned preview, moves NixOS branches forward only, and bounds update log memory.

This is a source update with no new ISO. Installation, boot, physical hardware and staged-updater qualification are separate from source tests and package builds.
