import QtQuick

// A 24 px radio mark: an empty ring, or an accent ring around an accent dot.
// A dot, not a tick: a tick in a filled circle read as a checkbox, and the
// guide's choices here are single (2026-11-24 review). Ticks stay for lists
// where they confirm the chosen row. The empty ring keeps 3:1 against the
// card, as the switch's off track does.
Rectangle {
    property bool checked: false
    implicitWidth: Kiosk.px(24)
    implicitHeight: implicitWidth
    radius: width / 2
    color: "transparent"
    border.width: Math.max(1, Kiosk.px(checked ? 2 : 1.5))
    border.color: checked ? Kiosk.accent : Kiosk.faint
    Rectangle {
        anchors.centerIn: parent
        visible: parent.checked
        width: Math.round(parent.width * 0.5)
        height: width
        radius: width / 2
        color: Kiosk.accent
    }
}
