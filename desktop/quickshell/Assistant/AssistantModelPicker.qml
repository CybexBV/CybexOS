pragma ComponentBehavior: Bound
import QtQuick
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// Who answers and how hard they think (docs/assistant.md), opened by the
// agent's logo in the box's field: a small popup (the 2026-11-26 mockup,
// rebuilt to it on 2026-11-27) with the agent, its models as a ticked list,
// its effort as a row of segments and, for Codex, Fast. Every choice holds
// for this conversation only, as the agent chip's menu did before it;
// Settings keeps the defaults. A conversation keeps the agent it started
// with. The host floats it over its own content next to the logo, its tail
// on the logo (tailX, tailSide), and keeps the box tall enough to hold it,
// so the box's input region always covers it. In a box with little room
// (`maximumHeight`) the note gives way first, then the model list scrolls;
// the agent, effort and Fast always show.
AssistantSurface {
    id: root

    // The box continues a conversation, whose agent is fixed.
    property bool continuing: false
    property real maximumHeight: Theme.scaled(480)
    signal closeRequested()

    readonly property string agent: Assistant.askAgent
    readonly property var effortChoices: AssistantHelpers.effortChoices(agent) || []
    readonly property int trackRadius: Theme.concentricRadius(radius, padding)
    readonly property int segmentRadius: Theme.concentricRadius(trackRadius, Theme.scaled(2))
    // Everything but the model list and the note, which give way in a short box.
    readonly property real fixedHeight: agents.height + (startedWith.visible ? startedWith.implicitHeight : 0)
        + modelHeading.implicitHeight + (effortHeading.visible ? effortHeading.implicitHeight : 0)
        + (efforts.visible ? efforts.height : 0) + fast.height
    // Its height with nothing given way, for hosts deciding where it fits.
    readonly property real naturalHeight: fixedHeight + modelList.implicitHeight + note.implicitHeight + padding * 2
    readonly property bool cramped: naturalHeight > maximumHeight

    objectName: "assistantModelPicker"
    fill: Theme.menuBg
    padding: Theme.scaled(8)
    spacing: 0
    z: 10

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

    // Clicks between the choices stay in the popup, not on the answer under it.
    MouseArea {
        parent: root
        width: root.width
        height: root.height
        z: -1
        onClicked: {}
        onWheel: wheel => wheel.accepted = true
    }

    Item {
        width: parent.width
        height: choices.implicitHeight

        Column {
            id: choices
            width: parent.width

            // ---- the agent ----------------------------------------------------------------
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
                id: startedWith
                width: parent.width
                visible: root.continuing && AssistantHelpers.AGENT_IDS.some(id => id !== root.agent
                    && Assistant.agents[id] && Assistant.agents[id].available === true)
                leftPadding: Theme.scaled(4)
                topPadding: Theme.scaled(6)
                text: I18n.format("Started with %1", [Assistant.askAgentLabel])
                elide: Text.ElideRight
                color: Theme.textLow
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
            }

            // ---- the model ------------------------------------------------------------------
            Heading {
                id: modelHeading
                text: I18n.tr("Model")
            }

            Flickable {
                id: modelList
                implicitHeight: modelRows.implicitHeight
                width: parent.width
                height: !root.cramped ? implicitHeight : Math.min(implicitHeight, Math.max(Theme.scaled(60),
                    root.maximumHeight - root.padding * 2 - root.fixedHeight))
                contentWidth: width
                contentHeight: modelRows.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                interactive: contentHeight > height

                Column {
                    id: modelRows
                    width: modelList.width

                    Repeater {
                        model: AssistantHelpers.modelChoices(root.agent)

                        delegate: Choice {
                            required property var modelData
                            objectName: "assistantModel_" + modelData.value
                            width: modelRows.width
                            radius: root.trackRadius
                            label: modelData.value === "default" ? I18n.tr("Default") : modelData.label
                            // The default is the agent's own choice; the others need no gloss.
                            detail: modelData.value === "default" ? I18n.format("%1's own", [Assistant.askAgentLabel]) : ""
                            checked: (Assistant.askModel === "" ? "default" : Assistant.askModel) === modelData.value
                            onChosen: Assistant.modelOverride = modelData.value
                        }
                    }
                }

                // More models below the cut, in a short box.
                Rectangle {
                    parent: modelList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: Theme.scaled(18)
                    visible: modelList.contentY + modelList.height < modelList.contentHeight - 1
                    gradient: Gradient {
                        GradientStop { position: 0; color: Qt.rgba(Theme.menuBg.r, Theme.menuBg.g, Theme.menuBg.b, 0) }
                        GradientStop { position: 1; color: Theme.menuBg }
                    }
                }
            }

            // ---- the effort -----------------------------------------------------------------
            Heading {
                id: effortHeading
                visible: root.effortChoices.length > 0
                text: I18n.tr("Effort")
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

            // ---- Fast, Codex only -----------------------------------------------------------
            Item {
                id: fast
                width: parent.width
                visible: root.agent === "codex" && Assistant.fastAvailable
                height: visible ? fastRow.height + Theme.scaled(8) : 0

                Rectangle {
                    id: fastRow
                    y: Theme.scaled(8)
                    width: parent.width
                    height: Math.max(fastWords.implicitHeight, fastToggle.height) + Theme.scaled(18)
                    radius: root.trackRadius
                    color: Theme.chip
                    border.width: 1
                    border.color: Theme.hairline

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
                        anchors.leftMargin: Theme.scaled(10)
                        anchors.right: fastToggle.left
                        anchors.rightMargin: Theme.scaled(8)
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
                        anchors.rightMargin: Theme.scaled(10)
                        anchors.verticalCenter: parent.verticalCenter
                        metrics: Theme.switchPopover
                        checked: Assistant.askFast
                        accessibleName: I18n.tr("Fast")
                        onToggled: value => Assistant.fastOverride = value ? 1 : 0
                    }
                }
            }

            Text {
                id: note
                width: parent.width
                visible: !root.cramped
                leftPadding: Theme.scaled(4)
                rightPadding: Theme.scaled(4)
                topPadding: Theme.scaled(7)
                bottomPadding: Theme.scaled(1)
                text: I18n.tr("Only for this conversation. Your default stays in Settings.")
                wrapMode: Text.WordWrap
                color: Theme.textLow
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
            }
        }
    }

    // A section's name over its choices, in sentence case.
    component Heading: Text {
        leftPadding: Theme.scaled(4)
        topPadding: Theme.scaled(8)
        bottomPadding: Theme.scaled(3)
        color: Theme.textFaint
        font.family: Theme.fontMenu
        font.pixelSize: Theme.typography.metadata
        font.weight: Theme.weightSemibold
    }

    // One model: its name, a word on it, and a tick when it is the one.
    component Choice: Rectangle {
        id: choice
        property string label: ""
        property string detail: ""
        property bool checked: false
        signal chosen()

        height: Theme.scaled(30)
        color: choice.checked ? Theme.selectedFill
            : choiceMouse.containsMouse ? Theme.chipHover : "transparent"
        border.width: Theme.focusWidth(activeFocus)
        border.color: Theme.focusRing
        activeFocusOnTab: visible
        Accessible.role: Accessible.RadioButton
        Accessible.name: choice.detail === "" ? choice.label : choice.label + ", " + choice.detail
        Accessible.checked: choice.checked
        Accessible.onPressAction: choice.chosen()

        Keys.onPressed: event => {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
                choice.chosen();
                event.accepted = true;
            }
        }

        Row {
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(10)
            anchors.right: tick.left
            anchors.rightMargin: Theme.scaled(8)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.scaled(8)

            Text {
                id: choiceName
                anchors.verticalCenter: parent.verticalCenter
                text: choice.label
                color: Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
                font.weight: Theme.weightMedium
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(0, parent.width - choiceName.width - parent.spacing)
                visible: choice.detail !== ""
                text: choice.detail
                elide: Text.ElideRight
                color: Theme.textLow
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
            }
        }

        Sym {
            id: tick
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(8)
            anchors.verticalCenter: parent.verticalCenter
            name: "check"
            size: Theme.iconMedium
            color: Theme.accentText
            opacity: choice.checked ? 1 : 0
        }

        MouseArea {
            id: choiceMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: choice.chosen()
        }
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
        opacity: enabled ? 1 : 0.45
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
            width: Math.min(implicitWidth, segment.width - Theme.scaled(6))
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
                width: Math.min(implicitWidth, segment.width - Theme.scaled(6)
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
