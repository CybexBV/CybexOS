import QtQuick
import QtQuick.Controls as Controls
import "../../Common"
import "DrawerFormat.js" as DrawerFormat

// One quick-toggle tile in the Overview grid: glyph over label. A quick
// toggle is a switch, so "on" wears a switch's on state: a solid accent fill
// with accentFg ink (docs/shell-states.md). An outline is keyboard focus
// alone; the 2026-11-24 review found the old 2 px accent border read as a
// focus ring. Off keeps the quiet chip, with the light-mode card edge so it
// still reads as a button on a pale drawer. typography.test.cjs lists this
// file among the switch tracks allowed an accent field.
//
// A tile shows what is in effect, not what was asked for: `on` is the actual
// state. A toggle backed by a process (Night light, Stay awake) also passes
// what was requested, whether a change is under way and its last error.
// While a change runs the glyph turns into the spinner; when one fails the
// tile says "Failed" in red for a few seconds, then shows the actual state
// again.
// Both reach assistive technology as the tile's description.
Rectangle {
    id: root

    property string glyph: ""
    property string label: ""
    // Anything the label does not already say, for the tooltip and
    // assistive technology ("Focus" silences notifications).
    property string description: ""
    // What is in effect.
    property bool on: false
    // What was asked for; the same as `on` for a toggle that takes effect
    // at once (Dark mode, Focus).
    property bool requested: on
    property bool pending: false
    // The service's last failure; "" while there is none.
    property string error: ""
    // A failure shows for this long, then the tile shows the actual state.
    property int failureShownMs: 4000
    property bool failureShown: false
    readonly property string phase: DrawerFormat.togglePhase(on, requested,
        pending, failureShown)
    // What a press asks for (DrawerFormat.toggleTarget): the opposite of
    // what shows. When it equals `requested` the caller retries.
    readonly property bool target: DrawerFormat.toggleTarget(on, requested, pending)
    readonly property bool failing: phase === "failedOn" || phase === "failedOff"
    readonly property string statusText: phase === "turningOn" ? I18n.tr("Turning on…")
        : phase === "turningOff" ? I18n.tr("Turning off…") : ""
    // Said by assistive technology and the tooltip: the change under way,
    // else a failure the service still reports, else the plain description.
    readonly property string stateDescription: pending ? statusText
        : error !== "" ? (requested ? I18n.format("Didn't turn on: %1", [error])
            : I18n.format("Didn't turn off: %1", [error]))
        : description
    // The height its content asks for. The Overview grid gives every tile
    // in a row the tallest of these, so a label that wraps at a larger text
    // size never leaves its neighbours short.
    readonly property real naturalHeight: Math.max(Theme.scaled(60),
        tileContent.implicitHeight + Theme.controlSpacing * 2)
    readonly property color ink: on ? Theme.accentFg : Theme.textMid
    signal toggled()

    height: naturalHeight
    radius: 10
    color: on ? Theme.accent : Theme.chip
    activeFocusOnTab: true
    border.width: on ? 0 : Theme.cardEdgeWidth
    border.color: Theme.cardEdge
    Accessible.role: Accessible.CheckBox
    Accessible.checked: on
    Accessible.name: label
    Accessible.description: stateDescription
    Accessible.onToggleAction: root.toggled()
    Controls.ToolTip.visible: stateDescription !== "" && tileMouse.containsMouse
    Controls.ToolTip.delay: 600
    Controls.ToolTip.text: stateDescription

    // Only a failure that arrives while the tile is up flashes: the outer
    // binding's first value lands during creation, and a failure from
    // before the drawer opened is no news (the description still says it).
    property bool settled: false
    Component.onCompleted: settled = true
    onErrorChanged: {
        failureShown = settled && error !== "";
        if (failureShown)
            failureTimer.restart();
        else
            failureTimer.stop();
    }

    Timer {
        id: failureTimer
        interval: root.failureShownMs
        onTriggered: root.failureShown = false
    }

    Behavior on color {
        ColorAnimation { duration: Theme.chipFadeDuration }
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                || event.key === Qt.Key_Space) {
            root.toggled();
            event.accepted = true;
        }
    }

    Column {
        id: tileContent
        anchors.centerIn: parent
        // A few pixels either side, not a full control gutter: the label is
        // the widest thing in a quarter of the drawer.
        width: Math.max(0, parent.width - Theme.scaled(4) * 2)
        spacing: Theme.iconTextSpacing

        // The spinner while a change runs, a red mark while a failure shows.
        Sym {
            id: tileGlyph
            anchors.horizontalCenter: parent.horizontalCenter
            name: root.pending ? "progress_activity"
                : root.failing ? "error" : root.glyph
            size: Theme.iconLarge
            color: root.failing && !root.on ? Theme.redText : root.ink

            RotationAnimator on rotation {
                running: root.pending && root.visible && !Theme.reducedMotion
                from: 0
                to: 360
                duration: 900
                loops: Animation.Infinite
                onRunningChanged: if (!running) tileGlyph.rotation = 0
            }
        }

        // Two lines at most: "Night light" wraps at a larger text size or a
        // narrow drawer, and a longer translation ends in an ellipsis.
        Text {
            id: tileLabel
            anchors.horizontalCenter: parent.horizontalCenter
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            text: root.label
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.control
            font.weight: root.on ? Theme.weightSemibold : Theme.weightMedium
            color: root.failing ? "transparent" : root.ink

            // A failure says so in the name's place and in the name's room,
            // so the row of tiles never grows for it.
            Text {
                anchors.fill: parent
                visible: root.failing
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                wrapMode: Text.Wrap
                maximumLineCount: Math.max(1, tileLabel.lineCount)
                elide: Text.ElideRight
                text: I18n.tr("Failed")
                font: tileLabel.font
                color: root.failing && !root.on ? Theme.redText : root.ink
                Accessible.ignored: true
            }
        }
    }

    StateLayer {
        anchors.fill: parent
        radius: parent.radius
        hovered: tileMouse.containsMouse
        pressed: tileMouse.pressed
        tint: root.ink
        pressPoint: Qt.point(tileMouse.mouseX, tileMouse.mouseY)
    }

    // The keyboard ring. On the accent fill it is drawn in accentFg, a step
    // inside the edge so a band of accent frames it, with a concentric
    // corner; off, it is the shared ring on the tile's own edge.
    Rectangle {
        readonly property real inset: root.on ? Theme.selectedBorderWidth : 0
        anchors.fill: parent
        anchors.margins: inset
        radius: Theme.concentricRadius(root.radius, inset)
        color: "transparent"
        border.width: Theme.focusWidth(root.activeFocus)
        border.color: root.on ? Theme.accentFg : Theme.focusRing
    }

    MouseArea {
        id: tileMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
            root.forceActiveFocus();
            root.toggled();
        }
    }
}
