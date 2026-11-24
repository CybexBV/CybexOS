import QtQuick
import "../Common"

// The installer's keyboard focus ring: 2 px of accent, 4 px outside. It
// shows only while the keyboard drives the guide (Common/FocusModality,
// reported by WelcomeWindow's FocusModalityObserver), so a click leaves no
// ring behind; the first Tab after it shows where focus went.
Rectangle {
    property real gap: 4
    property real baseRadius: 0
    anchors.fill: parent
    anchors.margins: -Kiosk.px(gap)
    radius: baseRadius + Kiosk.px(gap)
    color: "transparent"
    border.width: Math.max(1, Kiosk.px(2))
    border.color: Kiosk.accent
    opacity: FocusModality.keyboard ? 1 : 0
}
