import QtQuick
import "../Common"

// The one explanatory line in the settings workspace. A row's description, a
// live status, a disabled row's reason and a group's footnote all read the
// same: secondary type, aligned with the row labels, in the ink its `tone`
// names. A warning or an error also hangs a glyph in the modified-mark
// gutter, so a problem is not told apart from ordinary copy by colour alone
// and the copy itself never shifts off the label lane.
Item {
    id: root

    property string text: ""
    // A technical reason after the sentence (a parser's message, a tool's
    // stderr): behind a "Details" disclosure, smaller, plain and
    // untranslated, so the sentence stays the message and the raw text is
    // still there for whoever needs it (2026-11-24 review).
    property string detail: ""
    property bool detailOpen: false
    onDetailChanged: detailOpen = false
    // info | active | warning | error
    property string tone: "info"
    // Rows and groups align copy with their labels; a hint placed inside an
    // already-inset lane passes false.
    property bool inset: true
    property int maximumLines: 3

    readonly property bool flagged: tone === "warning" || tone === "error"
    readonly property color ink: tone === "error" ? Theme.redText
        : tone === "warning" ? Theme.amber
        : tone === "active" ? Theme.accentText
        : Theme.textFaint
    readonly property int textX: root.inset ? Theme.settingsMarkInset
        : root.flagged ? glyph.width + Theme.iconTextSpacing : 0

    visible: text !== ""
    implicitHeight: visible ? body.implicitHeight + (detail === "" ? 0
        : Theme.iconTextSpacing + detailToggle.height
            + (detailOpen ? Theme.iconTextSpacing + detailText.implicitHeight : 0)) : 0
    height: implicitHeight
    Accessible.role: flagged ? Accessible.AlertMessage : Accessible.StaticText
    Accessible.name: text

    Sym {
        id: glyph
        visible: root.flagged
        x: root.inset ? Math.max(0, (Theme.settingsMarkInset - width) / 2 - 2) : 0
        y: Math.max(0, (body.lineHeightPx - height) / 2)
        name: root.tone === "error" ? "error" : "warning"
        size: Theme.iconSmall
        color: root.ink
    }

    Text {
        id: body
        // First-line height, so the gutter glyph centres on the first line
        // rather than on a wrapped paragraph.
        readonly property real lineHeightPx: lineCount > 0 ? implicitHeight / lineCount : implicitHeight
        x: root.textX
        width: Math.max(0, root.width - x)
        text: root.text
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.secondary
        color: root.ink
        wrapMode: Text.Wrap
        maximumLineCount: root.maximumLines
        elide: Text.ElideRight
    }

    Rectangle {
        id: detailToggle
        visible: root.detail !== ""
        x: root.textX - Theme.scaled(4)
        y: body.implicitHeight + Theme.iconTextSpacing
        width: toggleRow.implicitWidth + Theme.scaled(10)
        height: Math.max(Theme.scaled(22), toggleRow.implicitHeight + Theme.scaled(4))
        radius: Theme.chipRadius
        color: "transparent"
        border.width: Theme.focusWidth(activeFocus)
        border.color: Theme.focusRing
        activeFocusOnTab: visible
        Accessible.role: Accessible.Button
        Accessible.name: root.detailOpen ? I18n.tr("Hide details") : I18n.tr("Show details")
        Accessible.onPressAction: root.detailOpen = !root.detailOpen
        Keys.onPressed: event => {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
                root.detailOpen = !root.detailOpen;
                event.accepted = true;
            }
        }

        StateLayer {
            anchors.fill: parent
            radius: parent.radius
            hovered: toggleMouse.containsMouse
            pressed: toggleMouse.pressed
            tint: Theme.textHi
            pressPoint: Qt.point(toggleMouse.mouseX, toggleMouse.mouseY)
        }
        Row {
            id: toggleRow
            anchors.centerIn: parent
            spacing: Theme.scaled(3)
            Sym {
                anchors.verticalCenter: parent.verticalCenter
                name: "chevron_right"
                size: Theme.iconSmall
                color: Theme.textMid
                rotation: root.detailOpen ? 90 : 0
                Behavior on rotation { NumberAnimation { duration: Theme.chipFadeDuration } }
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: I18n.tr("Details")
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
                font.weight: Theme.weightMedium
                color: Theme.textMid
            }
        }
        MouseArea {
            id: toggleMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                detailToggle.forceActiveFocus();
                root.detailOpen = !root.detailOpen;
            }
        }
    }

    // The tool's own words, whole, in the mono face.
    Text {
        id: detailText
        visible: root.detail !== "" && root.detailOpen
        x: root.textX
        y: detailToggle.y + detailToggle.height + Theme.iconTextSpacing
        width: Math.max(0, root.width - x)
        text: root.detail
        textFormat: Text.PlainText
        font.family: Theme.fontMono
        font.pixelSize: Theme.typography.metadata
        color: Theme.textFaint
        wrapMode: Text.WrapAnywhere
    }
}
