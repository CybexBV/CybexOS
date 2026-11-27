pragma ComponentBehavior: Bound
import QtQuick
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// The answer, under the question it answers (2026-11-26 redesign,
// docs/assistant.md). It stays until closed. The question keeps its own
// bubble on the right, whole up to three lines; the answer leads with its
// first sentence (AssistantMarkdown `lead`). What the turn left behind
// follows it in raised blocks: a failure and its one fix, a staged system
// change to review and apply, a routine it created, what it changed, each
// with its own Undo (AssistantChanges), and a new widget to add to the bar.
// Answer and blocks scroll together within `room`, the height the box may
// use on this side of the character, their cut edge fading with More to
// read on. Quiet actions follow, then a field to answer
// in right here: Enter continues this conversation without the composer, and
// the agent's logo there picks who answers and how (AssistantModelPicker),
// in a popup over the answer, as in the mockup.
AssistantSurface {
    id: root

    property real room: 400
    property bool pickerOpen: false
    readonly property var turn: Assistant.turn
    readonly property string turnId: turn ? turn.id || "" : ""
    readonly property bool failed: turn !== null && turn.status === "failed"
    readonly property string answerText: turn ? turn.text || "" : ""
    readonly property string prompt: turn ? turn.prompt || "" : ""
    readonly property var plugins: turn && turn.plugins ? turn.plugins : []
    readonly property var changes: turn && turn.changes ? turn.changes.filter(change => change.kind !== "system") : []
    readonly property var routinesMade: turn && turn.routines ? turn.routines : []
    // The answer is longer than the box shows: its edge fades and More reads on.
    readonly property bool overflowing: bodyFlick.contentHeight > bodyFlick.height + 1
    readonly property bool atEnd: bodyFlick.contentY + bodyFlick.height >= bodyFlick.contentHeight - 1
    // The build this turn staged, while the updater still holds it.
    readonly property bool staged: turn !== null && !!turn.staged
        && Updates.deployment.transaction === turn.staged
    readonly property string deploymentState: staged ? (Updates.deployment.state || "") : ""
    readonly property var closure: AssistantHelpers.closureChanges(
        staged ? Updates.deployment.changes || "" : "", 5)
    // What the quiet actions offer; the row reads these, not its buttons'
    // own visibility, which follows the row's.
    readonly property bool canSpeak: Assistant.speechAvailable && !failed && answerText !== ""
    readonly property bool canCopy: !failed && answerText !== ""
    readonly property bool canHandoff: turn !== null && turn.resumable === true
    readonly property bool hasExtras: failed || staged || routinesMade.length > 0 || changes.length > 0
        || plugins.length > 0 || Assistant.notice !== ""
    // Everything but the answer and its blocks, which take what is left of
    // the room, and never less than a few lines.
    readonly property real chromeHeight: padding * 2 + header.height
        + (question.visible ? question.height + spacing : 0)
        + (body.visible ? spacing : 0)
        + (actions.visible ? actions.height + spacing : 0)
        + (speechBar.visible ? speechBar.height + spacing : 0)
        + field.height + spacing
    // Everything above the field but the open picker's room, and where the
    // picker's top may reach: under the header, which keeps its Close, unless
    // the box's room is too short for that; then over the header too.
    readonly property real aboveField: header.height + spacing
        + (question.visible ? question.height + spacing : 0)
        + (body.visible ? body.height + spacing : 0)
        + (actions.visible ? actions.height + spacing : 0)
        + (speechBar.visible ? speechBar.height + spacing : 0)
    readonly property real pickerGap: Theme.scaled(8)
    readonly property real pickerTop: room - padding * 2 - header.height - spacing - pickerGap - field.height
        >= picker.naturalHeight ? header.height + spacing : 0
    // What a short answer lacks to hold the open picker above the field.
    readonly property real pickerRoom: pickerOpen ? Math.max(0, pickerTop + picker.height + pickerGap - aboveField) : 0

    onTurnIdChanged: bodyFlick.contentY = 0
    onVisibleChanged: {
        pickerOpen = false;
        if (visible)
            Assistant.followReply();
        else
            replyInput.text = "";
    }

    function sendReply() {
        const text = replyInput.text.trim();
        if (text === "")
            return;
        pickerOpen = false;
        // The field empties once the reply has gone (onVisibleChanged); a
        // question that could not go keeps its words here.
        Assistant.replyWith(text);
    }

    // Spoken, the reply goes through the composer, which listens.
    function talk() {
        pickerOpen = false;
        Assistant.draft = replyInput.text;
        Assistant.reply();
        Assistant.toggleMicrophone();
    }

    function togglePicker() {
        if (!AssistantHelpers.anyAgent(Assistant.agents)) {
            Settings.showPanel("assistant", Assistant.screenName);
            return;
        }
        Assistant.followReply();
        pickerOpen = !pickerOpen;
    }

    function readOn() {
        scroller.to = Math.min(bodyFlick.contentHeight - bodyFlick.height,
            bodyFlick.contentY + bodyFlick.height * 0.8);
        scroller.restart();
    }

    // ---- who answered ------------------------------------------------------------
    Item {
        id: header
        width: parent.width
        height: Theme.scaled(28)

        Row {
            anchors.left: parent.left
            anchors.right: close.left
            anchors.rightMargin: Theme.scaled(8)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.scaled(7)

            Text {
                id: who
                anchors.verticalCenter: parent.verticalCenter
                text: I18n.tr("Wiz")
                color: Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.control
                font.weight: Theme.weightSemibold
            }

            BrandIcon {
                id: agentMark
                anchors.verticalCenter: parent.verticalCenter
                visible: name !== ""
                width: Theme.iconSmall
                height: Theme.iconSmall
                name: root.turn ? AssistantHelpers.AGENT_ICONS[root.turn.agent] || "" : ""
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(0, parent.width - who.width - (agentMark.visible ? agentMark.width + parent.spacing : 0)
                    - parent.spacing)
                text: !root.turn ? ""
                    : (AssistantHelpers.AGENT_LABELS[root.turn.agent] || root.turn.agent || "")
                        + (root.turn.finishedAt > 0
                            ? " · " + AssistantHelpers.elapsedLabel(root.turn.finishedAt - root.turn.startedAt) : "")
                textFormat: Text.PlainText
                elide: Text.ElideRight
                color: Theme.textFaint
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
                font.features: Theme.tabularNumberFeatures
            }
        }

        AssistantButton {
            id: close
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            glyph: "close"
            accessibleName: I18n.tr("Close the reply")
            controlHeight: Theme.scaled(28)
            color: "transparent"
            onTriggered: Assistant.closeReply()
        }
    }

    // ---- the question --------------------------------------------------------------
    Item {
        id: question
        width: parent.width
        visible: root.prompt !== ""
        height: visible ? bubble.height : 0

        Rectangle {
            id: bubble
            anchors.right: parent.right
            width: questionText.width + Theme.scaled(22)
            height: questionText.height + Theme.scaled(14)
            radius: Theme.assistantPopupRadius
            bottomRightRadius: Theme.assistantPointRadius
            color: Theme.accentBgSoft
            border.width: 1
            border.color: Theme.accentAlpha(0.24)

            Text {
                id: questionText
                x: Theme.scaled(11)
                y: Theme.scaled(7)
                width: Math.min(implicitWidth, question.width * 0.86 - Theme.scaled(22))
                text: root.prompt
                textFormat: Text.PlainText
                wrapMode: Text.Wrap
                maximumLineCount: 3
                elide: Text.ElideRight
                color: Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
            }
        }
    }

    // ---- the answer ----------------------------------------------------------------
    Item {
        id: body
        width: parent.width
        visible: root.answerText !== "" || root.hasExtras
        height: visible ? bodyFlick.height : 0

        Flickable {
            id: bodyFlick
            width: parent.width
            height: Math.min(bodyColumn.implicitHeight,
                Math.max(Theme.scaled(72), root.room - root.chromeHeight))
            contentWidth: width
            contentHeight: bodyColumn.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
                id: bodyColumn
                width: bodyFlick.width
                spacing: root.spacing

                AssistantMarkdown {
                    id: answer
                    width: parent.width
                    visible: root.answerText !== ""
                    blockRadius: root.innerRadius
                    lead: true
                    text: root.answerText
                    color: Theme.textHi
                }

                // What the turn left behind, under the answer.
                Column {
                    id: extras
                    width: parent.width
                    visible: root.hasExtras
                    spacing: Theme.scaled(8)

                    // Why it failed, and its one fix.
                    AssistantFailure {
                        width: parent.width
                        visible: root.failed
                        height: visible ? implicitHeight : 0
                        radius: root.innerRadius
                        answer: root.turn
                    }

                    // A system change built and checked by the updater, waiting for review.
                    Rectangle {
                        width: parent.width
                        visible: root.staged
                        height: visible ? stagedColumn.implicitHeight + Theme.scaled(22) : 0
                        radius: root.innerRadius
                        color: Theme.cardFill
                        border.width: 1
                        border.color: Theme.hairline

                        Column {
                            id: stagedColumn
                            x: Theme.scaled(11)
                            y: Theme.scaled(11)
                            width: parent.width - Theme.scaled(22)
                            spacing: Theme.scaled(9)

                            Row {
                                width: parent.width
                                spacing: Theme.scaled(10)

                                Rectangle {
                                    id: stagedMark
                                    width: Theme.scaled(32)
                                    height: width
                                    radius: Theme.assistantRowRadius
                                    color: Theme.chip

                                    Sym {
                                        anchors.centerIn: parent
                                        name: "deployed_code_update"
                                        size: Theme.iconMedium
                                        color: Theme.accentText
                                    }
                                }

                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: parent.width - stagedMark.width - parent.spacing
                                    text: root.deploymentState === "ready" ? I18n.tr("Staged change · built and checked")
                                        : root.deploymentState === "done" || root.deploymentState === "awaiting-boot"
                                            || root.deploymentState === "awaiting-login" ? I18n.tr("Applied")
                                        : Updates.deployment.phase || ""
                                    wrapMode: Text.Wrap
                                    color: Theme.textHi
                                    font.family: Theme.fontMenu
                                    font.pixelSize: Theme.typography.secondary
                                    font.weight: Theme.weightSemibold
                                }
                            }

                            // What the build adds, removes and changes, in a well.
                            Rectangle {
                                width: parent.width
                                visible: root.deploymentState === "ready" && root.closure.rows.length > 0
                                height: visible ? closureColumn.implicitHeight + Theme.scaled(14) : 0
                                radius: Theme.assistantRowRadius
                                color: Theme.well

                                Column {
                                    id: closureColumn
                                    x: Theme.scaled(9)
                                    y: Theme.scaled(7)
                                    width: parent.width - Theme.scaled(18)

                                    Repeater {
                                        model: root.deploymentState === "ready" ? root.closure.rows : []

                                        delegate: Text {
                                            required property var modelData
                                            width: closureColumn.width
                                            text: (modelData.kind === "added" ? "+ " : modelData.kind === "removed" ? "− " : "~ ")
                                                + modelData.name + "  " + modelData.change
                                            elide: Text.ElideRight
                                            color: modelData.kind === "added" ? Theme.ok
                                                : modelData.kind === "removed" ? Theme.redText : Theme.textMid
                                            font.family: Theme.fontMono
                                            font.pixelSize: Theme.typography.metadata
                                        }
                                    }
                                }
                            }

                            Text {
                                width: parent.width
                                visible: root.deploymentState === "awaiting-boot"
                                text: Updates.rebootRecommendation
                                wrapMode: Text.WordWrap
                                color: Theme.textLow
                                font.family: Theme.fontMenu
                                font.pixelSize: Theme.typography.metadata
                            }

                            AssistantButton {
                                objectName: "assistantReviewChange"
                                width: parent.width
                                visible: root.deploymentState === "ready"
                                label: I18n.tr("Review change…")
                                primary: true
                                onTriggered: Assistant.reviewStagedChange()
                            }
                        }
                    }

                    // Routines this answer created: when they run, and their settings.
                    Repeater {
                        model: root.routinesMade

                        delegate: Rectangle {
                            id: routineCard
                            required property var modelData
                            width: extras.width
                            height: routineColumn.implicitHeight + Theme.scaled(20)
                            radius: root.innerRadius
                            color: Theme.cardFill
                            border.width: 1
                            border.color: Theme.hairline

                            Column {
                                id: routineColumn
                                x: Theme.scaled(11)
                                y: Theme.scaled(10)
                                width: parent.width - Theme.scaled(22)
                                spacing: Theme.scaled(3)

                                Row {
                                    spacing: Theme.scaled(6)

                                    Sym {
                                        anchors.verticalCenter: parent.verticalCenter
                                        name: "event"
                                        size: Theme.iconSmall
                                        color: Theme.accentText
                                    }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: I18n.tr("Routine created")
                                        color: Theme.textHi
                                        font.family: Theme.fontMenu
                                        font.pixelSize: Theme.typography.secondary
                                        font.weight: Theme.weightSemibold
                                    }
                                }
                                Text {
                                    width: parent.width
                                    text: routineCard.modelData.title
                                    elide: Text.ElideRight
                                    textFormat: Text.PlainText
                                    color: Theme.textMid
                                    font.family: Theme.fontMenu
                                    font.pixelSize: Theme.typography.metadata
                                }
                                Text {
                                    width: parent.width
                                    text: Assistant.routineLabel(routineCard.modelData) + " · "
                                        + (routineCard.modelData.notify === "always" ? I18n.tr("always tells you")
                                            : I18n.tr("tells you only when something needs attention"))
                                    wrapMode: Text.WordWrap
                                    color: Theme.textLow
                                    font.family: Theme.fontMenu
                                    font.pixelSize: Theme.typography.metadata
                                }
                                Row {
                                    topPadding: Theme.scaled(4)
                                    spacing: Theme.scaled(4)

                                    AssistantButton {
                                        label: I18n.tr("Edit")
                                        controlHeight: Theme.scaled(26)
                                        onTriggered: Assistant.showRoutines()
                                    }
                                    AssistantButton {
                                        label: I18n.tr("Run now")
                                        glyph: "play_arrow"
                                        controlHeight: Theme.scaled(26)
                                        onTriggered: Assistant.runRoutine(routineCard.modelData.id)
                                    }
                                }
                            }
                        }
                    }

                    // Everything the answer changed, each with its own Undo.
                    AssistantChanges {
                        width: parent.width
                        radius: root.innerRadius
                        changes: root.changes
                    }

                    // Widgets the turn created. They stay off until added.
                    Repeater {
                        model: root.plugins

                        delegate: Rectangle {
                            id: pluginRow
                            required property var modelData
                            width: extras.width
                            height: Theme.scaled(44)
                            radius: root.innerRadius
                            color: Theme.cardFill
                            border.width: 1
                            border.color: Theme.hairline

                            Sym {
                                id: pluginGlyph
                                anchors.left: parent.left
                                anchors.leftMargin: Theme.scaled(11)
                                anchors.verticalCenter: parent.verticalCenter
                                name: "widgets"
                                size: Theme.iconMedium
                                color: Theme.accentText
                            }

                            Column {
                                anchors.left: pluginGlyph.right
                                anchors.leftMargin: Theme.scaled(9)
                                anchors.right: addButton.left
                                anchors.rightMargin: Theme.scaled(8)
                                anchors.verticalCenter: parent.verticalCenter

                                Text {
                                    width: parent.width
                                    text: pluginRow.modelData.name || pluginRow.modelData.id
                                    elide: Text.ElideRight
                                    color: Theme.textHi
                                    font.family: Theme.fontMenu
                                    font.pixelSize: Theme.typography.secondary
                                }
                                Text {
                                    width: parent.width
                                    text: I18n.format("%1 · off until added", [pluginRow.modelData.id])
                                    elide: Text.ElideRight
                                    color: Theme.textLow
                                    font.family: Theme.fontMono
                                    font.pixelSize: Theme.typography.metadata
                                }
                            }

                            AssistantButton {
                                id: addButton
                                anchors.right: parent.right
                                anchors.rightMargin: Theme.scaled(7)
                                anchors.verticalCenter: parent.verticalCenter
                                label: I18n.tr("Add to bar")
                                primary: true
                                controlHeight: Theme.scaled(28)
                                onTriggered: Assistant.addWidget(pluginRow.modelData.id)
                            }
                        }
                    }

                    Text {
                        width: parent.width
                        visible: Assistant.notice !== ""
                        text: Assistant.notice
                        wrapMode: Text.WordWrap
                        color: Theme.textMid
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.metadata
                    }
                }
            }
        }

        NumberAnimation {
            id: scroller
            target: bodyFlick
            property: "contentY"
            duration: Theme.reducedMotion ? 0 : 260
            easing.type: Easing.OutCubic
        }

        // The cut edge fades into the box, opaque at the edge.
        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: Theme.scaled(40)
            visible: root.overflowing && !root.atEnd
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.rgba(root.fill.r, root.fill.g, root.fill.b, 0) }
                GradientStop { position: 1; color: root.fill }
            }
        }

        AssistantButton {
            objectName: "assistantMore"
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            visible: root.overflowing && !root.atEnd
            glyph: "expand_more"
            label: I18n.tr("More")
            controlHeight: Theme.scaled(26)
            color: Theme.menuBg
            onTriggered: root.readOn()
        }
    }

    // ---- quiet actions ---------------------------------------------------------------
    // Ghost buttons, their words lined up with the answer's.
    Row {
        id: actions
        x: -Theme.scaled(6)
        visible: root.canSpeak || root.canCopy || root.canHandoff
        spacing: Theme.scaled(2)

        AssistantButton {
            id: speakButton
            visible: root.canSpeak
            label: Assistant.speaking ? I18n.tr("Stop") : I18n.tr("Speak")
            glyph: Assistant.speaking ? "stop" : "volume_up"
            controlHeight: Theme.scaled(28)
            color: "transparent"
            onTriggered: {
                if (Assistant.speaking)
                    Assistant.stopSpeaking();
                else
                    Assistant.speak();
            }
        }

        AssistantButton {
            id: copyButton
            objectName: "assistantCopyReply"
            visible: !root.failed && root.turn !== null && (root.turn.text || "") !== ""
            glyph: "content_copy"
            label: I18n.tr("Copy")
            accessibleName: I18n.tr("Copy the reply")
            tip: I18n.tr("Copy the reply")
            controlHeight: Theme.scaled(28)
            color: "transparent"
            onTriggered: Assistant.copyReply()
        }

        AssistantButton {
            id: handoffButton
            objectName: "assistantHandoff"
            visible: root.canHandoff
            glyph: "terminal"
            label: I18n.tr("Terminal")
            accessibleName: I18n.tr("Continue in a terminal")
            tip: I18n.tr("Continue in a terminal")
            controlHeight: Theme.scaled(28)
            color: "transparent"
            onTriggered: Assistant.handoff()
        }
    }

    // Sentence by sentence while it is read aloud.
    Rectangle {
        id: speechBar
        width: parent.width
        height: 2
        radius: 1
        visible: Assistant.speaking && Assistant.speechCount > 0
        color: Theme.hairline

        Rectangle {
            width: parent.width * Math.min(1, (Assistant.speechIndex + 1) / Math.max(1, Assistant.speechCount))
            height: parent.height
            radius: 1
            color: Theme.accent

            Behavior on width {
                NumberAnimation { duration: Theme.chipFadeDuration }
            }
        }
    }

    // ---- who answers, and how ----------------------------------------------------------
    // Open, it floats over the answer, its tail on the logo, and a short
    // answer leaves it room above the field (pickerRoom); past what the box
    // may use, its choices scroll.
    Item {
        width: parent.width
        visible: root.pickerRoom > 0
        height: Math.max(0, root.pickerRoom - root.spacing)
    }

    AssistantModelPicker {
        id: picker
        parent: root
        width: Math.min(Theme.scaled(296), root.width - root.padding * 2)
        x: root.width - root.padding - width
        y: root.padding + field.y - root.pickerGap - height
        visible: root.pickerOpen
        radius: Theme.assistantPopupRadius
        continuing: true
        maximumHeight: root.room - root.padding * 2 - root.pickerTop - root.pickerGap - field.height
        tailSide: "bottom"
        tailX: root.padding + fieldButtons.x + agentButton.x + agentButton.width / 2 - x
        onCloseRequested: root.pickerOpen = false
    }

    // ---- the reply field ---------------------------------------------------------------
    Rectangle {
        id: field
        width: parent.width
        height: Math.max(Theme.scaled(40), replyFlick.height + Theme.scaled(16))
        radius: root.innerRadius
        color: Theme.well
        border.width: 1
        border.color: replyInput.activeFocus ? Theme.accent : Theme.hairline

        Behavior on border.color {
            ColorAnimation { duration: Theme.chipFadeDuration }
        }

        Flickable {
            id: replyFlick
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(12)
            anchors.right: fieldButtons.left
            anchors.rightMargin: Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter
            height: Math.min(Theme.scaled(96), Math.max(Theme.scaled(22), replyInput.contentHeight))
            contentWidth: width
            contentHeight: Math.max(height, replyInput.contentHeight)
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            TextEdit {
                id: replyInput
                objectName: "assistantReplyField"
                width: replyFlick.width
                height: Math.max(replyFlick.height, contentHeight)
                wrapMode: TextEdit.Wrap
                selectByMouse: true
                color: Theme.textHi
                selectionColor: Theme.accentSoft
                selectedTextColor: Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.control
                Accessible.name: I18n.tr("Reply to Wiz…")
                Accessible.description: I18n.tr("Enter sends. Shift Enter inserts a newline.")

                onCursorRectangleChanged: {
                    if (cursorRectangle.y + cursorRectangle.height > replyFlick.contentY + replyFlick.height)
                        replyFlick.contentY = cursorRectangle.y + cursorRectangle.height - replyFlick.height;
                    else if (cursorRectangle.y < replyFlick.contentY)
                        replyFlick.contentY = cursorRectangle.y;
                }

                // Esc backs out one step: the picker, then the reply.
                Keys.onPressed: event => {
                    if (event.key === Qt.Key_Escape) {
                        if (root.pickerOpen)
                            root.pickerOpen = false;
                        else
                            Assistant.closeReply();
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        if (event.modifiers & Qt.ShiftModifier)
                            replyInput.insert(replyInput.cursorPosition, "\n");
                        else
                            root.sendReply();
                        event.accepted = true;
                    }
                }

                Text {
                    visible: replyInput.text === ""
                    width: parent.width
                    text: I18n.tr("Reply to Wiz…")
                    elide: Text.ElideRight
                    color: Theme.textFaint
                    font: replyInput.font
                }
            }
        }

        Row {
            id: fieldButtons
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(6)
            anchors.bottom: parent.bottom
            anchors.bottomMargin: Theme.scaled(5)
            spacing: Theme.scaled(2)

            AssistantAgentButton {
                id: agentButton
                open: root.pickerOpen
                onTriggered: root.togglePicker()
            }

            AssistantButton {
                visible: Assistant.voiceAvailable
                glyph: "mic"
                accessibleName: I18n.tr("Talk instead of typing")
                color: "transparent"
                onTriggered: root.talk()
            }

            // Always there, as in the mockup; it sends once there is something to send.
            AssistantButton {
                objectName: "assistantReplySend"
                glyph: "arrow_upward"
                primary: true
                accessibleName: I18n.tr("Send")
                enabled: replyInput.text.trim() !== "" && Assistant.connected && !Assistant.busy
                onTriggered: root.sendReply()
            }
        }
    }
}
