import QtQuick
import QtQuick.Controls as Controls
import "../../Common"

// One quick-toggle tile in the Overview grid: glyph over label. A quick
// toggle is a switch, so "on" wears a switch's on state: a solid accent fill
// with accentFg ink (docs/shell-states.md). An outline is keyboard focus
// alone; the 2026-11-24 review found the old 2 px accent border read as a
// focus ring. Off keeps the quiet chip, with the light-mode card edge so it
// still reads as a button on a pale drawer. typography.test.cjs lists this
// file among the switch tracks allowed an accent field.
Rectangle {
    id: root

    property string glyph: ""
    property string label: ""
    // Anything the label does not already say, for the tooltip and
    // assistive technology ("Focus" silences notifications).
    property string description: ""
    property bool on: false
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
    Accessible.description: description
    Accessible.onToggleAction: root.toggled()
    Controls.ToolTip.visible: description !== "" && tileMouse.containsMouse
    Controls.ToolTip.delay: 600
    Controls.ToolTip.text: description

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

        Sym {
            anchors.horizontalCenter: parent.horizontalCenter
            name: root.glyph
            size: Theme.iconLarge
            color: root.ink
        }

        // Two lines at most: "Night light" wraps at a larger text size or a
        // narrow drawer, and a longer translation ends in an ellipsis.
        Text {
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
            color: root.ink
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
