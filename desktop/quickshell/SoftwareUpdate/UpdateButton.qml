import QtQuick
import "../Common"

// The app's buttons: one filled primary action per page, secondary ones on
// the chip, and `quiet` tertiary ones (copy on a hover layer) for an action
// that should not compete with the decision beside it. Taller than a
// settings action, as a dialog's are.
Rectangle {
    id: root

    property string text: ""
    property string glyph: ""
    property bool primary: false
    property bool quiet: false
    // The page's tone (accent, ok, warn, error or neutral). A primary action
    // after a warning or a failure is amber: the next step is the person's.
    property string tone: "accent"
    signal triggered()

    readonly property bool attention: primary && (tone === "warn" || tone === "error")
    // Amber copy already contrasts with the panel, so ink of the panel's
    // own lightness reads on an amber fill.
    readonly property color ink: quiet && !primary ? Theme.textMid
        : !primary ? Theme.textHi
        : attention ? (Theme.dark ? "#1c1c12" : "#ffffff")
        : Theme.textOnAccent

    implicitWidth: content.implicitWidth + Theme.scaled(quiet ? 24 : 32)
    implicitHeight: Theme.scaled(38)
    radius: Theme.chipRadius + 3
    color: primary ? (attention ? Theme.amber : Theme.accent) : quiet ? "transparent" : Theme.hoverFill
    // The keyboard ring; on an accent or amber fill an accent ring would
    // vanish, so a primary takes textHi.
    border.width: Theme.focusWidth(activeFocus)
    border.color: primary ? Theme.textHi : Theme.focusRing
    opacity: enabled ? 1 : 0.45
    activeFocusOnTab: enabled && visible
    Accessible.role: Accessible.Button
    Accessible.name: root.text
    Accessible.onPressAction: {
        if (root.enabled)
            root.triggered();
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
            if (root.enabled)
                root.triggered();
            event.accepted = true;
        }
    }

    StateLayer {
        anchors.fill: parent
        radius: parent.radius
        hovered: mouse.containsMouse && root.enabled
        pressed: mouse.pressed
        focused: root.activeFocus
        tint: root.ink
        pressPoint: Qt.point(mouse.mouseX, mouse.mouseY)
    }

    Row {
        id: content
        anchors.centerIn: parent
        spacing: Theme.scaled(7)
        Sym {
            visible: root.glyph !== ""
            anchors.verticalCenter: parent.verticalCenter
            name: root.glyph
            size: Theme.iconMedium
            color: root.ink
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: root.text
            color: root.ink
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.control
            font.weight: root.quiet && !root.primary ? Theme.weightMedium : Theme.weightSemibold
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: root.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: {
            if (root.enabled)
                root.triggered();
        }
    }
}
