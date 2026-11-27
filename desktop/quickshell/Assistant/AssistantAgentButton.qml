import QtQuick
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// The answering agent's logo in the box's field (the reply's and the
// composer's): who answers the next question, and the way to change that,
// its model and its effort (AssistantModelPicker). Codex's Fast, when on,
// wears a small bolt on the logo. Its name says all of it: "Codex · Terra ·
// High effort · Fast".
AssistantButton {
    id: root

    // The picker it opens is open.
    property bool open: false

    objectName: "assistantModelButton"
    brand: AssistantHelpers.AGENT_ICONS[Assistant.askAgent] || ""
    glyph: brand === "" ? "smart_toy" : ""
    accessibleName: I18n.format("%1. Change the agent, model or effort.", [Assistant.askSummary])
    // The open picker shows all of it; the name would sit on top of it.
    tip: open ? "" : Assistant.askSummary
    color: open ? Theme.chipHover : "transparent"

    Rectangle {
        visible: Assistant.askFast
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        width: Theme.scaled(14)
        height: width
        radius: width / 2
        color: Theme.accent
        border.width: Theme.scaled(2)
        border.color: Theme.well

        Sym {
            anchors.centerIn: parent
            name: "bolt"
            size: Theme.scaled(9)
            color: Theme.accentFg
        }
    }
}
