pragma ComponentBehavior: Bound
import QtQuick
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// Who answers and how hard they think (docs/assistant.md), opened by the
// agent's logo in the box's field: the agent, its model and its effort, each
// a row of segments so the card stays short in a cramped box, and, for
// Codex, Fast. Every choice holds for this conversation only, as the
// agent chip's menu did before it; Settings keeps the defaults. A
// conversation keeps the agent it started with. A raised card in the box's
// own flow, so the box's input region always covers it, its tail on the
// button that opened it (the host sets tailX and tailSide).
AssistantSurface {
    id: root

    // The box continues a conversation, whose agent is fixed.
    property bool continuing: false
    signal closeRequested()

    readonly property string agent: Assistant.askAgent
    readonly property var effortChoices: AssistantHelpers.effortChoices(agent) || []
    readonly property int trackRadius: Theme.concentricRadius(radius, padding)
    readonly property int segmentRadius: Theme.concentricRadius(trackRadius, Theme.scaled(2))

    objectName: "assistantModelPicker"
    fill: Theme.menuBg
    padding: Theme.scaled(8)
    spacing: Theme.scaled(4)

    function chooseAgent(id) {
        const status = Assistant.agents[id] || {};
        if (status.auth !== "ready") {
            root.closeRequested();
            Assistant.signIn(id);
            return;
        }
        Assistant.agentOverride = id === Assistant.agent ? "" : id;
        Assistant.modelOverride = "";
        Assistant.effortOverride = "";
        Assistant.fastOverride = -1;
    }

    // ---- the agent --------------------------------------------------------------------
    Track {
        id: agents
        width: parent.width
        height: Theme.scaled(34)
        radius: root.trackRadius

        Repeater {
            model: AssistantHelpers.AGENT_IDS

            delegate: Segment {
                required property string modelData
                readonly property var status: Assistant.agents[modelData] || {}
                readonly property string name: AssistantHelpers.AGENT_LABELS[modelData] || modelData
                objectName: "assistantAgent_" + modelData
                width: agents.segmentWidth(AssistantHelpers.AGENT_IDS.length)
                radius: root.segmentRadius
                brand: AssistantHelpers.AGENT_ICONS[modelData] || ""
                // The logo says whose; the words say what is missing.
                label: status.available !== true ? I18n.tr("Not installed")
                    : status.auth !== "ready" ? I18n.tr("Sign in…") : name
                accessibleName: label === name ? name : name + ", " + label
                checked: root.agent === modelData
                enabled: status.available === true && (!root.continuing || root.agent === modelData)
                onChosen: root.chooseAgent(modelData)
            }
        }
    }

    // Why the other agent is out of reach, when it is installed.
    Text {
        width: parent.width
        visible: root.continuing && AssistantHelpers.AGENT_IDS.some(id => id !== root.agent
            && Assistant.agents[id] && Assistant.agents[id].available === true)
        leftPadding: Theme.scaled(6)
        topPadding: Theme.scaled(2)
        text: I18n.format("Started with %1", [Assistant.askAgentLabel])
        elide: Text.ElideRight
        color: Theme.textFaint
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.metadata
    }

    // ---- the model --------------------------------------------------------------------
    Heading {
        text: I18n.tr("Model").toUpperCase()
    }

    Track {
        id: models
        readonly property var choices: AssistantHelpers.modelChoices(root.agent)
        width: parent.width
        height: Theme.scaled(30)
        radius: root.trackRadius

        Repeater {
            model: models.choices

            delegate: Segment {
                required property var modelData
                objectName: "assistantModel_" + modelData.value
                width: models.segmentWidth(models.choices.length)
                radius: root.segmentRadius
                label: modelData.value === "default" ? I18n.tr("Default") : modelData.label
                accessibleName: modelData.value === "default"
                    ? I18n.tr("Default") + ", " + I18n.format("%1's own", [Assistant.askAgentLabel]) : modelData.label
                checked: (Assistant.askModel === "" ? "default" : Assistant.askModel) === modelData.value
                onChosen: Assistant.modelOverride = modelData.value
            }
        }
    }

    // ---- the effort -------------------------------------------------------------------
    Heading {
        visible: root.effortChoices.length > 0
        text: I18n.tr("Effort").toUpperCase()
    }

    Track {
        id: efforts
        width: parent.width
        height: Theme.scaled(30)
        radius: root.trackRadius
        visible: root.effortChoices.length > 0

        Repeater {
            model: root.effortChoices

            delegate: Segment {
                required property var modelData
                objectName: "assistantEffort_" + modelData.value
                width: efforts.segmentWidth(root.effortChoices.length)
                radius: root.segmentRadius
                label: Assistant.effortLabel(modelData.value, true)
                accessibleName: I18n.format("%1 effort", [Assistant.effortLabel(modelData.value, false)])
                checked: (Assistant.askEffort === "" ? "default" : Assistant.askEffort) === modelData.value
                onChosen: Assistant.effortOverride = modelData.value
            }
        }
    }

    // ---- Fast, Codex only -------------------------------------------------------------
    Rectangle {
        width: parent.width
        visible: root.agent === "codex" && Assistant.fastAvailable
        height: visible ? Math.max(fastWords.implicitHeight, fastToggle.height) + Theme.scaled(10) : 0
        radius: Theme.concentricRadius(root.radius, root.padding)
        color: Theme.chip

        Sym {
            id: bolt
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(10)
            anchors.verticalCenter: parent.verticalCenter
            name: "bolt"
            size: Theme.iconMedium
            color: Theme.accentText
        }

        Column {
            id: fastWords
            anchors.left: bolt.right
            anchors.leftMargin: Theme.scaled(9)
            anchors.right: fastToggle.left
            anchors.rightMargin: Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter

            Text {
                width: parent.width
                text: I18n.tr("Fast")
                color: Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
                font.weight: Theme.weightSemibold
            }

            Text {
                width: parent.width
                text: I18n.tr("Quicker answers; uses your plan's limits faster")
                wrapMode: Text.WordWrap
                color: Theme.textLow
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
            }
        }

        Toggle {
            id: fastToggle
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(4)
            anchors.verticalCenter: parent.verticalCenter
            metrics: Theme.switchPopover
            checked: Assistant.askFast
            accessibleName: I18n.tr("Fast")
            onToggled: value => Assistant.fastOverride = value ? 1 : 0
        }
    }

    Text {
        width: parent.width
        leftPadding: Theme.scaled(6)
        rightPadding: Theme.scaled(6)
        topPadding: Theme.scaled(2)
        bottomPadding: Theme.scaled(2)
        text: I18n.tr("Only for this conversation. Your default stays in Settings.")
        wrapMode: Text.WordWrap
        color: Theme.textFaint
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.metadata
    }

    // A section's name over its choices, as History names its groups.
    component Heading: Text {
        leftPadding: Theme.scaled(6)
        topPadding: Theme.scaled(4)
        color: Theme.textFaint
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.metadata
        font.weight: Theme.weightSemibold
        font.letterSpacing: 0.6
    }

    // A recessed track of equal segments; the chosen one stands up out of it.
    component Track: Rectangle {
        id: track
        default property alias segments: row.data
        readonly property real inset: Theme.scaled(2)

        function segmentWidth(count) {
            return Math.max(0, (track.width - track.inset * 2 - row.spacing * (count - 1)) / Math.max(1, count));
        }

        color: Theme.well
        border.width: 1
        border.color: Theme.hairline

        Row {
            id: row
            x: track.inset
            y: track.inset
            height: track.height - track.inset * 2
            spacing: Theme.scaled(2)
        }
    }

    component Segment: Rectangle {
        id: segment
        property string label: ""
        property string brand: ""
        property string accessibleName: label
        property bool checked: false
        signal chosen()

        // A chosen segment stands up out of its track.
        property color raisedFill: Theme.dark ? Qt.tint(Theme.menuBg, Qt.rgba(1, 1, 1, 0.09)) : "#ffffff"

        height: parent ? parent.height : 0
        color: checked ? raisedFill : "transparent"
        border.width: Theme.focusWidth(activeFocus)
        border.color: Theme.focusRing
        opacity: enabled ? 1 : 0.5
        activeFocusOnTab: enabled && visible
        Accessible.role: Accessible.RadioButton
        Accessible.name: segment.accessibleName
        Accessible.checked: segment.checked
        Accessible.onPressAction: {
            if (segment.enabled)
                segment.chosen();
        }

        Keys.onPressed: event => {
            if (segment.enabled && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                    || event.key === Qt.Key_Space)) {
                segment.chosen();
                event.accepted = true;
            }
        }

        Row {
            anchors.centerIn: parent
            width: Math.min(implicitWidth, segment.width - Theme.scaled(8))
            spacing: Theme.scaled(6)

            BrandIcon {
                id: mark
                anchors.verticalCenter: parent.verticalCenter
                visible: segment.brand !== ""
                width: Theme.iconMedium
                height: Theme.iconMedium
                name: segment.brand
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(implicitWidth, segment.width - Theme.scaled(8)
                    - (mark.visible ? mark.width + parent.spacing : 0))
                text: segment.label
                elide: Text.ElideRight
                color: segment.checked || segmentMouse.containsMouse ? Theme.textHi : Theme.textMid
                font.family: Theme.fontMenu
                font.pixelSize: segment.brand !== "" ? Theme.typography.secondary : Theme.typography.metadata
                font.weight: segment.checked ? Theme.weightSemibold : Theme.weightMedium
            }
        }

        MouseArea {
            id: segmentMouse
            anchors.fill: parent
            hoverEnabled: true
            enabled: segment.enabled
            cursorShape: Qt.PointingHandCursor
            onClicked: segment.chosen()
        }
    }
}
