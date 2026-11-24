import QtQuick
import "../Common"
import "../Software" as SoftwareUi

// An updated, added or removed application with its own name and icon.
Rectangle {
    id: root

    property var app: ({})

    implicitHeight: Theme.scaled(48)
    radius: Theme.chipRadius + 3
    color: Theme.cardFill
    border.width: 1
    border.color: Theme.hairlineSoft

    // Software's icon: the catalogue's own, else the theme's only when it
    // really has one, else the app's monogram. A themed lookup with a
    // fallback name drew Qt's magenta missing-image box where neither
    // existed (2026-11-24 review).
    SoftwareUi.AppIcon {
        id: icon
        anchors.left: parent.left
        anchors.leftMargin: Theme.scaled(10)
        anchors.verticalCenter: parent.verticalCenter
        size: Theme.scaled(28)
        app: Software.appsByAttribute[root.app.name || ""] || null
        icon: (root.app.icon || "").replace(/^file:\/\//, "")
        name: root.app.title || root.app.name || ""
    }

    Text {
        anchors.left: icon.right
        anchors.leftMargin: Theme.scaled(10)
        anchors.right: versions.left
        anchors.rightMargin: Theme.scaled(8)
        anchors.verticalCenter: parent.verticalCenter
        text: root.app.title || root.app.name || ""
        color: Theme.textHi
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.primary
        font.weight: Theme.weightSemibold
        elide: Text.ElideRight
        textFormat: Text.PlainText
    }

    VersionPair {
        id: versions
        anchors.right: parent.right
        anchors.rightMargin: Theme.scaled(10)
        anchors.verticalCenter: parent.verticalCenter
        compact: true
        before: root.app.before
        after: root.app.after
        kind: root.app.kind || "updated"
    }
}
