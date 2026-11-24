import QtQuick
import "../Common"

// The card the composer, the working pill and the reply share. Opaque on
// purpose: the assistant's layer is not blurred (a full-output surface would
// pay for blurring every pixel), so glass here would only lower contrast
// over whatever window happens to be underneath.
//
// Corners (2026-11-24 review: one card mixed 16, 12, 10, 9, 7 and pill
// corners): the box takes the panels' corner, a block across its width (a
// field, a card, a row) the concentric `innerRadius`, something inset in
// such a block Theme.concentricRadius of that, and chips and buttons the
// chip corner.
Rectangle {
    id: root

    default property alias content: column.data
    property real padding: Theme.scaled(12)
    property alias spacing: column.spacing
    readonly property int innerRadius: Theme.concentricRadius(radius, padding)

    implicitHeight: column.implicitHeight + padding * 2
    radius: Theme.panelRadius
    color: Theme.popBg
    border.width: 1
    border.color: Theme.popBorder

    Column {
        id: column
        x: root.padding
        y: root.padding
        width: root.width - root.padding * 2
        spacing: Theme.scaled(10)
    }
}
