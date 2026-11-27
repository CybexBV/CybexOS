const test = require("node:test");
const { untranslated } = require("./shell.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { shellDir, load } = require("./shell.cjs");

const H = load("AudioHelpers.js");

const laptop = {
    id: 1,
    isSink: true,
    isStream: false,
    name: "xps_speaker_tuning",
    description: "Laptop Speakers",
};
const physicalSpeaker = {
    id: 2,
    isSink: true,
    isStream: false,
    name: "alsa_output.pci.sof_sdw.HiFi__Speaker__sink",
    description: "sof-soundwire Speakers",
};
const adam = {
    id: 3,
    isSink: true,
    isStream: false,
    name: "alsa_output.usb-Vendor_strings_are_placed_here._ADAM_Audio_D3V-00.analog-stereo",
    description: "PCM2704 16-bit stereo audio DAC Analog Stereo",
};
const studio = {
    id: 4,
    isSink: true,
    isStream: false,
    name: "alsa_output.usb-Apple_Inc._Studio_Display_XDR_123.analog-stereo",
    description: "Studio Display XDR Analog Stereo",
};
const hdmi = {
    id: 5,
    isSink: true,
    isStream: false,
    name: "alsa_output.pci.HiFi__HDMI2__sink",
    description: "Core Ultra Processors (Series 3) HD Audio HDMI / DisplayPort 2 Output",
};
const airplay = {
    id: 6,
    isSink: true,
    isStream: false,
    name: "raop_sink.Sonos.local",
    description: "Living Room",
};

test("local outputs remain complete while network outputs are grouped separately", () => {
    const sinks = [airplay, studio, hdmi, adam, laptop];
    assert.deepEqual(H.localSinks(sinks, laptop), [laptop, adam, hdmi, studio]);
    assert.deepEqual(H.networkSinks(sinks, laptop), [airplay]);
    assert.equal(H.isNetworkSink({ name: "bluez_output.headphones" }), false);
});

test("the unified output list orders current, local, then network devices", () => {
    const kitchen = {
        id: 7,
        isSink: true,
        isStream: false,
        name: "raop_sink.Kitchen.local",
        description: "Kitchen",
    };
    assert.deepEqual(H.orderedSinks(
        [airplay, studio, hdmi, adam, laptop, kitchen], airplay),
    [airplay, adam, hdmi, laptop, studio, kitchen]);
    assert.deepEqual(H.sortSinks([laptop, adam, studio], studio),
        [studio, adam, laptop]);
});

test("playback streams and physical input sources are classified safely", () => {
    assert.equal(H.isPlaybackStream({ isStream: true, isSink: true }), true);
    assert.equal(H.isPlaybackStream({
        isStream: true,
        isSink: false,
        type: "Stream/Output/Audio",
    }), true);
    assert.equal(H.isPlaybackStream({
        isStream: true,
        isSink: false,
        type: "AudioInStream",
    }), false);
    assert.equal(H.isPlaybackStream({ isStream: false, isSink: true }), false);

    const mic = {
        id: 20,
        isSink: false,
        isStream: false,
        type: "AudioSource",
        description: "USB Microphone",
    };
    const quickshell = {
        id: 21,
        isSink: false,
        isStream: false,
        type: "AudioSource",
        name: "quickshell",
    };
    assert.equal(H.isAudioSource(mic), true);
    assert.equal(H.isAudioSource(quickshell), false);
    assert.deepEqual(H.sourceDevices([quickshell, mic], mic), [mic]);
});

test("tuning nodes, capture streams, and the hidden physical speaker stay out", () => {
    const playback = {
        id: 30,
        isStream: true,
        isSink: true,
        ready: true,
        properties: { "application.name": "Firefox" },
    };
    const capture = {
        id: 31,
        isStream: true,
        isSink: false,
        type: "AudioInStream",
        ready: true,
        properties: { "application.name": "Recorder" },
    };
    const tuning = {
        id: 32,
        isStream: true,
        isSink: true,
        name: "output.xps_speaker_tuning",
    };
    const filter = {
        id: 33,
        isStream: true,
        isSink: true,
        ready: true,
        properties: { "factory.name": "support.filter-chain" },
    };
    assert.deepEqual(H.playbackStreams([capture, tuning, filter, playback]),
        [playback]);
    assert.equal(H.isTuningNode(tuning), true);
    assert.deepEqual(H.outputDevices(
        [physicalSpeaker, studio, laptop], laptop, true, physicalSpeaker),
    [laptop, studio]);
});

test("generic application streams fall back to the unmatched MPRIS identity", () => {
    const players = [
        {
            identity: "Spotify",
            desktopEntry: "spotify",
            canPlay: true,
            isPlaying: true,
            dbusName: "org.mpris.MediaPlayer2.spotify",
        },
        {
            identity: "Chromium",
            canPlay: true,
            isPlaying: false,
            dbusName: "org.mpris.MediaPlayer2.chromium",
        },
    ];
    const chromium = {
        ready: true,
        properties: { "application.name": "Chromium" },
    };
    const generic = {
        ready: true,
        properties: { "application.name": "audio-src" },
    };
    const streams = [chromium, generic];

    assert.equal(H.streamRepresentsMprisPlayer(
        "Chromium", "Chromium Browser"), true);
    assert.equal(H.matchingMprisStreamLabel("Chromium", players), "Chromium");
    assert.equal(H.unmatchedMprisStreamLabel(
        "audio-src", players, streams), "Spotify");
    assert.equal(H.streamLabel(generic, players, streams), "Spotify");
    assert.deepEqual(H.sortPlaybackStreams([generic, chromium], players),
        [chromium, generic]);
});

test("snapshots tolerate empty, transient, and large node lists", () => {
    assert.deepEqual(H.listSnapshot(null), []);
    assert.deepEqual(H.outputDevices([], null, false, null), []);
    assert.deepEqual(H.sourceDevices([], null), []);

    const live = [laptop, adam];
    const snapshot = H.listSnapshot(live);
    live.splice(0, live.length);
    assert.deepEqual(snapshot, [laptop, adam]);
    assert.equal(H.sameNodeList(snapshot, [laptop, adam]), true);
    assert.equal(H.sameNodeList(snapshot, [adam, laptop]), false);
    assert.equal(H.sameNodeList(snapshot, [laptop]), false);

    const many = Array.from({ length: 24 }, (_, index) => ({
        id: 100 + index,
        isSink: true,
        isStream: false,
        name: `alsa_output.usb.${index}`,
        description: `Output ${index}`,
    }));
    assert.equal(H.outputDevices(many, many[17], false, null).length, 24);
    assert.equal(H.outputDevices(many, many[17], false, null)[0], many[17]);
});

test("global mute state only counts channels that exist", () => {
    assert.equal(H.anyAudible(false, false, false, false), false);
    assert.equal(H.anyAudible(true, false, false, false), true);
    assert.equal(H.anyAudible(true, true, true, false), true);
    assert.equal(H.anyAudible(true, true, true, true), false);
    assert.equal(H.outputGlyph(0.2, false, true), "volume_mute");
    assert.equal(H.outputGlyph(0.5, false, true), "volume_down");
    assert.equal(H.outputGlyph(0.8, false, true), "volume_up");
    assert.equal(H.outputGlyph(0.8, true, true), "volume_off");
});

test("the Sound tab routes outputs, meters the microphone, and shares the blocked meter", () => {
    const sound = untranslated(fs.readFileSync(path.join(shellDir,
        "Popovers/Drawer/DrawerSound.qml"), "utf8"));
    const blockMeter = untranslated(fs.readFileSync(path.join(shellDir,
        "Popovers/BlockMeter.qml"), "utf8"));
    const audio = untranslated(fs.readFileSync(path.join(shellDir, "Common/Audio.qml"), "utf8"));

    assert.match(sound, /PwNodePeakMonitor\s*\{[\s\S]{0,40}node:\s*Audio\.source/);
    assert.match(sound, /onClicked:\s*Audio\.setDefaultSink\(sinkRow\.modelData\)/);
    assert.match(sound, /Accessible\.role:\s*Accessible\.Button\s*Accessible\.name:\s*I18n\.format\("Switch output to %1"/);
    assert.match(sound, /streamAudio\.volume = v;/);
    assert.match(blockMeter, /Format\.clamp01\(stepped\)/,
        "the shared blocked control clamps interaction to 100%");
    assert.match(blockMeter, /Accessible\.role:\s*Accessible\.Slider/);
    assert.match(blockMeter, /Qt\.Key_Left[\s\S]{0,300}Qt\.Key_Right/);
    assert.match(blockMeter, /Qt\.Key_Home[\s\S]{0,100}Qt\.Key_End/);

    assert.match(audio, /scripts\/audio-route/);
    assert.match(audio, /function setDefaultSource\(node\)/);
    assert.match(audio, /Pipewire\.preferredDefaultAudioSource\s*=\s*node/);
    assert.match(audio, /scripts\/audio-source-route/);
    assert.match(audio, /readonly property var sinkAudio:\s*sink && sink\.audio/);
    assert.match(audio, /readonly property var sourceAudio:\s*source && source\.audio/);
    assert.doesNotMatch(audio, /ready \?[^\n]*sink\.audio/,
        "a stale ready binding must not dereference a disappearing PipeWire group");
});

test("the output routing helper moves named apps but leaves filter internals", () => {
    const route = untranslated(fs.readFileSync(path.join(shellDir, "scripts/audio-route"), "utf8"));
    assert.match(route, /pactl set-default-sink "\$target"/);
    assert.match(route, /application\[\.\]name/);
    assert.match(route, /pactl move-sink-input "\$input" "\$target"/);
    assert.doesNotMatch(route, /pactl list sink-inputs short/);
});

test("the output routing helper finds running streams under a translated locale", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audio-route-"));
    try {
        const bin = path.join(tmp, "bin");
        const calls = path.join(tmp, "calls.log");
        fs.mkdirSync(bin);
        // pactl translates the long listing's headers; Dutch is what a user
        // who picked nl_NL in the installer sees. Property keys stay English.
        fs.writeFileSync(path.join(bin, "pactl"), `#!/usr/bin/env bash
printf '%s\\n' "LC_ALL=\${LC_ALL:-} $*" >>"$AUDIO_ROUTE_CALLS"
[[ \${1:-} == list ]] || exit 0
if [[ \${LC_ALL:-} == C ]]; then header='Sink Input'; else header='Afvoer-invoer'; fi
printf '%s #41\\n\\tProperties:\\n\\t\\tapplication.name = "Firefox"\\n' "$header"
printf '%s #42\\n\\tProperties:\\n\\t\\tnode.name = "speaker-filter"\\n' "$header"
printf '%s #43\\n\\tProperties:\\n\\t\\tapplication.name = "mpv"\\n' "$header"
`, { mode: 0o755 });
        const run = spawnSync("bash", [path.join(shellDir, "scripts/audio-route"), "usb-dac"], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                LANG: "nl_NL.UTF-8",
                LC_ALL: "nl_NL.UTF-8",
                AUDIO_ROUTE_CALLS: calls,
            },
        });
        assert.equal(run.status, 0, run.stderr);
        const moves = untranslated(fs.readFileSync(calls, "utf8")).split("\n")
            .filter(line => line.includes("move-sink-input"))
            .map(line => line.replace(/^LC_ALL=\S* /, ""));
        assert.deepEqual(moves, ["move-sink-input 41 usb-dac", "move-sink-input 43 usb-dac"],
            "application streams move; the filter-chain internal stays put");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("the input routing helper updates the default and existing recorders", () => {
    const route = untranslated(fs.readFileSync(path.join(shellDir,
        "scripts/audio-source-route"), "utf8"));
    assert.match(route, /pactl set-default-source "\$target"/);
    assert.match(route, /pactl list short source-outputs/);
    assert.match(route, /pactl move-source-output "\$output" "\$target"/);
});

test("a player's own streams: by process id when it publishes one, else by name", () => {
    const stream = (id, props) => ({ id, isStream: true, isSink: true, properties: props, audio: {} });
    const brave = stream(1, { "application.name": "Brave", "application.process.id": "4242" });
    const braveOther = stream(2, { "application.name": "Brave", "application.process.id": "77" });
    const spotify = stream(3, { "application.name": "spotify" });
    const generic = stream(4, { "application.name": "audio-src" });
    const streams = [brave, braveOther, spotify, generic];
    const chromium = { identity: "Brave", dbusName: "org.mpris.MediaPlayer2.chromium.instance4242",
        isPlaying: true, canPlay: true };
    const spotifyPlayer = { identity: "Spotify", dbusName: "org.mpris.MediaPlayer2.spotify",
        isPlaying: false, canPlay: true };

    assert.equal(H.playerProcessId(chromium), "4242");
    assert.equal(H.playerProcessId(spotifyPlayer), "");
    assert.deepEqual(H.streamsForPlayer(chromium, streams, [chromium, spotifyPlayer]), [brave]);
    assert.deepEqual(H.streamsForPlayer(spotifyPlayer, streams, [chromium, spotifyPlayer]), [spotify]);
    // No stream with the process id: the name decides.
    const elsewhere = { ...chromium, dbusName: "org.mpris.MediaPlayer2.chromium.instance9" };
    assert.deepEqual(H.streamsForPlayer(elsewhere, streams, [elsewhere]), [brave, braveOther]);
    // A lone generic stream is the only playing player's.
    const mpv = { identity: "mpv", dbusName: "org.mpris.MediaPlayer2.mpv", isPlaying: true, canPlay: true };
    assert.deepEqual(H.streamsForPlayer(mpv, [generic], [mpv]), [generic]);
    assert.deepEqual(H.streamsForPlayer(null, streams, []), []);
    assert.deepEqual(H.streamsForPlayer(mpv, [], [mpv]), []);
    // Google Chrome, the default browser, the same way; a player naming only
    // its desktop entry still finds Chrome's streams by name.
    const chrome = stream(5, { "application.name": "Google Chrome", "application.process.id": "5151" });
    const chromePlayer = { identity: "Google Chrome", desktopEntry: "google-chrome",
        dbusName: "org.mpris.MediaPlayer2.chromium.instance5151", isPlaying: true, canPlay: true };
    assert.deepEqual(H.streamsForPlayer(chromePlayer, [brave, chrome, spotify], [chromePlayer]), [chrome]);
    const entryOnly = { identity: "", desktopEntry: "google-chrome", dbusName: "org.mpris.MediaPlayer2.chromium.instance9",
        isPlaying: true, canPlay: true };
    assert.deepEqual(H.streamsForPlayer(entryOnly, [brave, chrome, spotify], [entryOnly]), [chrome]);
    assert.equal(H.friendlyStreamLabel("google chrome"), "Google Chrome");
    assert.equal(H.friendlyStreamLabel("brave-browser"), "Brave");
});
