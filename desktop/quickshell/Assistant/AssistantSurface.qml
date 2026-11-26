pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Shapes
import "../Common"

// The card the composer, the working pill, History and the reply share.
// Opaque on purpose: the assistant's layer is not blurred (a full-output
// surface would pay for blurring every pixel), so glass here would only
// lower contrast over whatever window happens to be underneath.
//
// Depth without blur (2026-11-26 redesign): the card is a step lighter at
// its top than at its foot, its top edge catches a 1 px sheen, and a soft
// shadow of a few stacked translucent corners sits under it, none of which
// the compositor has to blur. A tail points at Wiz from the edge nearest
// him (`tailX`, `tailSide`, set by AssistantWindow), and his light falls on
// the card around it in the colour of his mood (`glow`): the accent, amber
// while he waits on the person, red after a failure.
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
    // The card's own colour; a card raised inside the box takes the menus'.
    property color fill: Theme.popBg
    // Where the tail leaves the card, in its own coordinates, and from which
    // edge: "top" with Wiz above, "bottom" with him below, "" for none.
    property real tailX: width / 2
    property string tailSide: ""
    // Wiz's light around the tail; transparent draws none.
    property color glow: "transparent"
    property bool shadow: true

    readonly property real tailWidth: Theme.scaled(18)
    readonly property real tailHeight: Theme.scaled(8)
    readonly property real tailCenter: Math.max(radius + tailWidth / 2 + 2,
        Math.min(width - radius - tailWidth / 2 - 2, tailX))
    readonly property real glowStrength: Theme.dark ? 0.16 : 0.14
    readonly property color topFill: Qt.tint(fill, Theme.dark ? Qt.rgba(1, 1, 1, 0.04) : Qt.rgba(1, 1, 1, 0.7))
    // The card under the glow where the tail joins it, so the two read as one.
    readonly property color tailFill: Qt.tint(tailSide === "bottom" ? fill : topFill,
        Qt.rgba(glow.r, glow.g, glow.b, glow.a * glowStrength))
    readonly property color shadowInk: Theme.dark ? Qt.rgba(0, 0, 0, 1) : Qt.rgba(0.08, 0.12, 0.3, 1)

    implicitHeight: column.implicitHeight + padding * 2
    radius: Theme.panelRadius
    color: fill
    gradient: Gradient {
        GradientStop { position: 0; color: root.topFill }
        GradientStop { position: Math.min(1, Theme.scaled(140) / Math.max(1, root.height)); color: root.fill }
    }
    border.width: 1
    border.color: Theme.popBorder

    // The shadow: wider, fainter corners further down, under the card.
    Repeater {
        model: root.shadow ? [{ spread: 1, drop: 1, alpha: 0.16 }, { spread: 3, drop: 3, alpha: 0.09 },
            { spread: 7, drop: 7, alpha: 0.055 }, { spread: 12, drop: 12, alpha: 0.035 },
            { spread: 19, drop: 18, alpha: 0.02 }] : []

        delegate: Rectangle {
            id: shade
            required property var modelData
            readonly property real spread: Theme.scaled(shade.modelData.spread)
            z: -1
            x: -shade.spread
            y: -shade.spread + Theme.scaled(shade.modelData.drop)
            width: root.width + shade.spread * 2
            height: root.height + shade.spread * 2
            radius: root.radius + shade.spread
            color: Qt.rgba(root.shadowInk.r, root.shadowInk.g, root.shadowInk.b,
                shade.modelData.alpha * (Theme.dark ? 1 : 0.55))
        }
    }

    // Wiz's light, drawn in the card's own shape so none of it spills past
    // the corners.
    Shape {
        anchors.fill: parent
        visible: root.tailSide !== "" && root.glow.a > 0
        preferredRendererType: Shape.CurveRenderer

        ShapePath {
            strokeWidth: -1
            strokeColor: "transparent"
            fillGradient: RadialGradient {
                centerX: root.tailCenter
                centerY: root.tailSide === "bottom" ? root.height : 0
                centerRadius: Theme.scaled(200)
                focalX: centerX
                focalY: centerY
                GradientStop {
                    position: 0
                    color: Qt.rgba(root.glow.r, root.glow.g, root.glow.b, root.glow.a * root.glowStrength)
                }
                GradientStop { position: 1; color: Qt.rgba(root.glow.r, root.glow.g, root.glow.b, 0) }
            }
            startX: root.radius
            startY: 0
            PathLine { x: root.width - root.radius; y: 0 }
            PathArc { x: root.width; y: root.radius; radiusX: root.radius; radiusY: root.radius }
            PathLine { x: root.width; y: root.height - root.radius }
            PathArc { x: root.width - root.radius; y: root.height; radiusX: root.radius; radiusY: root.radius }
            PathLine { x: root.radius; y: root.height }
            PathArc { x: 0; y: root.height - root.radius; radiusX: root.radius; radiusY: root.radius }
            PathLine { x: 0; y: root.radius }
            PathArc { x: root.radius; y: 0; radiusX: root.radius; radiusY: root.radius }
        }
    }

    // The sheen along the top edge, fading out before the corners.
    Rectangle {
        x: root.radius
        y: 1
        width: Math.max(0, root.width - root.radius * 2)
        height: 1
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.5; color: Theme.dark ? Qt.rgba(1, 1, 1, 0.07) : Qt.rgba(1, 1, 1, 0.9) }
            GradientStop { position: 1; color: "transparent" }
        }
    }

    // The tail. It overlaps the card by a pixel, so its base hides the
    // card's own border there; only its two sloping sides are outlined.
    Shape {
        id: tail
        readonly property bool down: root.tailSide === "bottom"
        visible: root.tailSide !== ""
        x: root.tailCenter - root.tailWidth / 2
        y: down ? root.height - 1 : -root.tailHeight + 1
        width: root.tailWidth
        height: root.tailHeight
        preferredRendererType: Shape.CurveRenderer

        ShapePath {
            fillColor: root.tailFill
            strokeColor: Theme.popBorder
            strokeWidth: 1
            joinStyle: ShapePath.RoundJoin
            startX: 0
            startY: tail.down ? 0 : root.tailHeight
            PathLine { x: root.tailWidth / 2 - Theme.scaled(2); y: tail.down ? root.tailHeight - Theme.scaled(1.5) : Theme.scaled(1.5) }
            PathQuad {
                x: root.tailWidth / 2 + Theme.scaled(2)
                y: tail.down ? root.tailHeight - Theme.scaled(1.5) : Theme.scaled(1.5)
                controlX: root.tailWidth / 2
                controlY: tail.down ? root.tailHeight : 0
            }
            PathLine { x: root.tailWidth; y: tail.down ? 0 : root.tailHeight }
        }
    }

    Column {
        id: column
        x: root.padding
        y: root.padding
        width: root.width - root.padding * 2
        spacing: Theme.scaled(10)
    }
}
