import QtQuick
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// A failed answer as a soft red block (the 2026-11-26 mockup): a heading
// that says whose answer failed, the agent's own message under it, and the
// one fix when there is one (Sign in, Assistant settings, Start the
// assistant). The reply and the conversation on screen both show it.
Rectangle {
    id: root

    // The failed turn: its error, its errorKind and, for the reply's, its agent.
    property var answer: null
    // A conversation's turns leave their agent to the conversation.
    property string agent: answer ? answer.agent || "" : ""
    // Only the latest failure offers its fix; an older one is history.
    property bool offersFix: true
    readonly property string kind: answer ? answer.errorKind || "" : ""
    readonly property var fixAction: offersFix && answer ? AssistantHelpers.errorAction(kind, agent) : null

    implicitHeight: failureColumn.implicitHeight + Theme.scaled(22)
    color: Theme.redBgSoft
    border.width: 1
    border.color: Qt.rgba(Theme.red.r, Theme.red.g, Theme.red.b, 0.3)

    Sym {
        id: failureGlyph
        x: Theme.scaled(11)
        y: Theme.scaled(12)
        name: "error"
        size: Theme.iconMedium
        color: Theme.redText
    }

    Column {
        id: failureColumn
        anchors.left: failureGlyph.right
        anchors.leftMargin: Theme.scaled(9)
        anchors.right: parent.right
        anchors.rightMargin: Theme.scaled(11)
        y: Theme.scaled(11)
        spacing: Theme.scaled(2)

        Text {
            width: parent.width
            text: Assistant.failureTitle(root.kind, root.agent)
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: Theme.textHi
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.secondary
            font.weight: Theme.weightSemibold
        }

        Text {
            width: parent.width
            text: root.answer ? root.answer.error || I18n.tr("Something went wrong.") : ""
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: Theme.textMid
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.secondary
        }

        Item {
            width: parent.width
            visible: root.fixAction !== null
            height: visible ? fixButton.height + Theme.scaled(9) : 0

            AssistantButton {
                id: fixButton
                y: Theme.scaled(9)
                label: !root.fixAction ? ""
                    : root.kind === "auth" ? I18n.tr("Sign in")
                    : root.kind === "missing" ? I18n.tr("Assistant settings")
                    : I18n.tr("Start the assistant")
                primary: true
                onTriggered: Assistant.fix(root.kind, root.agent)
            }
        }
    }
}
