pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Window
import "../Common"

// Wiz, the assistant's character (docs/assistant.md).
//
// Still layers, each drawn once at the size it is shown (assets/wiz/,
// exported from Common/WizRig.js by scripts/export-wiz), moved by declarative
// animation: no Canvas, no offscreen layer, and no script per frame except
// while he is being dragged. A change of pose glides once. Idle holds still
// between blinks, glances and a rare wobble of the hat, so a resting Wiz
// draws a few frames a second at most. Loops run only while the assistant
// works (the runes, the spell, his hands, the star's twinkle) and a waiting
// question pulses only briefly; they are Animators, which the threaded
// render loop runs on the scene graph's thread. Without `animated` every pose
// holds still and nothing ticks.
//
// The star on his hat is his one status light (WizRig.LIGHT). Magic takes
// the theme's accent: Common/WizArt.qml draws those layers again when the
// accent changes, never per frame.
//
// Only what every pose shows is always there: his body, face, hat, hands and
// star. What a pose or a moment adds (the runes, each thing he works with,
// the wisp, the z's, the sparkles, the ring, his legs, and everything a drag
// throws about) is in a Loader that makes it as it fades in and lets it go
// once it has faded out: most Wizzes on screen never work and are never
// dragged. Nothing made that way may be wanted the instant something else
// goes; a magic-coloured picture can arrive a frame or two late.
//
// Picked up, he panics: a startled jump with "?!", sweat, his hands up and
// his feet out, then he swings from where he was grabbed while his hat, hands
// and feet trail the pointer's motion (WizRig.carry), stretched along it so a
// diagonal drag reads as one. A few quick shakes make him dizzy. Dropped, he
// lands with a thud, his hat a beat later and crooked. Only a drag and its
// landing animate; the springs that follow the pointer run on the frames the
// drag draws anyway.
Item {
    id: root

    // One of WizRig.STATES; Assistant.pose picks it.
    property string pose: "idle"
    // 0..1, the microphone's level, which lifts the hat while recording.
    property real level: 0
    property bool recording: false
    property bool hovered: false
    // A reply nobody has seen yet: the star stays lit.
    property bool unread: false
    // The box opens above the character, so an attentive look goes up, and
    // so does his wand when he points at it.
    property bool boxAbove: false
    // The pointer over the character, -1..1, for the eyes to follow.
    property real lookX: 0
    property real lookY: 0
    // While carried: the character's place on its output, set once per
    // pointer move, and the point it was grabbed by, in item pixels.
    property point dragPoint: Qt.point(0, 0)
    property point grab: Qt.point(width / 2, height / 2)
    // How far a job has got, 0..1: a ring round the star fills. Below 0, no ring.
    property real progress: -1
    // A second question is being answered alongside: the wisp works beside
    // him, in any pose but asleep, which draws nothing.
    property bool helper: false
    // 1 as drawn, -1 mirrored: he points the other way, and his star shows
    // when he is tucked behind the right screen edge.
    property int facing: 1
    // Off for reduced motion (which power saver turns on) and an unattended
    // session: poses snap into place and nothing loops. Every surface that
    // shows him inherits this.
    property bool animated: !Theme.reducedMotion && !Activity.idle

    // The rig, through WizArt: one copy for every Wiz and every part of him.
    // Imported here, each layer and each loop below would get its own.
    readonly property var wiz: WizArt.wiz
    readonly property var layout: wiz.LAYOUT
    readonly property var stance: wiz.POSES[pose] || wiz.POSES.idle
    readonly property bool live: animated && visible
    // What the star says (WizRig.LIGHT), and which picture of it shows.
    readonly property string light: wiz.light(pose, unread)
    readonly property string shine: light === "busy" || light === "ready" ? "lit" : light
    // Running a turn or recording: the loops' states. Everything else only
    // blinks, glances or plays once.
    readonly property bool busy: light === "busy"
    readonly property bool looping: live && (busy || (pose === "listening" && recording))
    readonly property bool attentive: pose === "listening" && !recording
    readonly property bool carried: pose === "carried"
    // Pointing at the box: down at it, or up when it opens above him.
    // `aside` keeps the pose's own aim, straight out to the side: Settings'
    // guide points at a row beside him (Settings/SettingsGuide.qml).
    property bool aside: false
    readonly property var aim: pose === "pointing" && !aside
        ? (boxAbove ? layout.aim.above : layout.aim.below) : null
    readonly property int side: facing < 0 ? -1 : 1
    // Rig units to item pixels, and to device pixels for drawing the layers.
    readonly property real unit: Math.min(width, height) / 120
    readonly property real pixels: unit * Math.max(1, Math.ceil(Screen.devicePixelRatio))

    implicitWidth: 88
    implicitHeight: 88

    // ---- the pose ------------------------------------------------------------
    // Eased the way the rig blends (7/s, most of the way in under half a second).
    property real lean: stance.lean
    property real bodyScale: stance.sc
    property real squash: stance.sy
    property real bodyY: stance.bodyY
    property real hatY: stance.hatY
    property real hatRot: stance.hatRot
    property real hatLift: stance.hatLift
    property real eyeOpen: stance.eyeOpen * (hovered && stance.happy === 0 ? 1.1 : 1)
    property real eyeX: aim ? aim.eyeX : stance.eyeX
    property real eyeY: aim ? aim.eyeY : stance.eyeY
    property real happy: stance.happy
    property real lid: stance.lid
    property real lidR: Math.max(stance.lid, stance.lidR)
    property real brow: stance.brow
    property real big: stance.big
    property real tip: stance.tip
    property real glow: stance.glow
    property real voiceLift: recording ? level * 2.4 * stance.voice : 0
    // Out from under the cloak while carried; his shadow fades as he leaves the ground.
    property real feet: stance.feet
    // His hands: out of the cloak, where they are, and how he holds them.
    property real arms: stance.arms
    property real lx: stance.lx
    property real ly: stance.ly
    property real rx: aim ? aim.rx : stance.rx
    property real ry: aim ? aim.ry : stance.ry
    property real point: stance.point
    property real pointA: stance.pointA
    property real palms: stance.palms
    // What he works with.
    property real wand: stance.wand
    property real wandA: aim ? aim.wandA : stance.wandA
    property real spell: stance.spell
    property real runes: stance.runes
    property real book: stance.book
    property real orb: stance.orb
    property real scroll: stance.scroll
    property real pot: stance.pot
    property real wisp: Math.max(stance.wisp, helper && pose !== "asleep" ? 1 : 0)
    property real zzz: stance.zzz
    property real turn: side

    component Blend: NumberAnimation {
        duration: 450
        easing.type: Easing.OutCubic
    }
    Behavior on lean { enabled: root.animated; Blend {} }
    Behavior on bodyScale { enabled: root.animated; Blend {} }
    Behavior on squash { enabled: root.animated; Blend {} }
    Behavior on bodyY { enabled: root.animated; Blend {} }
    Behavior on hatY { enabled: root.animated; Blend {} }
    Behavior on hatRot { enabled: root.animated; Blend {} }
    Behavior on hatLift { enabled: root.animated; Blend {} }
    Behavior on eyeOpen { enabled: root.animated; Blend {} }
    Behavior on eyeX { enabled: root.animated; Blend {} }
    Behavior on eyeY { enabled: root.animated; Blend {} }
    Behavior on happy { enabled: root.animated; Blend {} }
    Behavior on lid { enabled: root.animated; Blend {} }
    Behavior on lidR { enabled: root.animated; Blend {} }
    Behavior on brow { enabled: root.animated; Blend {} }
    Behavior on big { enabled: root.animated; Blend {} }
    Behavior on tip { enabled: root.animated; Blend {} }
    Behavior on glow { enabled: root.animated; Blend {} }
    Behavior on arms { enabled: root.animated; Blend {} }
    Behavior on lx { enabled: root.animated; Blend {} }
    Behavior on ly { enabled: root.animated; Blend {} }
    Behavior on rx { enabled: root.animated; Blend {} }
    Behavior on ry { enabled: root.animated; Blend {} }
    Behavior on point { enabled: root.animated; Blend {} }
    Behavior on pointA { enabled: root.animated; Blend {} }
    Behavior on palms { enabled: root.animated; Blend {} }
    Behavior on wand { enabled: root.animated; Blend {} }
    Behavior on wandA { enabled: root.animated; Blend {} }
    Behavior on spell { enabled: root.animated; Blend {} }
    Behavior on runes { enabled: root.animated; Blend {} }
    Behavior on book { enabled: root.animated; Blend {} }
    Behavior on orb { enabled: root.animated; Blend {} }
    Behavior on scroll { enabled: root.animated; Blend {} }
    Behavior on pot { enabled: root.animated; Blend {} }
    Behavior on wisp { enabled: root.animated; Blend {} }
    Behavior on zzz { enabled: root.animated; Blend {} }
    Behavior on feet {
        enabled: root.animated
        NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
    }
    Behavior on voiceLift {
        enabled: root.animated
        NumberAnimation { duration: 90 }
    }
    // He turns round through his own middle.
    Behavior on turn {
        enabled: root.animated
        NumberAnimation { duration: 240; easing.type: Easing.InOutSine }
    }

    // Each hand, from its shoulder. Carried, they are left a little behind.
    readonly property point leftReach: Qt.point((lx - layout.shoulders[0][0]) * arms + reaction.handX,
        (ly - layout.shoulders[0][1]) * arms + reaction.handY)
    readonly property point rightReach: Qt.point((rx - layout.shoulders[1][0]) * arms + reaction.handX,
        (ry - layout.shoulders[1][1]) * arms + reaction.handY)

    // The open eye gives way to the happy arc over the upper half of `happy`.
    readonly property real smile: happy < 0.4 ? 0 : Math.min(1, (happy - 0.4) / 0.4)

    // ---- glances and blinks ----------------------------------------------------
    property real glanceX: 0
    property real glanceY: 0
    property real blink: 1
    readonly property point gaze: carried ? Qt.point(reaction.eyeX, reaction.eyeY)
        : hovered ? Qt.point(lookX * 2 * side, lookY * 1.2)
        : attentive ? Qt.point(0, boxAbove ? -1 : 1.4)
        : Qt.point(glanceX, glanceY)

    // Idle looks around the most, thinking and a waiting question sideways.
    readonly property var glances: ({ "idle": [2, 0.8], "thinking": [0.9, 0], "needs-input": [1.1, 0] })

    Timer {
        running: root.live && root.glances[root.pose] !== undefined && !root.hovered
        repeat: true
        interval: 2300
        onTriggered: {
            const reach = root.glances[root.pose];
            // Now and then the eyes come back to the middle.
            const back = Math.random() < 0.3;
            root.glanceX = back ? 0 : (Math.random() * 2 - 1) * reach[0];
            root.glanceY = back ? 0 : (Math.random() * 2 - 1) * reach[1];
            interval = 2300 + Math.random() * 3200;
        }
    }
    onPoseChanged: {
        glanceX = 0;
        glanceY = 0;
        pulses = 0;
        festive = pose === "finished" || pose === "proud";
        settle();
        if (!live)
            return;
        // The star swings on its thread whenever he moves.
        swinging.restart();
        if (pose === "finished")
            nodding.restart();
        if (festive)
            sparkle();
    }

    // A drowsy blink is slow and rare.
    Timer {
        running: root.live && ["happy", "greeting", "finished", "proud", "asleep"].indexOf(root.pose) === -1 && !root.dizzy
        repeat: true
        interval: 3400
        onTriggered: {
            blinking.restart();
            interval = (root.pose === "drowsy" ? 5500 : 3400) + Math.random() * 1600;
        }
    }

    SequentialAnimation {
        id: blinking
        NumberAnimation { target: root; property: "blink"; to: 0.08; duration: root.pose === "drowsy" ? 250 : 80; easing.type: Easing.InQuad }
        NumberAnimation { target: root; property: "blink"; to: 1; duration: root.pose === "drowsy" ? 250 : 80; easing.type: Easing.OutQuad }
    }

    // ---- waves -----------------------------------------------------------------
    // The rig's runes, hands and sway follow sines: middle + reach * cos of
    // the turn, starting `phase` quarters into it (wave() is where that is
    // after `step` quarters more). Qt's SineCurve is one whole turn of a
    // cosine and CosineCurve one of a sine, so a looping wave is a single
    // Animator between middle + far * reach and middle - far * reach: there
    // and back from the first (phase 0 and 2), or from halfway to the second,
    // to the first and back to halfway (phase 1 and 3).
    readonly property var cosine: [1, 0, -1, 0]
    function wave(step, phase, middle, amplitude) {
        return middle + amplitude * cosine[(phase + step) % 4];
    }
    function far(phase) {
        return phase < 2 ? 1 : -1;
    }
    function curve(phase) {
        return phase % 2 === 0 ? Easing.SineCurve : Easing.CosineCurve;
    }

    // An item going to and fro, or turning to and fro, about where it rests.
    component SineX: XAnimator {
        loops: Animation.Infinite
        property real reach: 1
        property int period: 1000
        property int phase: 0
        from: root.far(phase) * reach
        to: -from
        duration: period
        easing.type: root.curve(phase)
    }
    component SineY: YAnimator {
        loops: Animation.Infinite
        property real reach: 1
        property int period: 1000
        property int phase: 0
        from: root.far(phase) * reach
        to: -from
        duration: period
        easing.type: root.curve(phase)
    }
    component SineR: RotationAnimator {
        loops: Animation.Infinite
        property real reach: 1
        property int period: 1000
        property int phase: 0
        from: root.far(phase) * reach
        to: -from
        duration: period
        easing.type: root.curve(phase)
    }

    // One exported layer, drawn once at the size it is shown and then only
    // moved. Its box places it in the rig's frame, or about the point the
    // item holding it stands for (WizRig.LAYERS). A layer that carries magic
    // comes from WizArt when the accent is not the pictures' own blue.
    component Part: Image {
        required property string name
        readonly property var box: root.wiz.LAYERS[name].box
        x: box[0]
        y: box[1]
        width: box[2]
        height: box[3]
        source: WizArt.sources[name] || Qt.resolvedUrl("../assets/wiz/" + name + ".svg")
        sourceSize: Qt.size(Math.ceil(box[2] * root.pixels), Math.ceil(box[3] * root.pixels))
        retainWhileLoading: true
        smooth: true
    }

    // The star in one of its lights; only the one that shows is drawn. All
    // five are kept: one must be there the moment another goes.
    component Shine: Part {
        required property string light
        opacity: root.shine === light ? 1 : 0
        visible: opacity > 0.01

        Behavior on opacity {
            enabled: root.animated
            NumberAnimation { duration: 300 }
        }
    }

    // Something circling the hat: a rune while he thinks, a star while he is
    // dizzy. Each is drawn twice, moving together: behind the cone at half
    // strength, and over it on the near half of the orbit only. The two swap
    // at the far left and right, which the cone does not cover.
    component Orbiter: Item {
        id: orbiter

        required property int index
        property bool front: false
        property string art
        property var orbit: root.layout.orbit
        property real size: 1
        property bool running: false
        readonly property int quarter: Math.round(Math.PI / 2 / orbit.rate * 1000)
        // y and size follow the sine, a quarter behind x's cosine.
        readonly property int lag: (index + 3) % 4

        function near(step) {
            return (index + step) % 4 < 2 ? 1 : 0;
        }

        x: root.wave(0, index, orbit.cx, orbit.rx)
        y: root.wave(0, lag, orbit.cy, orbit.ry)
        scale: root.wave(0, lag, 0.82 * size, 0.22 * size)
        opacity: front ? near(0) : 1

        Part {
            name: orbiter.art
        }

        XAnimator on x {
            running: orbiter.running
            loops: Animation.Infinite
            from: orbiter.orbit.cx + root.far(orbiter.index) * orbiter.orbit.rx
            to: orbiter.orbit.cx - root.far(orbiter.index) * orbiter.orbit.rx
            duration: 4 * orbiter.quarter
            easing.type: root.curve(orbiter.index)
        }
        YAnimator on y {
            running: orbiter.running
            loops: Animation.Infinite
            from: orbiter.orbit.cy + root.far(orbiter.lag) * orbiter.orbit.ry
            to: orbiter.orbit.cy - root.far(orbiter.lag) * orbiter.orbit.ry
            duration: 4 * orbiter.quarter
            easing.type: root.curve(orbiter.lag)
        }
        ScaleAnimator on scale {
            running: orbiter.running
            loops: Animation.Infinite
            from: (0.82 + root.far(orbiter.lag) * 0.22) * orbiter.size
            to: (0.82 - root.far(orbiter.lag) * 0.22) * orbiter.size
            duration: 4 * orbiter.quarter
            easing.type: root.curve(orbiter.lag)
        }
        SequentialAnimation on opacity {
            running: orbiter.running && orbiter.front
            loops: Animation.Infinite
            OpacityAnimator { from: orbiter.near(0); to: orbiter.near(0); duration: orbiter.quarter }
            OpacityAnimator { from: orbiter.near(1); to: orbiter.near(1); duration: orbiter.quarter }
            OpacityAnimator { from: orbiter.near(2); to: orbiter.near(2); duration: orbiter.quarter }
            OpacityAnimator { from: orbiter.near(3); to: orbiter.near(3); duration: orbiter.quarter }
        }
    }

    // A bead of sweat: flung off his head when he is grabbed and while he
    // dangles, or sliding down his face once he is down.
    component Drop: Item {
        id: drop

        property real direction: 1

        function fly() {
            sliding.stop();
            flying.restart();
        }
        function slide() {
            flying.stop();
            sliding.restart();
        }

        Item {
            id: bead
            opacity: 0

            Part {
                name: "sweat"
            }
        }

        ParallelAnimation {
            id: flying
            XAnimator { target: bead; from: 0; to: 10 * drop.direction; duration: 620; easing.type: Easing.OutQuad }
            SequentialAnimation {
                YAnimator { target: bead; from: 0; to: -5; duration: 220; easing.type: Easing.OutQuad }
                YAnimator { target: bead; from: -5; to: 9; duration: 400; easing.type: Easing.InQuad }
            }
            OpacityAnimator { target: bead; from: 1; to: 0; duration: 620; easing.type: Easing.InQuad }
            RotationAnimator { target: bead; from: 0; to: 50 * drop.direction; duration: 620 }
        }

        SequentialAnimation {
            id: sliding
            PauseAnimation { duration: 350 }
            ParallelAnimation {
                XAnimator { target: bead; from: 0; to: 0; duration: 0 }
                RotationAnimator { target: bead; from: 0; to: 0; duration: 0 }
            }
            ParallelAnimation {
                YAnimator { target: bead; from: 0; to: 7; duration: 800; easing.type: Easing.InQuad }
                OpacityAnimator { target: bead; from: 1; to: 0; duration: 800; easing.type: Easing.InQuad }
            }
        }
    }

    // A puff of dust kicked up by a landing, stronger for a harder one.
    component Puff: Item {
        id: puff

        property real direction: 1

        function burst() {
            puffing.restart();
        }

        Item {
            id: cloud
            opacity: 0
            scale: 0.4

            Part {
                name: "dust"
            }
        }

        ParallelAnimation {
            id: puffing
            XAnimator { target: cloud; from: 0; to: 7 * puff.direction; duration: 520; easing.type: Easing.OutQuad }
            ScaleAnimator { target: cloud; from: 0.4; to: 0.7 + 0.6 * root.impact; duration: 520; easing.type: Easing.OutQuad }
            OpacityAnimator { target: cloud; from: 0.25 + 0.7 * root.impact; to: 0; duration: 520; easing.type: Easing.InQuad }
        }
    }

    // A mote flying off the spell, a fifth of a flight behind the one before.
    // The flight is linear, so its loop is split where this mote starts.
    component Mote: Item {
        id: mote

        required property int index
        property bool running: false
        readonly property real start: index / 5
        readonly property int period: 1111
        readonly property real reach: 13

        rotation: (index * 2.4 + 1) * 180 / Math.PI

        Item {
            id: flight
            x: mote.reach * mote.start
            opacity: 1 - mote.start
            scale: 1 - 0.4 * mote.start

            Part {
                name: "mote"
            }
        }

        SequentialAnimation {
            running: mote.running
            loops: Animation.Infinite
            ParallelAnimation {
                XAnimator { target: flight; from: mote.reach * mote.start; to: mote.reach; duration: mote.period * (1 - mote.start) }
                OpacityAnimator { target: flight; from: 1 - mote.start; to: 0; duration: mote.period * (1 - mote.start) }
                ScaleAnimator { target: flight; from: 1 - 0.4 * mote.start; to: 0.6; duration: mote.period * (1 - mote.start) }
            }
            ParallelAnimation {
                XAnimator { target: flight; from: 0; to: mote.reach * mote.start; duration: Math.max(1, mote.period * mote.start) }
                OpacityAnimator { target: flight; from: 1; to: 1 - mote.start; duration: Math.max(1, mote.period * mote.start) }
                ScaleAnimator { target: flight; from: 1; to: 1 - 0.4 * mote.start; duration: Math.max(1, mote.period * mote.start) }
            }
        }
    }

    // A bubble rising off the cauldron and fading, a fifth of a rise behind
    // the one before, each its own size.
    component Bubble: Item {
        id: bubble

        required property int index
        property bool running: false
        readonly property real start: index / 5
        readonly property int period: 1667
        readonly property real lift: 17
        readonly property real size: 1 + 1.375 * Math.abs(Math.sin(index * 1.7))

        Item {
            id: climb
            y: -bubble.lift * bubble.start
            opacity: 0.85 * (1 - bubble.start)
            scale: 1 - 0.3 * bubble.start

            Item {
                scale: bubble.size

                Part {
                    name: "bubble"
                }
            }
        }

        SequentialAnimation {
            running: bubble.running
            loops: Animation.Infinite
            ParallelAnimation {
                YAnimator { target: climb; from: -bubble.lift * bubble.start; to: -bubble.lift; duration: bubble.period * (1 - bubble.start) }
                OpacityAnimator { target: climb; from: 0.85 * (1 - bubble.start); to: 0; duration: bubble.period * (1 - bubble.start) }
                ScaleAnimator { target: climb; from: 1 - 0.3 * bubble.start; to: 0.7; duration: bubble.period * (1 - bubble.start) }
            }
            ParallelAnimation {
                YAnimator { target: climb; from: 0; to: -bubble.lift * bubble.start; duration: Math.max(1, bubble.period * bubble.start) }
                OpacityAnimator { target: climb; from: 0.85; to: 0.85 * (1 - bubble.start); duration: Math.max(1, bubble.period * bubble.start) }
                ScaleAnimator { target: climb; from: 1; to: 1 - 0.3 * bubble.start; duration: Math.max(1, bubble.period * bubble.start) }
            }
        }
    }

    // A finished turn's sparkle. A bursting one waits its turn, grows, spins
    // a little and shrinks away; a still one holds the rig's reduced-motion
    // picture, half a second into the burst.
    component Sparkle: Item {
        id: sparkle

        required property var modelData
        property bool burst: false
        readonly property real phase: (0.5 - modelData[2]) / 0.6

        function flare() {
            flaring.restart();
        }

        x: modelData[0]
        y: modelData[1]
        scale: burst ? 0 : phase > 0 && phase < 1 ? modelData[3] * Math.sin(Math.PI * phase) : 0
        rotation: burst ? 0 : phase * 70

        Part {
            name: "sparkle"
        }

        SequentialAnimation {
            id: flaring
            ScaleAnimator { target: sparkle; from: 0; to: 0; duration: sparkle.modelData[2] * 1000 }
            ParallelAnimation {
                SequentialAnimation {
                    ScaleAnimator { target: sparkle; from: 0; to: sparkle.modelData[3]; duration: 300; easing.type: Easing.OutSine }
                    ScaleAnimator { target: sparkle; from: sparkle.modelData[3]; to: 0; duration: 300; easing.type: Easing.InSine }
                }
                RotationAnimator { target: sparkle; from: 0; to: 70; duration: 600 }
            }
        }
    }

    // A sleeve from a shoulder to a hand: one picture, turned and stretched.
    // It thins as it stretches, like a cartoon's; the cuff at its end keeps
    // its shape.
    component Sleeve: Item {
        id: sleeve

        // The hand, from the shoulder.
        required property point hand
        readonly property real reach: Math.max(1, Math.sqrt(hand.x * hand.x + hand.y * hand.y))
        readonly property real thin: Math.max(0.7, Math.min(1, 27 / reach))

        rotation: Math.atan2(hand.y, hand.x) * 180 / Math.PI - 90
        opacity: Math.min(1, root.arms * 1.5)
        visible: root.arms > 0.05

        Item {
            transform: Scale {
                xScale: sleeve.thin
                yScale: sleeve.reach / root.layout.reach
            }

            Part {
                name: "sleeve"
            }
        }

        Item {
            y: sleeve.reach - root.layout.cuff
            transform: Scale { xScale: 0.5 + 0.5 * sleeve.thin }

            Part {
                name: "cuff"
            }
        }
    }

    // Something he works with, about its own middle: it rises into place and
    // grows as its pose arrives.
    component Prop: Item {
        required property string around
        required property real amount
        property real rise: 5
        readonly property var at: root.wiz.LAYERS[around].at

        x: at[0]
        y: at[1] + (1 - amount) * rise
        scale: amount
        opacity: Math.min(1, amount * 1.4)
        visible: amount > 0.02
    }

    // The wand, about the hand that holds it, and the spell at its tip
    // while he casts.
    component Wand: Item {
        Part {
            name: "wand"
        }

        Item {
            x: root.layout.wand

            Part {
                name: "wand-tip"
                visible: root.spell <= 0.02
            }

            Loader {
                active: root.spell > 0.02
                sourceComponent: Spell {}
            }
        }
    }

    // Casting: the spell, upright whichever way the wand points.
    component Spell: Item {
        id: spell

        readonly property bool running: root.live && visible

        rotation: -root.wandA
        scale: root.spell
        opacity: Math.min(1, root.spell * 1.4)

        Item {
            Part {
                name: "spell-glow"
            }

            SequentialAnimation on scale {
                running: spell.running
                loops: Animation.Infinite
                ScaleAnimator { from: 1; to: 1.07; duration: 90 }
                ScaleAnimator { from: 1.07; to: 0.97; duration: 120 }
                ScaleAnimator { from: 0.97; to: 1.1; duration: 80 }
                ScaleAnimator { from: 1.1; to: 0.95; duration: 130 }
                ScaleAnimator { from: 0.95; to: 1.04; duration: 100 }
                ScaleAnimator { from: 1.04; to: 1; duration: 110 }
            }
        }

        Item {
            Part {
                name: "spell-ring"
            }

            RotationAnimator on rotation {
                running: spell.running
                loops: Animation.Infinite
                from: 0
                to: 360
                duration: 2571
            }
        }

        Item {
            Part {
                name: "spell-core"
            }

            SequentialAnimation on scale {
                running: spell.running
                loops: Animation.Infinite
                ScaleAnimator { from: 1; to: 0.95; duration: 110 }
                ScaleAnimator { from: 0.95; to: 1.08; duration: 90 }
                ScaleAnimator { from: 1.08; to: 0.98; duration: 120 }
                ScaleAnimator { from: 0.98; to: 1.06; duration: 100 }
                ScaleAnimator { from: 1.06; to: 1; duration: 130 }
            }
        }

        Repeater {
            model: 5
            delegate: Mote {
                running: spell.running
            }
        }
    }

    // A finished turn's sparkles: bursting ones while he may move, still
    // ones otherwise.
    component Sparkles: Item {
        function flare() {
            for (let i = 0; i < bursts.count; i++)
                (bursts.itemAt(i) as Sparkle)?.flare();
        }

        Repeater {
            id: bursts
            model: root.live ? root.layout.sparks : []
            delegate: Sparkle {
                burst: true
            }
        }

        Repeater {
            model: root.live ? [] : root.layout.sparks
            delegate: Sparkle {}
        }
    }

    // The dust a landing kicks up, to either side of him.
    component Dust: Item {
        function burst() {
            for (let i = 0; i < puffs.count; i++)
                (puffs.itemAt(i) as Puff)?.burst();
        }

        Repeater {
            id: puffs
            model: root.layout.dust
            delegate: Puff {
                required property var modelData
                required property int index
                x: modelData[0]
                y: modelData[1]
                direction: index === 0 ? -1 : 1
            }
        }
    }

    // What a grab shakes out of him: "?!" beside his hat, the sweat that
    // flies off his head, and the bead that slides down his face once he is
    // down.
    component Panic: Item {
        // "?!" pops and every bead flies.
        function startle() {
            shouting.restart();
            for (let i = 0; i < flyers.count; i++)
                (flyers.itemAt(i) as Drop)?.fly();
        }
        // One bead, each side in turn.
        function drip(turn) {
            (flyers.itemAt(turn % flyers.count) as Drop)?.fly();
        }
        function slide() {
            phew.slide();
        }

        Item {
            id: shout
            x: root.layout.shout[0]
            y: root.layout.shout[1]
            opacity: 0
            scale: 0

            Item {
                transform: Scale { xScale: root.side }

                Part {
                    name: "shout"
                }
            }
        }

        Repeater {
            id: flyers
            model: root.layout.sweat
            delegate: Drop {
                required property var modelData
                required property int index
                x: modelData[0]
                y: modelData[1]
                direction: index === 0 ? -1 : 1
            }
        }

        Drop {
            id: phew
            x: root.layout.phew[0]
            y: root.layout.phew[1]
        }

        ParallelAnimation {
            id: shouting
            SequentialAnimation {
                ScaleAnimator { target: shout; from: 0; to: 1.25; duration: 160; easing.type: Easing.OutBack }
                ScaleAnimator { target: shout; from: 1.25; to: 1; duration: 100 }
            }
            SequentialAnimation {
                OpacityAnimator { target: shout; from: 1; to: 1; duration: 700 }
                OpacityAnimator { target: shout; from: 1; to: 0; duration: 220 }
            }
        }
    }

    // ---- the drawing ---------------------------------------------------------
    Item {
        id: rig
        width: 120
        height: 120
        x: (root.width - 120 * root.unit) / 2
        y: (root.height - 120 * root.unit) / 2
        scale: root.unit
        transformOrigin: Item.TopLeft
        // Mirrored about his own middle (a transform works in the item's
        // scaled units).
        transform: Scale {
            origin.x: 60 * root.unit
            xScale: root.turn
        }

        Part {
            name: "shadow"
            opacity: 1 - 0.65 * root.feet
            transform: Scale {
                origin.x: root.layout.ground[0]
                origin.y: root.layout.ground[1]
                xScale: (1 + (root.bodyScale - 1) * 0.9) * (1 - 0.25 * root.feet)
            }
        }

        Loader {
            id: dust
            active: root.fuss
            sourceComponent: Dust {}
        }

        // Leans and scales about the ground point, then rises with the pose.
        Item {
            id: body
            width: 120
            height: 120
            transform: [
                Translate { y: root.bodyY },
                Scale {
                    origin.x: root.layout.ground[0]
                    origin.y: root.layout.ground[1]
                    xScale: root.bodyScale
                    yScale: root.bodyScale * root.squash
                },
                Rotation {
                    origin.x: root.layout.ground[0]
                    origin.y: root.layout.ground[1]
                    angle: root.lean
                },
                // The startled stretch and the landing's squash.
                Scale {
                    origin.x: root.layout.ground[0]
                    origin.y: root.layout.ground[1]
                    xScale: root.thudX
                    yScale: root.thudY
                },
                // Stretched along the drag, whatever its direction.
                Rotation {
                    origin.x: root.layout.core[0]
                    origin.y: root.layout.core[1]
                    angle: -root.reaction.angle
                },
                Scale {
                    origin.x: root.layout.core[0]
                    origin.y: root.layout.core[1]
                    xScale: 1 + root.reaction.smear
                    yScale: 1 - root.reaction.smear / 2
                },
                Rotation {
                    origin.x: root.layout.core[0]
                    origin.y: root.layout.core[1]
                    angle: root.reaction.angle
                },
                // Hanging from where he was grabbed, the bottom trailing.
                Rotation {
                    origin.x: root.pivot.x
                    origin.y: root.pivot.y
                    angle: root.reaction.swing
                }
            ]

            // Breathing while the loops run; the nod when a turn finishes;
            // a nervous tremble while he dangles.
            Item {
                id: breath
                width: 120
                height: 120

                Item {
                    id: bodyNod
                    width: 120
                    height: 120

                    // Boot tips under the hem. Carried, his legs come out:
                    // they kick while he dangles and trail behind when he
                    // is pulled along.
                    Repeater {
                        model: root.layout.feet
                        delegate: Item {
                            id: leg

                            required property var modelData
                            required property int index
                            readonly property var boot: root.layout.boots[index]
                            // The two kick in turn.
                            readonly property int phase: index === 0 ? 3 : 1

                            x: modelData[0]
                            y: modelData[1]
                            rotation: root.reaction.feet

                            Item {
                                id: kick

                                Loader {
                                    active: root.feet > 0.02
                                    sourceComponent: Part {
                                        name: "leg"
                                        opacity: root.feet

                                        SineR { target: kick; running: root.live && root.carried; reach: 16; period: 480; phase: leg.phase }
                                    }
                                }

                                Item {
                                    x: leg.boot[0] - leg.modelData[0]
                                    y: leg.boot[1] - leg.modelData[1] + root.layout.dangle * root.feet

                                    Part {
                                        name: "boot"
                                    }
                                }
                            }
                        }
                    }

                    Part {
                        name: "body"
                    }

                    // His eyes light the inside of the hood.
                    Part {
                        name: "glow"
                        opacity: root.glow
                    }

                    // Light from below: a book, an orb, a cauldron.
                    Loader {
                        id: lit
                        readonly property real light: Math.max(root.book * 0.7, root.orb, root.pot * 0.8)
                        active: light > 0.01
                        sourceComponent: Part {
                            name: "underlight"
                            opacity: lit.light
                        }
                    }

                    // The pose's look, then glances and the pointer.
                    Item {
                        width: 120
                        height: 120
                        x: root.eyeX
                        y: root.eyeY + 1.2 * root.happy

                        Item {
                            width: 120
                            height: 120
                            x: root.gaze.x
                            y: root.gaze.y

                            Behavior on x {
                                enabled: root.animated
                                NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
                            }
                            Behavior on y {
                                enabled: root.animated
                                NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
                            }

                            Item {
                                id: dart
                                width: 120
                                height: 120

                                // Reading, writing and searching: his eyes
                                // run along what he works on.
                                Item {
                                    id: scan
                                    width: 120
                                    height: 120

                                    Item {
                                        id: eyesNod
                                        width: 120
                                        height: 120

                                        Repeater {
                                            model: [-1, 1]
                                            delegate: Item {
                                                id: eye

                                                required property real modelData
                                                // big widens his right eye.
                                                readonly property real size: modelData < 0 ? 1 - root.big * 0.06 : 1 + root.big * 0.2

                                                x: root.layout.eyes[0] + modelData * root.layout.eyeGap + (modelData > 0 ? root.big * 0.5 : 0)
                                                y: root.layout.eyes[1]

                                                Item {
                                                    opacity: root.glow * (1 - root.dizziness)
                                                    visible: opacity > 0.01
                                                    transform: Scale {
                                                        xScale: eye.size * (1 + 0.15 * root.feet)
                                                        yScale: eye.size * Math.max(0.06, root.eyeOpen * root.blink * root.squint)
                                                    }

                                                    // A smile lifts the eye's lower edge, as the
                                                    // rig bends it, until it is the happy arc.
                                                    Item {
                                                        opacity: 1 - root.smile
                                                        visible: opacity > 0.01
                                                        transform: [
                                                            Scale { yScale: 1 - 0.8 * Math.min(0.6, root.happy) },
                                                            Translate { y: -3.76 * Math.min(0.6, root.happy) }
                                                        ]

                                                        Part {
                                                            name: "eye"
                                                        }
                                                    }

                                                    Part {
                                                        name: "eye-happy"
                                                        opacity: root.smile
                                                        visible: opacity > 0.01
                                                    }
                                                }

                                                // An eyelid: the dark of the hood coming down over
                                                // the eye, slanted by the brow. Its top is round so
                                                // it stays inside the hood when the hat comes off.
                                                Rectangle {
                                                    readonly property real lower: eye.modelData < 0 ? root.lid : root.lidR
                                                    readonly property real tall: root.layout.eye[1] * root.eyeOpen * eye.size
                                                    readonly property real half: root.layout.eye[0] * eye.size + 3
                                                    readonly property real slant: root.brow * 2.6
                                                    // Where its lower edge crosses the eye's middle.
                                                    readonly property real edge: -tall - 0.9 + lower * 2 * tall + Math.abs(slant) * 0.55

                                                    x: -half
                                                    y: edge - height
                                                    width: 2 * half
                                                    height: Math.max(1, edge + 10.3)
                                                    topLeftRadius: Math.min(half, height)
                                                    topRightRadius: Math.min(half, height)
                                                    transformOrigin: Item.Bottom
                                                    rotation: -eye.modelData * Math.atan(slant / (half - 0.8)) * 180 / Math.PI
                                                    color: root.wiz.COLORS.face
                                                    antialiasing: true
                                                    visible: (lower > 0.01 || Math.abs(root.brow) > 0.02) && root.dizziness < 0.5
                                                }

                                                // Dizzy: spirals for eyes, turning opposite ways.
                                                Loader {
                                                    active: root.dizziness > 0.01
                                                    sourceComponent: Item {
                                                        opacity: root.dizziness

                                                        Item {
                                                            Part {
                                                                name: "dizzy-eye"
                                                            }

                                                            RotationAnimator on rotation {
                                                                running: root.live && root.dizziness > 0.01
                                                                loops: Animation.Infinite
                                                                from: 0
                                                                to: 360 * eye.modelData
                                                                duration: 900
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // His sleeves come out from under the cape. Each moves
                    // and swings with its hand, further down.
                    Item {
                        id: leftSleeveAct

                        Item {
                            x: root.layout.shoulders[0][0]
                            y: root.layout.shoulders[0][1]

                            Item {
                                id: leftSleeveSwing

                                Sleeve {
                                    hand: root.leftReach
                                }
                            }
                        }
                    }
                    Item {
                        id: rightSleeveAct

                        Item {
                            x: root.layout.shoulders[1][0]
                            y: root.layout.shoulders[1][1]

                            Item {
                                id: rightSleeveSwing

                                Sleeve {
                                    hand: root.rightReach
                                }
                            }
                        }
                    }

                    Part {
                        name: "cape"
                    }

                    // Tilts about the brim's centre, lifts about its left edge
                    // to peek, and rises with the voice.
                    Item {
                        id: hat
                        width: 120
                        height: 120
                        transform: [
                            Rotation {
                                origin.x: root.layout.peek[0]
                                origin.y: root.layout.peek[1]
                                angle: root.hatLift
                            },
                            Rotation {
                                origin.x: root.layout.brim[0]
                                origin.y: root.layout.brim[1]
                                angle: root.hatRot
                            },
                            Translate { y: root.hatY - root.voiceLift },
                            // Carried: blown back, shoved down or floating off;
                            // crooked after a landing, askew while dizzy.
                            Rotation {
                                origin.x: root.layout.brim[0]
                                origin.y: root.layout.brim[1]
                                angle: root.reaction.hatTilt + root.crook + 8 * root.dizziness
                            },
                            Translate {
                                x: root.reaction.hatX
                                y: root.reaction.hatY
                            }
                        ]

                        Item {
                            id: hatNod
                            width: 120
                            height: 120

                            Loader {
                                active: root.runes > 0.02
                                sourceComponent: Item {
                                    width: 120
                                    height: 120
                                    opacity: root.runes * 0.5

                                    Repeater {
                                        model: 4
                                        delegate: Orbiter {
                                            id: rune
                                            art: "rune" + rune.index
                                            running: root.live && root.runes > 0.02
                                        }
                                    }
                                }
                            }

                            Loader {
                                active: root.dizziness > 0.01
                                sourceComponent: Item {
                                    width: 120
                                    height: 120
                                    opacity: root.dizziness * 0.5

                                    Repeater {
                                        model: 4
                                        delegate: Orbiter {
                                            art: "dizzy-star"
                                            orbit: root.layout.dizzy
                                            size: 0.55
                                            running: root.live && root.dizziness > 0.01
                                        }
                                    }
                                }
                            }

                            Part {
                                name: "brim"
                            }

                            // The cone sways about its base; the rig bends it
                            // instead, which a still layer cannot.
                            Item {
                                x: root.layout.cone[0]
                                y: root.layout.cone[1]
                                rotation: root.tip * 1.6 + root.reaction.tip

                                Item {
                                    id: sway

                                    Part {
                                        name: "cone"
                                    }

                                    // The star hangs from the cone's tip on a
                                    // thread. Carried, it streams out behind.
                                    Item {
                                        x: root.layout.tip[0] - root.layout.cone[0]
                                        y: root.layout.tip[1] - root.layout.cone[1]
                                        rotation: root.reaction.star

                                        Item {
                                            id: star

                                            Part {
                                                name: "thread"
                                            }

                                            Item {
                                                y: root.layout.drop

                                                // How far a job has got: a ring, and the
                                                // arc that fills it, drawn again only when
                                                // the progress moves a step.
                                                Loader {
                                                    active: root.progress >= 0
                                                    sourceComponent: Part {
                                                        name: "ring"

                                                        Image {
                                                            width: parent.width
                                                            height: parent.height
                                                            source: WizArt.arc(root.filled, root.light)
                                                            sourceSize: parent.sourceSize
                                                            retainWhileLoading: true
                                                            smooth: true
                                                        }
                                                    }
                                                }

                                                Item {
                                                    id: twirl

                                                    Shine { name: "star-rest"; light: "rest" }
                                                    Shine { name: "star-lit"; light: "lit" }
                                                    Shine { name: "star-ask"; light: "ask" }
                                                    Shine { name: "star-bad"; light: "bad" }
                                                    Shine { name: "star-off"; light: "off" }

                                                    // The dim star over the lit one: a twinkle
                                                    // while he works, a pulse while he waits.
                                                    Item {
                                                        id: dimmer
                                                        opacity: 0

                                                        Part {
                                                            name: "star-rest"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Loader {
                                active: root.runes > 0.02
                                sourceComponent: Item {
                                    width: 120
                                    height: 120
                                    opacity: root.runes

                                    Repeater {
                                        model: 4
                                        delegate: Orbiter {
                                            id: frontRune
                                            front: true
                                            art: "rune" + frontRune.index
                                            running: root.live && root.runes > 0.02
                                        }
                                    }
                                }
                            }

                            Loader {
                                active: root.dizziness > 0.01
                                sourceComponent: Item {
                                    width: 120
                                    height: 120
                                    opacity: root.dizziness

                                    Repeater {
                                        model: 4
                                        delegate: Orbiter {
                                            front: true
                                            art: "dizzy-star"
                                            orbit: root.layout.dizzy
                                            size: 0.55
                                            running: root.live && root.dizziness > 0.01
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ---- what he works with ----
                    // Brewing: a cauldron, its bubbles rising.
                    Loader {
                        active: root.pot > 0.02
                        sourceComponent: Prop {
                            id: cauldron
                            around: "pot"
                            amount: root.pot
                            rise: 6

                            Part {
                                name: "pot"
                            }

                            Repeater {
                                model: 5
                                delegate: Bubble {
                                    id: rising
                                    x: (-6 + rising.index * 3) * 1.14
                                    y: -5.7
                                    running: root.live && cauldron.visible
                                }
                            }
                        }
                    }

                    // Reading: an open book.
                    Loader {
                        active: root.book > 0.02
                        sourceComponent: Prop {
                            around: "book"
                            amount: root.book

                            Part {
                                name: "book"
                            }
                        }
                    }

                    // Searching: an orb that bobs between his hands, its
                    // inside turning under the glass's shine.
                    Loader {
                        active: root.orb > 0.02
                        sourceComponent: Prop {
                            id: crystal
                            around: "orb"
                            amount: root.orb
                            rise: 0

                            Item {
                                id: orbBob

                                Part {
                                    name: "orb"
                                }

                                Item {
                                    Part {
                                        name: "orb-swirl"
                                    }

                                    RotationAnimator on rotation {
                                        running: root.live && crystal.visible
                                        loops: Animation.Infinite
                                        from: 0
                                        to: 360
                                        duration: 3927
                                    }
                                }

                                Part {
                                    name: "orb-shine"
                                }
                            }

                            SineY {
                                target: orbBob
                                running: root.act === "searching"
                                reach: 0.8
                                period: 3491
                                phase: 3
                                onRunningChanged: {
                                    if (!running)
                                        orbBob.y = 0;
                                }
                            }
                        }
                    }

                    // Writing: a scroll, and the lines he writes on it, one
                    // after the other. Without motion all three are written.
                    Loader {
                        active: root.scroll > 0.02
                        sourceComponent: Prop {
                            around: "scroll"
                            amount: root.scroll

                            Part {
                                name: "scroll"
                            }

                            Item {
                                rotation: root.layout.scroll.turn
                                scale: root.layout.scroll.size

                                Repeater {
                                    model: 3
                                    delegate: Item {
                                        id: line

                                        required property int index
                                        // One line's time: the rig writes 0.55 a second.
                                        readonly property int span: 1818

                                        x: root.layout.scroll.left
                                        y: root.layout.scroll.top + index * root.layout.scroll.step

                                        // Grows from its left end.
                                        Item {
                                            id: stroke

                                            Item {
                                                x: -root.layout.scroll.left
                                                y: -root.layout.scroll.top

                                                Part {
                                                    name: "scroll-line"
                                                }
                                            }
                                        }

                                        SequentialAnimation {
                                            running: root.act === "writing"
                                            loops: Animation.Infinite
                                            onRunningChanged: {
                                                if (!running)
                                                    stroke.scale = 1;
                                            }
                                            ScaleAnimator { target: stroke; from: 0; to: 0; duration: Math.max(1, line.index * line.span) }
                                            ScaleAnimator { target: stroke; from: 0; to: 1; duration: line.span }
                                            ScaleAnimator { target: stroke; from: 1; to: 1; duration: Math.max(1, (2 - line.index) * line.span) }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // His hands, over everything he holds. Each rides two
                    // items the loops move: one shifts it, one swings it
                    // from the shoulder; its sleeve has the same two.
                    Item {
                        id: leftAct

                        Item {
                            x: root.layout.shoulders[0][0]
                            y: root.layout.shoulders[0][1]

                            Item {
                                id: leftSwing

                                Item {
                                    x: root.leftReach.x
                                    y: root.leftReach.y
                                    rotation: Math.atan2(root.leftReach.y, root.leftReach.x) * 180 / Math.PI - 90
                                    opacity: Math.min(1, root.arms * 1.5)
                                    visible: root.arms > 0.05

                                    Part {
                                        name: "hand"
                                        visible: root.palms <= 0.5
                                    }
                                    Part {
                                        name: "hand-open"
                                        visible: root.palms > 0.5
                                    }
                                }
                            }
                        }
                    }

                    // The right hand holds things: the wand and its spell,
                    // the quill, a finger to point or a thumb to raise.
                    Item {
                        id: rightAct

                        Item {
                            x: root.layout.shoulders[1][0]
                            y: root.layout.shoulders[1][1]

                            Item {
                                id: rightSwing

                                Item {
                                    x: root.rightReach.x
                                    y: root.rightReach.y
                                    opacity: Math.min(1, root.arms * 1.5)
                                    visible: root.arms > 0.05

                                    Item {
                                        rotation: root.wandA
                                        opacity: root.wand

                                        Item {
                                            id: wandSwing

                                            Loader {
                                                active: root.wand > 0.05
                                                sourceComponent: Wand {}
                                            }
                                        }
                                    }

                                    Loader {
                                        active: root.scroll > 0.3
                                        sourceComponent: Item {
                                            x: -1.5
                                            y: 1
                                            rotation: 28
                                            opacity: root.scroll

                                            Part {
                                                name: "quill"
                                            }
                                        }
                                    }

                                    Loader {
                                        active: root.point > 0.02
                                        sourceComponent: Item {
                                            rotation: root.pointA
                                            scale: root.point

                                            Part {
                                                name: "finger"
                                            }
                                        }
                                    }

                                    Item {
                                        rotation: Math.atan2(root.rightReach.y, root.rightReach.x) * 180 / Math.PI - 90

                                        Part {
                                            name: "hand"
                                            mirror: true
                                            visible: root.palms <= 0.5
                                        }
                                        Part {
                                            name: "hand-open"
                                            mirror: true
                                            visible: root.palms > 0.5
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // The wisp: a helper at work beside him. It floats
                    // whenever it is there.
                    Loader {
                        active: root.wisp > 0.02
                        sourceComponent: Item {
                            id: helperWisp
                            x: root.layout.wisp[0]
                            y: root.layout.wisp[1]
                            scale: root.wisp
                            opacity: Math.min(1, root.wisp * 1.4)

                            Item {
                                id: wispBob

                                Item {
                                    id: wispFlicker

                                    Part {
                                        name: "wisp"
                                    }
                                }
                            }

                            SineX { target: wispBob; running: root.live && helperWisp.visible; reach: 2.4; period: 4833; phase: 3 }
                            SineY { target: wispBob; running: root.live && helperWisp.visible; reach: 2.2; period: 2856; phase: 3 }
                            SineR { target: wispFlicker; running: root.live && helperWisp.visible; reach: 5; period: 1047; phase: 3 }
                        }
                    }

                    // Out: three z's. They read the right way round
                    // whichever way he faces.
                    Loader {
                        active: root.zzz > 0.02
                        sourceComponent: Item {
                            Repeater {
                                model: root.layout.zzz
                                delegate: Item {
                                    required property var modelData
                                    x: modelData[0]
                                    y: modelData[1]
                                    scale: modelData[2]
                                    opacity: root.zzz * modelData[3]
                                    transform: Scale { xScale: root.side }

                                    Part {
                                        name: "zzz"
                                    }
                                }
                            }
                        }
                    }

                    // A finished turn: a burst once, or held still.
                    Loader {
                        id: sparkles
                        active: root.festive
                        sourceComponent: Sparkles {}
                    }

                    // Grabbed: "?!" and sweat.
                    Loader {
                        id: panic
                        active: root.fuss
                        sourceComponent: Panic {}
                    }
                }
            }
        }
    }

    // ---- the star ------------------------------------------------------------------
    // The ring's arc is drawn in sixtieths of a turn (there is no ring below 0).
    readonly property int filled: Math.round(Math.min(1, progress) * 60)

    // It swings on its thread when he moves and comes to rest: one eased
    // turn, not a simulation.
    SequentialAnimation {
        id: swinging
        RotationAnimator { target: star; from: 0; to: 16; duration: 160; easing.type: Easing.OutQuad }
        RotationAnimator { target: star; from: 16; to: 0; duration: 1500; easing.type: Easing.OutElastic; easing.amplitude: 1.6; easing.period: 0.42 }
    }

    // Working: it twinkles, the dim star showing through, and turns slowly.
    // A quarter turn looks like none, so it always ends one where it began.
    SequentialAnimation {
        running: root.busy && root.act !== ""
        loops: Animation.Infinite
        OpacityAnimator { target: dimmer; from: 0; to: 0.55; duration: 483; easing.type: Easing.InOutSine }
        OpacityAnimator { target: dimmer; from: 0.55; to: 0; duration: 483; easing.type: Easing.InOutSine }
    }
    RotationAnimator {
        id: twirling
        running: root.live && root.busy
        loops: Animation.Infinite
        alwaysRunToEnd: true
        target: twirl
        from: 0
        to: 90
        duration: 2250
    }

    // ---- what his hands do -----------------------------------------------------------
    // `act` is the pose whose motion is running: empty while he may not move,
    // and for a moment after each change of pose, while his hands, his eyes
    // and his hat come to rest from the last one (settle).
    property string act: ""

    // Thinking: a finger taps his chin.
    SequentialAnimation {
        running: root.act === "thinking"
        loops: Animation.Infinite
        YAnimator { target: rightAct; from: 0; to: -0.9; duration: 462; easing.type: Easing.OutSine }
        YAnimator { target: rightAct; from: -0.9; to: 0; duration: 462; easing.type: Easing.InSine }
        PauseAnimation { duration: 924 }
    }

    // Reading: his eyes run along the line and jump back.
    SequentialAnimation {
        running: root.act === "reading"
        loops: Animation.Infinite
        XAnimator { target: scan; from: -2.2; to: 2.2; duration: 2100 }
        XAnimator { target: scan; from: 2.2; to: -2.2; duration: 122 }
    }

    // Searching: his hands circle the orb, which bobs, and his eyes follow.
    SineY { target: leftAct; running: root.act === "searching"; reach: 1.3; period: 2732; phase: 3 }
    SineY { target: rightAct; running: root.act === "searching"; reach: 1.3; period: 2732; phase: 1 }
    SineX { target: scan; running: root.act === "searching"; reach: 1.2; period: 5712; phase: 3 }

    // Writing: his hand and its sleeve run along the line and jump back, a
    // line lower each time, and his eyes go with them.
    SequentialAnimation {
        running: root.act === "writing"
        loops: Animation.Infinite
        XAnimator { target: rightAct; from: -6; to: 4; duration: 1700 }
        XAnimator { target: rightAct; from: 4; to: -6; duration: 118 }
    }
    SequentialAnimation {
        running: root.act === "writing"
        loops: Animation.Infinite
        XAnimator { target: rightSleeveAct; from: -6; to: 4; duration: 1700 }
        XAnimator { target: rightSleeveAct; from: 4; to: -6; duration: 118 }
    }
    SequentialAnimation {
        running: root.act === "writing"
        loops: Animation.Infinite
        YAnimator { target: rightAct; from: -1.7; to: -1.7; duration: 1818 }
        YAnimator { target: rightAct; from: 0; to: 0; duration: 1818 }
        YAnimator { target: rightAct; from: 1.7; to: 1.7; duration: 1818 }
    }
    SequentialAnimation {
        running: root.act === "writing"
        loops: Animation.Infinite
        XAnimator { target: scan; from: -1; to: 1; duration: 1700 }
        XAnimator { target: scan; from: 1; to: -1; duration: 118 }
    }

    // Casting, and work of no particular kind: the wand hand circles, the
    // wand waves and the other hand bobs.
    readonly property bool casting: act === "casting" || act === "working"
    SineX { target: rightAct; running: root.casting; reach: 1.5; period: 1208; phase: 0 }
    SineY { target: rightAct; running: root.casting; reach: 1.5; period: 1208; phase: 3 }
    SineR { target: wandSwing; running: root.casting; reach: 10; period: 1208; phase: 3 }
    SineY { target: leftAct; running: root.casting; reach: 0.8; period: 2416; phase: 3 }

    // Brewing: he stirs.
    SineX { target: rightAct; running: root.act === "brewing"; reach: 3.4; period: 1963; phase: 0 }
    SineY { target: rightAct; running: root.act === "brewing"; reach: 1.1; period: 1963; phase: 3 }
    SineR { target: wandSwing; running: root.act === "brewing"; reach: 9; period: 1963; phase: 2 }

    // Delegating: an open hand towards the wisp, turning a little.
    SineX { target: leftAct; running: root.act === "delegating"; reach: 1; period: 2992; phase: 3 }
    SineY { target: leftAct; running: root.act === "delegating"; reach: 1.2; period: 2992; phase: 0 }

    // Recording: the hand at his ear.
    SineX { target: rightAct; running: root.act === "listening" && root.recording; reach: 0.5; period: 2856; phase: 3 }

    // Carried: his hands flail.
    SineX { target: leftAct; running: root.act === "carried"; reach: 2.4; period: 370; phase: 3 }
    SineY { target: leftAct; running: root.act === "carried"; reach: 2.4; period: 419; phase: 0 }
    SineX { target: rightAct; running: root.act === "carried"; reach: 2.4; period: 393; phase: 1 }
    SineY { target: rightAct; running: root.act === "carried"; reach: 2.4; period: 349; phase: 2 }

    // An arm swinging out and back from its shoulder, hand and sleeve
    // together: a wave.
    component Wave: ParallelAnimation {
        id: wave
        required property Item hand
        required property Item sleeve
        property real reach: 4
        property int beat: 275
        SequentialAnimation {
            RotationAnimator { target: wave.hand; from: 0; to: wave.reach; duration: wave.beat; easing.type: Easing.OutSine }
            RotationAnimator { target: wave.hand; from: wave.reach; to: -wave.reach; duration: 2 * wave.beat; easing.type: Easing.InOutSine }
            RotationAnimator { target: wave.hand; from: -wave.reach; to: 0; duration: wave.beat; easing.type: Easing.InSine }
        }
        SequentialAnimation {
            RotationAnimator { target: wave.sleeve; from: 0; to: wave.reach; duration: wave.beat; easing.type: Easing.OutSine }
            RotationAnimator { target: wave.sleeve; from: wave.reach; to: -wave.reach; duration: 2 * wave.beat; easing.type: Easing.InOutSine }
            RotationAnimator { target: wave.sleeve; from: -wave.reach; to: 0; duration: wave.beat; easing.type: Easing.InSine }
        }
    }

    // A hand going out along (dx, dy) and back.
    component Nudge: ParallelAnimation {
        id: nudge
        required property Item item
        property real dx: 0
        property real dy: 0
        property int beat: 300
        SequentialAnimation {
            XAnimator { target: nudge.item; from: 0; to: nudge.dx; duration: nudge.beat; easing.type: Easing.OutSine }
            XAnimator { target: nudge.item; from: nudge.dx; to: 0; duration: nudge.beat; easing.type: Easing.InSine }
        }
        SequentialAnimation {
            YAnimator { target: nudge.item; from: 0; to: nudge.dy; duration: nudge.beat; easing.type: Easing.OutSine }
            YAnimator { target: nudge.item; from: nudge.dy; to: 0; duration: nudge.beat; easing.type: Easing.InSine }
        }
    }

    // What a pose does once as it arrives: a few waves, a cheer, a shrug.
    // They are short; nothing here loops for good.
    Wave { id: greeting; hand: leftSwing; sleeve: leftSleeveSwing; reach: 9; beat: 185; loops: 3 }
    Nudge { id: cheering; item: rightAct; dy: -2.2; beat: 187; loops: 3 }
    ParallelAnimation {
        id: shrugging
        Nudge { item: leftAct; dy: -1.6; beat: 330; loops: 2 }
        Nudge { item: rightAct; dy: -1.6; beat: 330; loops: 2 }
    }
    ParallelAnimation {
        id: wringing
        Nudge { item: leftAct; dx: 0.7; beat: 260; loops: 3 }
        Nudge { item: rightAct; dx: -0.7; beat: 260; loops: 3 }
    }
    ParallelAnimation {
        id: peering
        Nudge { item: leftAct; dy: -0.9; beat: 300; loops: 2 }
        Nudge { item: rightAct; dy: -0.9; beat: 300; loops: 2 }
    }
    // Pointing: two small jabs along the wand.
    Nudge {
        id: jabbing
        item: rightAct
        dx: 1.8 * Math.cos(root.wandA * Math.PI / 180)
        dy: 1.8 * Math.sin(root.wandA * Math.PI / 180)
        beat: 200
        loops: 2
    }

    function gesture() {
        switch (pose) {
        case "greeting": greeting.restart(); break;
        case "proud": cheering.restart(); break;
        case "shrug": shrugging.restart(); break;
        case "sorry": wringing.restart(); break;
        case "curious": peering.restart(); break;
        case "pointing": jabbing.restart(); break;
        }
    }

    // ---- breathing and the sway --------------------------------------------------
    // The loops start from rest and ease back to it, so changing pose never
    // makes the hat or a hand jump.
    property real breathDepth: 0
    property real swayReach: 0

    SineY { id: breathing; target: breath; reach: root.breathDepth; period: 2992; phase: 3 }
    SineR { id: swaying; target: sway; reach: root.swayReach; period: 4488; phase: 3 }

    // Everything a loop or a gesture moves, eased back to where it rests.
    readonly property list<Item> shifted: [leftAct, rightAct, leftSleeveAct, rightSleeveAct, scan]
    readonly property list<Item> turned: [sway, leftSwing, rightSwing, leftSleeveSwing, rightSleeveSwing, wandSwing]
    ParallelAnimation {
        id: settling
        YAnimator { target: breath; to: 0; duration: 300; easing.type: Easing.OutCubic }
        XAnimator { target: leftAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        YAnimator { target: leftAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        XAnimator { target: rightAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        YAnimator { target: rightAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        XAnimator { target: leftSleeveAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        YAnimator { target: leftSleeveAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        XAnimator { target: rightSleeveAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        YAnimator { target: rightSleeveAct; to: 0; duration: 300; easing.type: Easing.OutCubic }
        XAnimator { target: scan; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: sway; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: leftSwing; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: rightSwing; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: leftSleeveSwing; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: rightSleeveSwing; to: 0; duration: 300; easing.type: Easing.OutCubic }
        RotationAnimator { target: wandSwing; to: 0; duration: 300; easing.type: Easing.OutCubic }
        OpacityAnimator { target: dimmer; to: 0; duration: 300; easing.type: Easing.OutCubic }
        onFinished: root.resume()
    }

    // A rare shake of the hat while idle.
    SequentialAnimation {
        id: wobble
        RotationAnimator { target: sway; from: 0; to: 2.4; duration: 380; easing.type: Easing.OutSine }
        RotationAnimator { target: sway; from: 2.4; to: -1.6; duration: 520; easing.type: Easing.InOutSine }
        RotationAnimator { target: sway; from: -1.6; to: 0.8; duration: 460; easing.type: Easing.InOutSine }
        RotationAnimator { target: sway; from: 0.8; to: 0; duration: 420; easing.type: Easing.InOutSine }
    }

    Timer {
        running: root.live && root.pose === "idle" && !root.hovered
        repeat: true
        interval: 20000
        onTriggered: {
            if (!settling.running && !swaying.running) {
                wobble.restart();
                swinging.restart();
            }
            interval = 20000 + Math.random() * 15000;
        }
    }

    // Back to rest, then what this pose does, at its own reach.
    function settle() {
        act = "";
        breathing.stop();
        swaying.stop();
        wobble.stop();
        asking.stop();
        greeting.stop();
        cheering.stop();
        shrugging.stop();
        wringing.stop();
        peering.stop();
        jabbing.stop();
        if (animated) {
            settling.restart();
        } else {
            settling.stop();
            breath.y = 0;
            dimmer.opacity = 0;
            for (const item of shifted) {
                item.x = 0;
                item.y = 0;
            }
            for (const item of turned)
                item.rotation = 0;
        }
    }
    function resume() {
        if (!live)
            return;
        act = pose;
        gesture();
        if (!looping)
            return;
        breathDepth = 0.9 * stance.bob;
        swayReach = 2.1 * stance.sway;
        breathing.start();
        swaying.start();
    }
    onLoopingChanged: settle()
    Component.onCompleted: {
        festive = pose === "finished" || pose === "proud";
        resume();
    }

    // ---- once: the finished turn, and the waiting pulse --------------------------
    // Two nods: the body dips a little, the eyes more, the hat most.
    ParallelAnimation {
        id: nodding
        Nod { item: bodyNod; depth: 0.8 }
        Nod { item: eyesNod; depth: 1.4 }
        Nod { item: hatNod; depth: 2.6 }
    }

    component Nod: SequentialAnimation {
        id: nod
        required property Item item
        required property real depth
        YAnimator { target: nod.item; from: 0; to: 0; duration: 150 }
        YAnimator { target: nod.item; from: 0; to: nod.depth; duration: 200; easing.type: Easing.OutSine }
        YAnimator { target: nod.item; from: nod.depth; to: 0; duration: 200; easing.type: Easing.InSine }
        YAnimator { target: nod.item; from: 0; to: nod.depth; duration: 200; easing.type: Easing.OutSine }
        YAnimator { target: nod.item; from: nod.depth; to: 0; duration: 200; easing.type: Easing.InSine }
    }

    // The sparkles are made for those two poses and let go after them. Set
    // as the pose changes, so they are there when sparkle() wants them.
    property bool festive: false

    function sparkle() {
        (sparkles.item as Sparkles)?.flare();
    }

    property int pulses: 0

    // A waiting question: the star dims and comes back, and the raised hand
    // waves.
    ParallelAnimation {
        id: asking
        SequentialAnimation {
            OpacityAnimator { target: dimmer; from: 0; to: 0.8; duration: 550; easing.type: Easing.InOutSine }
            OpacityAnimator { target: dimmer; from: 0.8; to: 0; duration: 550; easing.type: Easing.InOutSine }
        }
        Wave { hand: rightSwing; sleeve: rightSleeveSwing; reach: 4 }
    }

    // Three pulses as the question arrives, then a reminder now and then: a
    // question can wait for minutes, and the box already shows it.
    Timer {
        running: root.act === "needs-input"
        repeat: true
        triggeredOnStart: true
        interval: root.pulses < 3 ? 1111 : 8000
        onTriggered: {
            asking.restart();
            root.pulses++;
        }
    }

    // ---- carried ----------------------------------------------------------------
    // The drag's velocity (WizRig.follow), normalised and sprung, so he swings
    // past and settles when the pointer stops. Everything he does while
    // carried reads `reaction`. Mirrored, he reacts in his own frame.
    property var tracker: null
    property real ux: 0
    property real uy: 0
    readonly property var reaction: wiz.carry(ux * side, uy)
    readonly property point pivot: Qt.point(side > 0 ? grab.x / unit : 120 - grab.x / unit, grab.y / unit)
    // Nearly still: he trembles instead.
    readonly property bool dangling: carried && Math.abs(ux) + Math.abs(uy) < 0.08

    component Spring: SpringAnimation {
        spring: 3.5
        damping: 0.22
        epsilon: 0.002
    }
    Behavior on ux { enabled: root.animated; Spring {} }
    Behavior on uy { enabled: root.animated; Spring {} }

    function follow() {
        tracker = wiz.follow(tracker, dragPoint.x, dragPoint.y, Date.now());
        ux = wiz.normal(tracker.vx);
        uy = wiz.normal(tracker.vy);
        if (wiz.shaken(tracker))
            dizzy = true;
        calm.restart();
    }
    onDragPointChanged: {
        if (carried && live)
            follow();
    }

    // The pointer stopped: he swings back to hanging straight.
    Timer {
        id: calm
        interval: root.wiz.CARRY.stale
        onTriggered: {
            root.ux = 0;
            root.uy = 0;
        }
    }

    // ---- dizzy ------------------------------------------------------------------
    property bool dizzy: false
    property real dizziness: dizzy ? 1 : 0
    Behavior on dizziness {
        enabled: root.animated
        NumberAnimation { duration: 300 }
    }

    // Seeing stars for a while after he is put down.
    Timer {
        id: recover
        interval: 2200
        onTriggered: root.dizzy = false
    }

    // ---- picked up and put down -------------------------------------------------
    property real thudX: 1
    property real thudY: 1
    property real squint: 1
    property real crook: 0
    // How hard the landing was, 0.35..1, from how fast he was moving.
    property real impact: 0.35
    property real hop: 12
    property int drips: 0
    // "?!", sweat and dust are made when he is grabbed or lands and let go
    // once the last of them has faded.
    property bool fuss: false

    Timer {
        id: tidy
        interval: 2000
        onTriggered: root.fuss = false
    }

    onCarriedChanged: {
        if (carried) {
            tracker = null;
            recover.stop();
            if (live)
                startle();
        } else {
            impact = Math.min(1, 0.35 + 0.65 * Math.sqrt(ux * ux + uy * uy));
            calm.stop();
            tidy.restart();
            ux = 0;
            uy = 0;
            if (live)
                land();
            if (dizzy)
                recover.restart();
        }
    }

    // "Yikes": he jumps up stretched, his hat pops off, his eyes dart, "?!"
    // flashes and sweat flies.
    function startle() {
        nodding.stop();
        landing.stop();
        crooking.stop();
        crook = 0;
        squint = 1;
        startling.restart();
        hop = 12;
        hopping.restart();
        doubleTake.restart();
        fuss = true;
        tidy.stop();
        (panic.item as Panic)?.startle();
    }

    // A thud: squashed with his eyes shut, the hat landing a beat later and
    // crooked, dust, then a bead of sweat and a shake of the hat.
    function land(sweat) {
        startling.stop();
        doubleTake.stop();
        landing.restart();
        hop = 10 * impact;
        hopping.restart();
        crooking.restart();
        swinging.restart();
        fuss = true;
        tidy.restart();
        (dust.item as Dust)?.burst();
        if (sweat !== false)
            (panic.item as Panic)?.slide();
    }

    // Set down somewhere new without a drag, as the welcome guide hands him
    // to his corner: a light landing, no sweat.
    function arrive() {
        if (!live)
            return;
        impact = 0.5;
        land(false);
    }

    SequentialAnimation {
        id: startling
        ParallelAnimation {
            NumberAnimation { target: root; property: "thudY"; to: 1.14; duration: 90; easing.type: Easing.OutQuad }
            NumberAnimation { target: root; property: "thudX"; to: 0.94; duration: 90; easing.type: Easing.OutQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: root; property: "thudY"; to: 1; duration: 320; easing.type: Easing.OutBack }
            NumberAnimation { target: root; property: "thudX"; to: 1; duration: 320; easing.type: Easing.OutBack }
        }
    }

    SequentialAnimation {
        id: landing
        ParallelAnimation {
            NumberAnimation { target: root; property: "thudY"; to: 1 - 0.2 * root.impact; duration: 90; easing.type: Easing.OutQuad }
            NumberAnimation { target: root; property: "thudX"; to: 1 + 0.1 * root.impact; duration: 90; easing.type: Easing.OutQuad }
            NumberAnimation { target: root; property: "squint"; to: 0.12; duration: 80 }
        }
        ParallelAnimation {
            NumberAnimation { target: root; property: "thudY"; to: 1 + 0.07 * root.impact; duration: 140; easing.type: Easing.OutQuad }
            NumberAnimation { target: root; property: "thudX"; to: 1 - 0.03 * root.impact; duration: 140; easing.type: Easing.OutQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: root; property: "thudY"; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { target: root; property: "thudX"; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { target: root; property: "squint"; to: 1; duration: 320; easing.type: Easing.OutCubic }
        }
    }

    // The hat leaves his head and comes down with a bounce.
    SequentialAnimation {
        id: hopping
        YAnimator { target: hatNod; from: 0; to: -root.hop; duration: 140; easing.type: Easing.OutQuad }
        YAnimator { target: hatNod; from: -root.hop; to: 0; duration: 460; easing.type: Easing.OutBounce }
    }

    // It lands crooked; a moment later he shakes it straight.
    SequentialAnimation {
        id: crooking
        PauseAnimation { duration: 380 }
        NumberAnimation { target: root; property: "crook"; to: 7 * root.impact; duration: 150; easing.type: Easing.OutBack }
        PauseAnimation { duration: 650 }
        NumberAnimation { target: root; property: "crook"; to: -2.5; duration: 140; easing.type: Easing.InOutSine }
        NumberAnimation { target: root; property: "crook"; to: 1.5; duration: 120; easing.type: Easing.InOutSine }
        NumberAnimation { target: root; property: "crook"; to: 0; duration: 160; easing.type: Easing.OutSine }
    }

    SequentialAnimation {
        id: doubleTake
        XAnimator { target: dart; from: 0; to: -1.8; duration: 70 }
        XAnimator { target: dart; from: -1.8; to: 1.8; duration: 110 }
        XAnimator { target: dart; from: 1.8; to: 0; duration: 120 }
    }

    // Dangling: a nervous tremble, and a bead of sweat now and then.
    SequentialAnimation {
        running: root.live && root.dangling
        loops: Animation.Infinite
        onStopped: breath.x = 0
        XAnimator { target: breath; from: 0; to: 0.5; duration: 60 }
        XAnimator { target: breath; from: 0.5; to: -0.5; duration: 120 }
        XAnimator { target: breath; from: -0.5; to: 0; duration: 60 }
    }

    Timer {
        running: root.live && root.carried
        repeat: true
        interval: 1500
        onTriggered: {
            root.fuss = true;
            (panic.item as Panic)?.drip(root.drips);
            root.drips++;
        }
    }

    onLiveChanged: {
        if (!live) {
            nodding.complete();
            swinging.complete();
            twirling.complete();
            startling.complete();
            landing.complete();
            hopping.complete();
            crooking.complete();
            dizzy = false;
            ux = 0;
            uy = 0;
        }
        settle();
    }
}
