import QtQuick
import "../Common"
import "../Common/SoftwareHelpers.js" as Helpers
import "../Common/TablerGlyphs.js" as Tabler

// One of the eight categories: its tinted glyph, name and what it holds, in
// up to two lines; every tile is as tall as two, so a row stays even.
Rectangle {
    id: root

    property var category: ({})
    readonly property color tint: Helpers.parseHex(category.color) ? category.color : Theme.accent

    FontMetrics {
        id: nameMetrics
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.primary
    }
    FontMetrics {
        id: summaryMetrics
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.metadata
    }

    implicitHeight: Math.max(Theme.scaled(62),
        Math.ceil(nameMetrics.height + summaryMetrics.height * 2) + Theme.scaled(1) + Theme.scaled(16))
    radius: Theme.chipRadius + 4
    color: Theme.cardFill
    // The keyboard ring replaces the resting hairline while it shows.
    border.width: Theme.focusWidth(activeFocus) || 1
    border.color: Theme.focusWidth(activeFocus) > 0 ? Theme.focusRing : Theme.hairlineSoft
    activeFocusOnTab: true
    Accessible.role: Accessible.Button
    Accessible.name: Software.label(category.name || "")
    Accessible.description: Software.label(category.summary || "")
    Accessible.onPressAction: Software.openCategory(category.id)
    Keys.onPressed: event => {
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
            Software.openCategory(root.category.id);
            event.accepted = true;
        }
    }

    StateLayer {
        anchors.fill: parent
        radius: parent.radius
        hovered: mouse.containsMouse
        pressed: mouse.pressed
        rippleEnabled: false
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: Software.openCategory(root.category.id)
    }
    Rectangle {
        id: badge
        x: Theme.scaled(14)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.scaled(36)
        height: width
        radius: Theme.chipRadius + 2
        color: Qt.rgba(root.tint.r, root.tint.g, root.tint.b, Theme.dark ? 0.16 : 0.18)
        Sym {
            anchors.centerIn: parent
            name: Helpers.glyph(root.category.icon, Tabler.has)
            size: Theme.iconLarge
            color: Theme.dark ? root.tint : Qt.darker(root.tint, 1.45)
        }
    }
    Column {
        anchors.left: badge.right
        anchors.leftMargin: Theme.scaled(12)
        anchors.right: parent.right
        anchors.rightMargin: Theme.scaled(10)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.scaled(1)
        Text {
            width: parent.width
            text: Software.label(root.category.name || "")
            color: Theme.textHi
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.primary
            font.weight: Theme.weightSemibold
            elide: Text.ElideRight
            textFormat: Text.PlainText
        }
        Text {
            width: parent.width
            text: Software.label(root.category.summary || "")
            color: Theme.textDim
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.metadata
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            textFormat: Text.PlainText
        }
    }
}
