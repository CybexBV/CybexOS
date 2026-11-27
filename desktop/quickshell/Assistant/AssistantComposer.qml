pragma ComponentBehavior: Bound
import QtQuick
import Quickshell.Services.Pipewire
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers

// Where a question is typed or spoken. Enter sends, Shift+Enter breaks the
// line and Esc closes (a recording is cancelled first). While listening, the
// field becomes a level meter; Voxtype transcribes once the key or button is
// released, and the words land here — sent straight away for push-to-talk.
//
// A new conversation offers History, suggestions and the three most recent
// conversations. A continued one (Reply, or a row in History) shows its
// questions and answers above the field, each answer as the reply box shows
// one (the 2026-11-27 mockup): the question in its bubble, the answer led by
// its headline, a failure in its red block, and under it who answered and
// how long, with Speak, Copy and Terminal under the latest. `room` is the
// height the box may use, which that transcript scrolls within. The agent's
// logo in the field picks who answers and how (AssistantModelPicker), for
// this conversation, in a popup next to it: above a conversation's field,
// over the transcript, and below a new conversation's, over the suggestions.
// ••• opens the conversation's menu, a popup of its own.
AssistantSurface {
    id: root

    property real room: 400
    readonly property bool continuing: Assistant.continuing !== ""
    readonly property var thread: Assistant.thread
    // As many of the three as fit in the room on this side of the character.
    readonly property real recentRowHeight: Theme.scaled(38)
    readonly property real baseHeight: header.height + field.height + suggestionFlow.height
        + (agentLine.visible ? agentLine.height : 0)
        + root.spacing * 5 + root.padding * 2 + Theme.scaled(64)
    // The picker opens towards the room: up over a conversation, down in a
    // new one, whose field is near the top.
    readonly property bool pickerAbove: root.continuing
    readonly property real popupGap: Theme.scaled(8)
    // Everything above the field but the open picker's room, and where the
    // picker's top may reach: under the header, which keeps Back and Close,
    // unless the box's room is too short for that; then over the header too.
    readonly property real aboveField: (setup.visible ? setup.height + root.spacing : 0)
        + (header.visible ? header.height + root.spacing : 0)
        + (transcriptFlick.visible ? transcriptFlick.height + root.spacing : 0)
        + (screenChip.visible ? screenChip.height + root.spacing : 0)
        + (attachmentFlow.visible ? attachmentFlow.height + root.spacing : 0)
    readonly property real pickerTop: header.visible && root.room - root.padding * 2 - header.height
        - root.spacing - root.popupGap - field.height >= picker.naturalHeight ? header.height + root.spacing : 0
    readonly property real pickerRoom: root.pickerOpen && root.pickerAbove && picker.visible
        ? Math.max(0, root.pickerTop + picker.height + root.popupGap - root.aboveField) : 0
    // The menu and a downward picker float below their buttons; the box
    // grows to hold them.
    minimumHeight: Math.max(
        menu.visible ? root.padding + header.height + Theme.scaled(4) + menu.height + root.padding : 0,
        picker.visible && !root.pickerAbove
            ? root.padding + field.y + field.height + root.popupGap + picker.height + root.padding : 0)
    readonly property var recent: Assistant.conversations.slice(0, Math.max(0, Math.min(
        AssistantHelpers.RECENT_LIMIT, Math.floor((root.room - root.baseHeight) / root.recentRowHeight))))
    property bool menuOpen: false
    // The agent, model and effort picker under the field.
    property bool pickerOpen: false
    onVisibleChanged: {
        menuOpen = false;
        pickerOpen = false;
    }

    readonly property bool listening: Assistant.listening
    // The microphone's level, which the character's ring follows too.
    readonly property real level: listening ? peaks.peak : 0
    readonly property bool transcribing: Assistant.transcribing
    // The one suggestion that fits the moment, first, with why it is there.
    readonly property var situational: {
        const moment = Assistant.situation;
        if (!moment)
            return null;
        switch (moment.kind) {
        case "update-failed":
            return { text: I18n.tr("Why did the update fail?"), update: true, glyph: "warning",
                warn: true, reason: I18n.format("Software Update failed %1", [root.ago(moment.at)]) };
        case "kept":
            return { text: I18n.format("What's new in %1?", [moment.version]), glyph: "auto_awesome",
                reason: I18n.format("Cybex OS %1 was kept %2", [moment.version, root.ago(moment.at)]) };
        case "repeated":
            return { text: I18n.format("Why does “%1” keep happening?", [moment.summary]), glyph: "notifications",
                reason: I18n.format("%1 times in the last hour", [moment.count]) };
        }
        return null;
    }

    function ago(at) {
        const minutes = Math.max(0, Math.floor((Assistant.now - at) / 60000));
        return minutes < 1 ? I18n.tr("just now") : minutes === 1 ? I18n.tr("a minute ago")
            : I18n.format("%1 minutes ago", [minutes]);
    }

    readonly property var suggestions: {
        const list = [
            { text: I18n.tr("Check this computer"), check: true },
            { text: I18n.tr("What can you do?"), screen: false },
            { text: I18n.tr("Make the menubar transparent"), screen: false },
            { text: I18n.tr("Create a CPU temperature widget"), screen: false }
        ];
        if (Settings.assistantScreenContext)
            list.push({ text: I18n.tr("Explain what is on my screen"), screen: true });
        // Only three fixed ones after the moment's own.
        return root.situational ? [root.situational].concat(list.slice(0, 3)) : list;
    }

    function focusInput() {
        if (!root.listening && !Assistant.setupRequired)
            input.forceActiveFocus();
    }

    AssistantSetup {
        id: setup
        width: parent.width
        visible: Assistant.connected && Assistant.setupRequired
    }

    // Esc backs out one step at a time: the recording, the menu, then the box.
    function backOut() {
        if (Assistant.listening || Assistant.transcribing)
            Assistant.cancelListening();
        else if (root.pickerOpen)
            root.pickerOpen = false;
        else if (root.menuOpen)
            root.menuOpen = false;
        else
            Assistant.closeComposer();
    }

    Connections {
        target: Assistant

        function onFocusComposer() {
            Qt.callLater(root.focusInput);
        }

        function onDraftChanged() {
            if (input.text !== Assistant.draft) {
                input.syncing = true;
                input.text = Assistant.draft;
                input.cursorPosition = input.text.length;
                input.syncing = false;
            }
        }
    }

    // ---- which conversation ----------------------------------------------------------
    Item {
        id: header
        width: parent.width
        height: Theme.scaled(28)
        visible: !root.listening

        AssistantButton {
            id: backButton
            x: -Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter
            visible: root.continuing
            glyph: "arrow_back"
            accessibleName: I18n.tr("Back to History")
            controlHeight: Theme.scaled(28)
            color: "transparent"
            onTriggered: Assistant.openHistory()
        }

        Text {
            anchors.left: root.continuing ? backButton.right : parent.left
            anchors.leftMargin: root.continuing ? Theme.scaled(4) : 0
            anchors.right: headerActions.left
            anchors.rightMargin: Theme.scaled(8)
            anchors.verticalCenter: parent.verticalCenter
            text: !root.continuing ? I18n.tr("New conversation")
                : Assistant.continuingRow ? Assistant.continuingRow.title
                : root.thread ? root.thread.title || "" : ""
            textFormat: Text.PlainText
            elide: Text.ElideRight
            color: Theme.textHi
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.control
            font.weight: Theme.weightSemibold
        }

        Row {
            id: headerActions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.scaled(2)

            AssistantButton {
                visible: !root.continuing && Assistant.connected
                objectName: "assistantHistoryButton"
                glyph: "history"
                label: I18n.tr("History")
                controlHeight: Theme.scaled(28)
                color: "transparent"
                onTriggered: Assistant.openHistory()
            }

            AssistantButton {
                id: moreButton
                objectName: "assistantConversationMore"
                visible: root.continuing
                glyph: "more_horiz"
                accessibleName: I18n.tr("More for this conversation")
                // The open menu says it all; its name would sit on top of it.
                tip: root.menuOpen ? "" : accessibleName
                controlHeight: Theme.scaled(28)
                color: root.menuOpen ? Theme.chipHover : "transparent"
                onTriggered: {
                    root.pickerOpen = false;
                    root.menuOpen = !root.menuOpen;
                }
            }

            AssistantButton {
                visible: root.continuing
                glyph: "close"
                accessibleName: I18n.tr("Close")
                controlHeight: Theme.scaled(28)
                color: "transparent"
                onTriggered: Assistant.closeComposer()
            }
        }
    }

    // What can be done with the whole conversation: a small menu under •••.
    AssistantSurface {
        id: menu
        objectName: "assistantConversationMenu"
        parent: root
        z: 10
        width: Math.min(Theme.scaled(232), root.width - root.padding * 2)
        x: root.padding + headerActions.x + moreButton.x + moreButton.width - width
        y: root.padding + header.height + Theme.scaled(4)
        visible: root.continuing && root.menuOpen && !root.listening
        fill: Theme.menuBg
        radius: root.innerRadius
        padding: Theme.scaled(5)
        spacing: 0
        readonly property int rowRadius: Theme.concentricRadius(radius, padding)

        MenuRow {
            visible: root.thread !== null && root.thread.resumable === true
            radius: menu.rowRadius
            glyph: "terminal"
            label: I18n.tr("Continue in a terminal")
            onChosen: {
                root.menuOpen = false;
                Assistant.handoff(Assistant.continuing);
            }
        }

        MenuRow {
            visible: root.thread !== null
            radius: menu.rowRadius
            glyph: "content_copy"
            label: I18n.tr("Copy conversation")
            onChosen: {
                root.menuOpen = false;
                Assistant.copyConversation();
            }
        }

        MenuRow {
            radius: menu.rowRadius
            glyph: "add"
            label: I18n.tr("New conversation")
            onChosen: {
                root.menuOpen = false;
                Assistant.newConversation();
            }
        }

        Rectangle {
            x: Theme.scaled(6)
            width: parent.width - Theme.scaled(12)
            height: Theme.scaled(9)
            color: "transparent"

            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width
                height: 1
                color: Theme.hairline
            }
        }

        MenuRow {
            radius: menu.rowRadius
            glyph: "delete"
            label: I18n.tr("Delete conversation")
            danger: true
            onChosen: {
                root.menuOpen = false;
                const id = Assistant.continuing;
                Assistant.openHistory();
                Assistant.deleteConversation(id);
            }
        }
    }

    // One of the menu's actions.
    component MenuRow: Rectangle {
        id: menuRow
        property string glyph: ""
        property string label: ""
        property bool danger: false
        signal chosen()

        width: parent ? parent.width : 0
        height: visible ? Theme.scaled(32) : 0
        color: menuRowMouse.containsMouse || activeFocus && FocusModality.keyboard ? Theme.chipHover : "transparent"
        border.width: Theme.focusWidth(activeFocus)
        border.color: Theme.focusRing
        activeFocusOnTab: visible
        Accessible.role: Accessible.MenuItem
        Accessible.name: menuRow.label
        Accessible.onPressAction: menuRow.chosen()

        Keys.onPressed: event => {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
                menuRow.chosen();
                event.accepted = true;
            }
        }

        Row {
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(9)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.scaled(10)

            Sym {
                anchors.verticalCenter: parent.verticalCenter
                name: menuRow.glyph
                size: Theme.iconMedium
                color: menuRow.danger ? Theme.redText : Theme.textLow
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: menuRow.label
                color: menuRow.danger ? Theme.redText : Theme.textHi
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
            }
        }

        MouseArea {
            id: menuRowMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: menuRow.chosen()
        }
    }

    // ---- the conversation so far -----------------------------------------------------
    Flickable {
        id: transcriptFlick
        readonly property real chrome: header.height + field.height + (agentLine.visible ? agentLine.height : 0)
            + root.spacing * 4 + root.padding * 2 + Theme.scaled(24)
        readonly property var turns: root.thread ? root.thread.turns || [] : []
        readonly property string agent: root.thread ? root.thread.agent || "" : ""
        width: parent.width
        visible: root.continuing && root.thread !== null && !root.listening && !Assistant.setupRequired
        height: visible ? Math.max(Theme.scaled(60), Math.min(transcript.implicitHeight, root.room - chrome)) : 0
        contentWidth: width
        contentHeight: transcript.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        // The latest answer is where reading resumes.
        onContentHeightChanged: contentY = Math.max(0, contentHeight - height)
        onHeightChanged: contentY = Math.max(0, contentHeight - height)

        Column {
            id: transcript
            width: transcriptFlick.width
            spacing: Theme.scaled(14)

            Repeater {
                model: transcriptFlick.turns

                delegate: Column {
                    id: exchange
                    required property var modelData
                    required property int index
                    readonly property bool failed: modelData.status === "failed"
                    readonly property bool active: modelData.status === "running" || modelData.status === "waiting"
                    readonly property bool latest: index === transcriptFlick.turns.length - 1
                    readonly property string answer: modelData.text || ""
                    width: transcript.width
                    spacing: Theme.scaled(8)

                    // The question, on the right, in the reply's bubble.
                    Item {
                        width: parent.width
                        height: bubble.height

                        Rectangle {
                            id: bubble
                            anchors.right: parent.right
                            width: question.width + Theme.scaled(22)
                            height: question.height + Theme.scaled(14)
                            radius: root.innerRadius
                            bottomRightRadius: Theme.concentricRadius(root.innerRadius, Theme.scaled(6))
                            color: Theme.accentBgSoft
                            border.width: 1
                            border.color: Theme.accentAlpha(0.24)

                            Text {
                                id: question
                                x: Theme.scaled(11)
                                y: Theme.scaled(7)
                                width: Math.min(implicitWidth, exchange.width * 0.86 - Theme.scaled(22))
                                text: exchange.modelData.prompt || ""
                                textFormat: Text.PlainText
                                wrapMode: Text.Wrap
                                color: Theme.textHi
                                font.family: Theme.fontMenu
                                font.pixelSize: Theme.typography.secondary
                            }
                        }
                    }

                    // The answer as the reply box shows it, led by its headline.
                    AssistantMarkdown {
                        width: parent.width
                        blockRadius: root.innerRadius
                        visible: !exchange.failed && !exchange.active && text !== ""
                        lead: true
                        text: exchange.modelData.status === "stopped" && exchange.answer === ""
                            ? I18n.tr("Stopped.") : exchange.answer
                        color: Theme.textHi
                    }

                    AssistantFailure {
                        width: parent.width
                        visible: exchange.failed
                        height: visible ? implicitHeight : 0
                        radius: root.innerRadius
                        answer: exchange.modelData
                        agent: transcriptFlick.agent
                        offersFix: exchange.latest
                    }

                    // Still running: quiet words and Wiz's three dots.
                    Row {
                        visible: exchange.active
                        spacing: Theme.scaled(8)

                        Row {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Theme.scaled(3)

                            Repeater {
                                model: 3

                                delegate: Rectangle {
                                    id: dot
                                    required property int index
                                    width: Theme.scaled(5)
                                    height: width
                                    radius: width / 2
                                    color: Theme.accentText
                                    opacity: 0.35

                                    SequentialAnimation on opacity {
                                        running: exchange.active && root.visible && !Theme.reducedMotion
                                        loops: Animation.Infinite
                                        PauseAnimation { duration: dot.index * 200 }
                                        NumberAnimation { to: 1; duration: 300 }
                                        NumberAnimation { to: 0.35; duration: 500 }
                                        PauseAnimation { duration: (2 - dot.index) * 200 }
                                    }
                                }
                            }
                        }

                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: I18n.tr("Wiz is working on this…")
                            color: Theme.textLow
                            font.family: Theme.fontMenu
                            font.pixelSize: Theme.typography.secondary
                        }
                    }

                    // Under the answer: the latest one's quiet actions, and
                    // who answered and how long.
                    Item {
                        width: parent.width
                        visible: !exchange.active && exchange.modelData.finishedAt > 0
                        height: !visible ? 0 : quietActions.visible ? Theme.scaled(28) : Theme.scaled(18)

                        Row {
                            id: quietActions
                            x: -Theme.scaled(6)
                            anchors.verticalCenter: parent.verticalCenter
                            visible: exchange.latest && !exchange.failed && exchange.answer !== ""
                            spacing: Theme.scaled(2)

                            AssistantButton {
                                visible: Assistant.speechAvailable
                                label: Assistant.speaking ? I18n.tr("Stop") : I18n.tr("Speak")
                                glyph: Assistant.speaking ? "stop" : "volume_up"
                                controlHeight: Theme.scaled(28)
                                color: "transparent"
                                onTriggered: {
                                    if (Assistant.speaking)
                                        Assistant.stopSpeaking();
                                    else
                                        Assistant.speak(exchange.modelData);
                                }
                            }

                            AssistantButton {
                                objectName: "assistantCopyAnswer"
                                glyph: "content_copy"
                                label: I18n.tr("Copy")
                                accessibleName: I18n.tr("Copy the reply")
                                tip: I18n.tr("Copy the reply")
                                controlHeight: Theme.scaled(28)
                                color: "transparent"
                                onTriggered: Assistant.copyReply(exchange.modelData)
                            }

                            AssistantButton {
                                visible: root.thread !== null && root.thread.resumable === true
                                glyph: "terminal"
                                label: I18n.tr("Terminal")
                                accessibleName: I18n.tr("Continue in a terminal")
                                tip: I18n.tr("Continue in a terminal")
                                controlHeight: Theme.scaled(28)
                                color: "transparent"
                                onTriggered: Assistant.handoff(Assistant.continuing)
                            }
                        }

                        Row {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Theme.scaled(5)

                            BrandIcon {
                                anchors.verticalCenter: parent.verticalCenter
                                visible: name !== ""
                                width: Theme.iconSmall
                                height: Theme.iconSmall
                                name: AssistantHelpers.AGENT_ICONS[transcriptFlick.agent] || ""
                            }

                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: (AssistantHelpers.AGENT_LABELS[transcriptFlick.agent] || "")
                                    + " · " + AssistantHelpers.elapsedLabel(exchange.modelData.finishedAt
                                        - exchange.modelData.startedAt)
                                color: Theme.textFaint
                                font.family: Theme.fontMenu
                                font.pixelSize: Theme.typography.metadata
                                font.features: Theme.tabularNumberFeatures
                            }
                        }
                    }
                }
            }
        }
    }

    // Earlier answers fade out under the header as they scroll away, into
    // the card's own colour there (it fades from topFill to fill).
    Rectangle {
        id: transcriptFade
        readonly property real along: Math.min(1, (root.padding + transcriptFlick.y) / Theme.scaled(140))
        readonly property color ink: Qt.rgba(root.topFill.r + (root.fill.r - root.topFill.r) * along,
            root.topFill.g + (root.fill.g - root.topFill.g) * along,
            root.topFill.b + (root.fill.b - root.topFill.b) * along, 1)
        parent: root
        x: root.padding
        y: root.padding + transcriptFlick.y
        width: transcriptFlick.width
        height: Theme.scaled(24)
        visible: transcriptFlick.visible && transcriptFlick.contentY > 1
        gradient: Gradient {
            GradientStop { position: 0; color: transcriptFade.ink }
            GradientStop { position: 1; color: Qt.rgba(transcriptFade.ink.r, transcriptFade.ink.g, transcriptFade.ink.b, 0) }
        }
    }

    // ---- the attached screenshot ------------------------------------------------
    Rectangle {
        id: screenChip
        width: parent.width
        height: visible ? Theme.scaled(46) : 0
        visible: Assistant.screenAttached && !Assistant.setupRequired
        radius: root.innerRadius
        color: Theme.chip

        Row {
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.scaled(10)

            Rectangle {
                width: Theme.scaled(56)
                height: Theme.scaled(34)
                radius: Theme.concentricRadius(root.innerRadius, Theme.scaled(6))
                color: Theme.well
                clip: true

                Image {
                    anchors.fill: parent
                    source: Assistant.screenAttached ? "file://" + Assistant.screenPath : ""
                    sourceSize.width: Theme.scaled(112)
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    cache: false
                }
            }

            Column {
                anchors.verticalCenter: parent.verticalCenter

                Text {
                    text: I18n.format("Screen · %1", [Assistant.screenOutput])
                    color: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.secondary
                }
                Text {
                    text: I18n.tr("Sent with this question only")
                    color: Theme.textLow
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.metadata
                }
            }
        }

        AssistantButton {
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter
            glyph: "close"
            accessibleName: I18n.tr("Remove the screenshot")
            controlHeight: Theme.scaled(26)
            color: "transparent"
            onTriggered: Assistant.detachScreen()
        }
    }

    // ---- what goes with the question ----------------------------------------------
    Flow {
        id: attachmentFlow
        width: parent.width
        spacing: Theme.scaled(5)
        visible: Assistant.attachments.length > 0 && !Assistant.setupRequired && !root.listening

        Repeater {
            model: Assistant.attachments

            delegate: Rectangle {
                id: attachmentChip
                required property var modelData
                height: Theme.scaled(26)
                width: Math.min(attachmentFlow.width * 0.8, chipRow.implicitWidth + Theme.scaled(6))
                radius: Theme.chipRadius
                color: Theme.chip
                border.width: 1
                border.color: Theme.hairline
                clip: true
                Accessible.role: Accessible.StaticText
                Accessible.name: attachmentChip.modelData.label

                Row {
                    id: chipRow
                    anchors.left: parent.left
                    anchors.leftMargin: Theme.scaled(8)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Theme.scaled(5)

                    Sym {
                        anchors.verticalCenter: parent.verticalCenter
                        name: AssistantHelpers.attachmentGlyph(attachmentChip.modelData.kind)
                        size: Theme.iconSmall
                        color: Theme.textLow
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        width: Math.min(implicitWidth, attachmentFlow.width * 0.8 - Theme.scaled(80))
                        text: attachmentChip.modelData.label
                        elide: Text.ElideMiddle
                        textFormat: Text.PlainText
                        color: Theme.textMid
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.metadata
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        visible: (attachmentChip.modelData.detail || "") !== ""
                        text: attachmentChip.modelData.detail || ""
                        color: Theme.textFaint
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.metadata
                    }
                    AssistantButton {
                        anchors.verticalCenter: parent.verticalCenter
                        glyph: "close"
                        accessibleName: I18n.format("Remove %1", [attachmentChip.modelData.label])
                        controlHeight: Theme.scaled(18)
                        color: "transparent"
                        onTriggered: Assistant.removeAttachment(attachmentChip.modelData.id)
                    }
                }
            }
        }
    }

    // What a short conversation lacks to hold the open picker above the field.
    Item {
        width: parent.width
        visible: root.pickerRoom > 0
        height: Math.max(0, root.pickerRoom - root.spacing)
    }

    // ---- the field ---------------------------------------------------------------
    Rectangle {
        id: field
        visible: !Assistant.setupRequired
        width: parent.width
        height: Math.max(Theme.scaled(40), inputArea.height + Theme.scaled(16))
        radius: root.innerRadius
        color: Theme.well
        border.width: 1
        border.color: input.activeFocus || root.listening ? Theme.accent : Theme.hairline

        Behavior on border.color {
            ColorAnimation { duration: Theme.chipFadeDuration }
        }

        Item {
            id: inputArea
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(12)
            anchors.right: buttons.left
            anchors.rightMargin: Theme.scaled(6)
            anchors.verticalCenter: parent.verticalCenter
            height: root.listening || root.transcribing ? Theme.scaled(28)
                : Math.min(Theme.scaled(110), Math.max(Theme.scaled(22), input.contentHeight))

            Flickable {
                id: inputFlick
                anchors.fill: parent
                visible: !root.listening && !root.transcribing
                contentWidth: width
                contentHeight: Math.max(height, input.contentHeight)
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                TextEdit {
                    id: input
                    property bool syncing: false

                    width: inputFlick.width
                    height: Math.max(inputFlick.height, contentHeight)
                    wrapMode: TextEdit.Wrap
                    selectByMouse: true
                    color: Theme.textHi
                    selectionColor: Theme.accentSoft
                    selectedTextColor: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.control
                    Accessible.name: I18n.tr("Ask the Cybex OS Assistant")
                    Accessible.description: I18n.tr("Enter sends. Shift Enter inserts a newline.")
                    Component.onCompleted: text = Assistant.draft

                    onTextChanged: {
                        if (!syncing)
                            Assistant.draft = text;
                    }
                    onActiveFocusChanged: {
                        if (activeFocus)
                            Assistant.focusRequested = true;
                    }
                    onCursorRectangleChanged: {
                        if (cursorRectangle.y + cursorRectangle.height
                                > inputFlick.contentY + inputFlick.height)
                            inputFlick.contentY = cursorRectangle.y
                                + cursorRectangle.height - inputFlick.height;
                        else if (cursorRectangle.y < inputFlick.contentY)
                            inputFlick.contentY = cursorRectangle.y;
                    }

                    Keys.onPressed: event => {
                        if (event.key === Qt.Key_Escape) {
                            root.backOut();
                            event.accepted = true;
                        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                            if (event.modifiers & Qt.ShiftModifier)
                                input.insert(input.cursorPosition, "\n");
                            else
                                Assistant.send();
                            event.accepted = true;
                        } else if (event.key === Qt.Key_V && (event.modifiers & Qt.ControlModifier)) {
                            // A picture on the clipboard is attached; text pastes as usual.
                            Assistant.pasteImage();
                        }
                    }

                    Text {
                        visible: input.text === ""
                        width: parent.width
                        text: !Assistant.connected ? I18n.tr("The assistant service is not running.")
                            : root.continuing ? I18n.tr("Reply to Wiz…")
                            : I18n.tr("Ask Cybex OS anything…")
                        elide: Text.ElideRight
                        color: Theme.textFaint
                        font: input.font
                    }
                }
            }

            // Listening: the red dot, the level and the time so far.
            Row {
                anchors.fill: parent
                visible: root.listening
                spacing: Theme.scaled(8)

                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Theme.scaled(8)
                    height: width
                    radius: width / 2
                    color: Theme.red

                    SequentialAnimation on opacity {
                        running: root.listening && !Theme.reducedMotion
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.35; duration: 600 }
                        NumberAnimation { to: 1; duration: 600 }
                    }
                }

                AssistantVisualizer {
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width - timer.width - Theme.scaled(24)
                    height: parent.height
                    level: root.level
                    running: root.listening
                }

                Text {
                    id: timer
                    anchors.verticalCenter: parent.verticalCenter
                    text: AssistantHelpers.elapsedLabel(Assistant.now - Assistant.listenStartedAt)
                    color: Theme.textLow
                    font.family: Theme.fontNumeric
                    font.pixelSize: Theme.typography.metadata
                    font.features: Theme.tabularNumberFeatures
                }
            }

            Row {
                anchors.verticalCenter: parent.verticalCenter
                visible: root.transcribing
                spacing: Theme.scaled(8)

                Sym {
                    id: transcribingSpinner
                    anchors.verticalCenter: parent.verticalCenter
                    name: "progress_activity"
                    size: Theme.iconMedium
                    color: Theme.accentText

                    RotationAnimator on rotation {
                        running: root.transcribing && !Theme.reducedMotion
                        from: 0
                        to: 360
                        duration: 900
                        loops: Animation.Infinite
                    }
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: I18n.tr("Transcribing…")
                    color: Theme.textMid
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.secondary
                }
            }
        }

        Row {
            id: buttons
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(6)
            anchors.bottom: parent.bottom
            anchors.bottomMargin: Theme.scaled(5)
            spacing: Theme.scaled(2)

            AssistantAgentButton {
                id: agentButton
                visible: !root.listening && !root.transcribing
                open: root.pickerOpen
                onTriggered: {
                    root.menuOpen = false;
                    if (!AssistantHelpers.anyAgent(Assistant.agents))
                        Settings.showPanel("assistant", Assistant.screenName);
                    else
                        root.pickerOpen = !root.pickerOpen;
                }
            }

            AssistantButton {
                visible: Settings.assistantScreenContext && !root.listening && !root.transcribing
                glyph: "photo"
                accessibleName: Assistant.screenAttached ? I18n.tr("Remove the screenshot")
                    : I18n.tr("Attach the screen")
                color: Assistant.screenAttached ? Theme.chipHover : "transparent"
                enabled: !Assistant.capturing
                onTriggered: Assistant.toggleScreen()
            }

            AssistantButton {
                visible: Assistant.voiceAvailable && !root.transcribing
                glyph: root.listening ? "stop" : "mic"
                accessibleName: root.listening ? I18n.tr("Stop recording")
                    : I18n.tr("Talk instead of typing")
                color: root.listening ? Theme.redBgSoft : "transparent"
                danger: root.listening
                onTriggered: Assistant.toggleMicrophone()
            }

            AssistantButton {
                visible: root.listening || root.transcribing
                glyph: "close"
                accessibleName: I18n.tr("Cancel the recording")
                color: "transparent"
                onTriggered: Assistant.cancelListening()
            }

            // Always there, as in the reply's field; it sends once there is
            // something to send.
            AssistantButton {
                objectName: "assistantComposerSend"
                visible: !root.listening && !root.transcribing
                glyph: "arrow_upward"
                primary: true
                accessibleName: I18n.tr("Send")
                enabled: Assistant.draft.trim() !== "" && Assistant.connected && !Assistant.busy
                onTriggered: Assistant.send()
            }
        }
    }

    // ---- who answers, and how ----------------------------------------------------------
    // A popup next to the logo, floating over what is under or above it.
    AssistantModelPicker {
        id: picker
        parent: root
        width: Math.min(Theme.scaled(296), root.width - root.padding * 2)
        x: root.width - root.padding - width
        y: root.pickerAbove ? root.padding + field.y - root.popupGap - height
            : root.padding + field.y + field.height + root.popupGap
        visible: root.pickerOpen && !Assistant.setupRequired && !root.listening
        radius: root.innerRadius
        continuing: root.continuing
        maximumHeight: root.pickerAbove
            ? root.room - root.padding * 2 - root.pickerTop - root.popupGap - field.height
            : root.room - root.padding * 2 - field.y - field.height - root.popupGap
        tailSide: root.pickerAbove ? "bottom" : "top"
        tailX: root.padding + buttons.x + agentButton.x + agentButton.width / 2 - x
        onCloseRequested: root.pickerOpen = false
    }

    // ---- first questions -----------------------------------------------------------
    Flow {
        id: suggestionFlow
        width: parent.width
        spacing: Theme.scaled(6)
        visible: Assistant.draft === "" && !root.continuing
            && !root.listening && !root.transcribing && Assistant.connected && !Assistant.setupRequired

        Repeater {
            model: root.suggestions

            delegate: Rectangle {
                id: chip
                required property var modelData
                readonly property bool moment: !!chip.modelData.reason
                width: Math.min(suggestionFlow.width, chipContent.implicitWidth + Theme.scaled(18))
                height: Theme.scaled(26)
                radius: Theme.chipRadius
                color: chipMouse.containsMouse ? Theme.chipHover : Theme.chip
                border.width: moment ? 1 : 0
                border.color: chip.modelData.warn ? Theme.amber : Theme.accentText
                Accessible.role: Accessible.Button
                Accessible.name: chip.modelData.text
                Accessible.description: chip.modelData.reason || ""

                Row {
                    id: chipContent
                    anchors.centerIn: parent
                    spacing: Theme.scaled(4)

                    Sym {
                        anchors.verticalCenter: parent.verticalCenter
                        visible: chip.moment
                        name: chip.modelData.glyph || ""
                        size: Theme.iconSmall
                        color: chip.modelData.warn ? Theme.amber : Theme.accentText
                    }
                    Text {
                        id: chipText
                        anchors.verticalCenter: parent.verticalCenter
                        width: Math.min(implicitWidth, suggestionFlow.width - Theme.scaled(40))
                        text: chip.modelData.text
                        elide: Text.ElideRight
                        color: chip.moment ? Theme.textHi : Theme.textMid
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.metadata
                    }
                }

                MouseArea {
                    id: chipMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (chip.moment)
                            Assistant.useSituation();
                        if (chip.modelData.check)
                            Assistant.checkSystem();
                        else if (chip.modelData.update)
                            Assistant.askAboutUpdate();
                        else if (chip.modelData.screen)
                            Assistant.askAboutScreen(chip.modelData.text);
                        else
                            Assistant.send(chip.modelData.text);
                    }
                }
            }
        }
    }

    // Why the first suggestion is there.
    Row {
        visible: suggestionFlow.visible && root.situational !== null
        spacing: Theme.scaled(5)

        Sym {
            anchors.verticalCenter: parent.verticalCenter
            name: "schedule"
            size: Theme.iconSmall
            color: Theme.textFaint
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: root.situational ? root.situational.reason : ""
            color: Theme.textFaint
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.metadata
        }
    }

    // ---- the last three conversations ---------------------------------------------------
    Column {
        width: parent.width
        visible: !root.continuing && root.recent.length > 0 && !root.listening
            && !root.transcribing && Assistant.connected && !Assistant.setupRequired
        spacing: 0

        Rectangle {
            width: parent.width
            height: 1
            color: Theme.hairline
            opacity: 0.6
        }

        Text {
            width: parent.width
            topPadding: Theme.scaled(8)
            bottomPadding: Theme.scaled(2)
            text: I18n.tr("Recent")
            color: Theme.textLow
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.metadata
            font.weight: Theme.weightSemibold
        }

        Repeater {
            model: root.recent

            delegate: AssistantConversationRow {
                required property var modelData
                required property int index
                width: root.width - root.padding * 2
                radius: root.innerRadius
                row: modelData
                showPreview: index === 0
                onOpened: Assistant.openConversation(modelData.id)
            }
        }

        AssistantButton {
            anchors.right: parent.right
            visible: Assistant.conversations.length > root.recent.length
            label: I18n.format("All conversations (%1)", [Assistant.conversations.length])
            glyph: "arrow_forward"
            controlHeight: Theme.scaled(26)
            color: "transparent"
            onTriggered: Assistant.openHistory()
        }
    }

    // The service starts with the session; this is for one that stopped.
    AssistantButton {
        visible: !Assistant.connected
        label: I18n.tr("Start the assistant")
        glyph: "play_arrow"
        onTriggered: Assistant.fix("service")
    }

    // ---- how to talk ------------------------------------------------------------------
    Item {
        id: agentLine
        width: parent.width
        height: Theme.scaled(22)
        // Nothing to say takes no room.
        visible: !Assistant.setupRequired && hint.text !== ""

        Text {
            id: hint
            anchors.left: parent.left
            anchors.leftMargin: Theme.scaled(2)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            elide: Text.ElideRight
            text: Assistant.notice !== "" ? Assistant.notice
                : Assistant.busy ? I18n.tr("Wiz is still working on another question.")
                // The logo says who continues; the keys are as in a new box.
                : root.continuing && !root.listening && !root.transcribing ? ""
                : root.listening ? (Assistant.voiceLatched ? I18n.tr("Tap the microphone to send")
                    : I18n.tr("Release to send · Esc cancels"))
                : root.transcribing ? ""
                : Assistant.voiceAvailable ? I18n.tr("Hold Super+I to talk")
                : I18n.tr("Enter sends · Esc closes")
            color: Assistant.notice !== "" ? Theme.textMid : Theme.textFaint
            font.family: Theme.fontMenu
            font.pixelSize: Theme.typography.metadata
        }
    }

    // Dropped files and images go with the question.
    DropArea {
        parent: root
        anchors.fill: parent
        keys: ["text/uri-list"]
        onDropped: drop => {
            if (drop.hasUrls) {
                Assistant.attachUrls(drop.urls);
                drop.accept();
            }
        }
    }

    // The microphone's level, only while recording.
    PwObjectTracker {
        objects: root.listening && Pipewire.defaultAudioSource ? [Pipewire.defaultAudioSource] : []
    }

    PwNodePeakMonitor {
        id: peaks
        node: Pipewire.defaultAudioSource
        enabled: root.listening
    }
}
