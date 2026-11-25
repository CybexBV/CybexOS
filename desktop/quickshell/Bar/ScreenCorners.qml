import QtQuick
import Quickshell
import Quickshell.Wayland
import "../Common"

// The Hug bar's rounded screen corners on the edge opposite the bar: two
// inverted corners in black, the same size and curve as the bar's own, so the
// desktop reads as one rounded screen. A click-through strip along that edge,
// one per output beside its bar.
PanelWindow {
    id: root

    // The output's bar: the corners show while its Hug corners do.
    required property var bar

    readonly property bool atTop: Settings.position === "bottom"
    readonly property bool shown: Theme.barHug && !bar.hidden

    anchors {
        top: root.atTop
        bottom: !root.atTop
        left: true
        right: true
    }
    implicitHeight: Theme.hugCornerSize
    color: "transparent"
    // On the screen's own edge, whatever else reserves space along it.
    exclusionMode: ExclusionMode.Ignore
    // Never takes the pointer.
    mask: Region {}

    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "qs-screen-corners"

    // The surface stays mapped and only its drawing hides, as the bar's does
    // when it auto-hides.
    Item {
        anchors.fill: parent
        opacity: root.shown ? 1 : 0
        visible: opacity > 0

        Behavior on opacity {
            NumberAnimation { duration: Theme.expandDuration }
        }

        HugCorner {
            x: 0
            y: root.atTop ? 0 : parent.height - height
            bottomCorner: !root.atTop
            fillColor: "#000000"
        }

        HugCorner {
            x: parent.width - width
            y: root.atTop ? 0 : parent.height - height
            rightCorner: true
            bottomCorner: !root.atTop
            fillColor: "#000000"
        }
    }
}
