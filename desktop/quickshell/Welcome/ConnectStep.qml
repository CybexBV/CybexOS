pragma ComponentBehavior: Bound
import QtQuick
import "../Common"
import "../Assistant" as Character
import "../Common/AssistantHelpers.js" as AssistantHelpers

// Connect: up to three optional sign-ins as installer cards. 1Password comes
// first, when it is installed, so it can fill in the passwords that follow in
// the browser; then the Google account in Chrome, when Chrome is installed;
// then the assistant, through Claude Code's or Codex's own sign-in. Each
// opens windows, so the guide steps aside: it comes back once the agent
// reports it is signed in, or when the 1Password or Chrome window is closed.
// Ticks come from live state only: the agent's sign-in, whether 1Password
// has an account, counted in its own database, and whether Chrome's profile
// is signed in to Google, from its Local State.
//
// The assistant's card shows Wiz himself: asleep until the agent is signed
// in, attentive while it signs in, happy once it has, sorry when its state
// could not be checked.
//
// Continue is the step's one primary button; the cards' buttons are
// secondary, and "Recommended" marks the assistant (2026-11-24 review: four
// blue buttons competed). Every sign-in needs the internet, so while the
// computer is known to be offline they are off and say why. Unknown is not
// offline: without NetworkManager's answer nothing is blocked.
Item {
    id: root
    readonly property bool online: EthernetState.connected || WifiState.connected || NetworkStatus.online
    readonly property bool offline: NetworkStatus.known && !root.online
    // The cards this computer shows, in order.
    readonly property var shown: [Welcome.passwordAvailable ? "password" : "", Welcome.googleAvailable ? "google" : "",
        Assistant.available ? "assistant" : ""].filter(id => id !== "")
    readonly property var installed: AssistantHelpers.AGENT_IDS.filter(id => (Assistant.agents[id] || {}).available === true)
    // The agents the copy names: the installed ones, or both when neither
    // is (the card then points to Software).
    readonly property var agentNames: (root.installed.length > 0 ? root.installed : AssistantHelpers.AGENT_IDS)
        .map(id => AssistantHelpers.AGENT_LABELS[id] || id)
    readonly property string agentPhrase: root.agentNames.length > 1
        ? I18n.format("%1 or %2", [root.agentNames[0], root.agentNames[1]]) : root.agentNames[0] || ""
    readonly property bool signingIn: Assistant.signingIn !== ""
    readonly property bool authUnknown: Assistant.agentInstalled && (Assistant.agents[Assistant.agent] || {}).auth === "unknown"
    readonly property string wizPose: !Assistant.connected || root.installed.length === 0 ? "asleep"
        : Assistant.agentReady ? "happy"
        : root.signingIn || (Assistant.authChecking && root.authUnknown) ? "listening"
        : root.authUnknown ? "sorry" : "asleep"
    Claim { active: root.visible; onClaimed: EthernetState.acquire(); onReleased: EthernetState.release() }
    Component.onCompleted: { Assistant.refreshAuth(); Welcome.refreshPassword(); Welcome.refreshGoogle(); }
    // A sign-in finished in 1Password or Chrome while the guide is showing
    // shows up too: Chrome saves its Local State some seconds later.
    Timer {
        readonly property bool password: Welcome.passwordOpened && !Welcome.passwordSignedIn
        readonly property bool google: Welcome.googleOpened && !Welcome.googleSignedIn
        interval: 4000
        repeat: true
        running: root.visible && !Welcome.aside && (password || google)
        onTriggered: {
            if (password) Welcome.refreshPassword();
            if (google) Welcome.refreshGoogle();
        }
    }
    // "01 · Password manager" when there is more than one card.
    function kicker(id, label) {
        return root.shown.length > 1 ? I18n.format("%1 · %2", ["0" + (root.shown.indexOf(id) + 1), label]) : label;
    }

    component ConnectCard: KioskCard {
        id: card
        property string kicker: ""
        property string title: ""
        property string body: ""
        property string glyph: ""
        // A Wiz pose: the card shows him instead of its icon badge.
        property string character: ""
        property string status: ""
        // accent (done), amber (needs something) or fog (waiting).
        property string statusTone: "fog"
        property string statusGlyph: ""
        property bool recommended: false
        default property alias actions: actionRow.data
        readonly property real contentHeight: texts.implicitHeight + actionRow.height + Kiosk.px(28 * 2 + 24)
        Column {
            id: texts
            x: Kiosk.px(28)
            y: Kiosk.px(28)
            width: card.width - Kiosk.px(56)
            Row {
                width: parent.width
                spacing: Kiosk.px(16)
                // The icon badge, or the room Wiz stands in: the kicker and
                // title move right, the text below starts under his feet.
                Item {
                    id: badge
                    width: Kiosk.px(card.character !== "" ? 64 : 48)
                    height: Kiosk.px(card.character !== "" ? 68 : 48)
                    Rectangle {
                        visible: card.character === ""
                        anchors.fill: parent
                        radius: Kiosk.px(14)
                        color: Kiosk.accentTint
                        KioskIcon { anchors.centerIn: parent; name: card.glyph; designSize: 24; color: Kiosk.accent }
                    }
                }
                Column {
                    width: parent.width - badge.width - parent.spacing
                    anchors.verticalCenter: parent.verticalCenter
                    // Three cards side by side leave a long kicker two lines.
                    KioskKicker {
                        width: parent.width
                        text: card.kicker
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                    Item { width: 1; height: Kiosk.px(4) }
                    KioskText {
                        width: parent.width
                        text: card.title
                        size: 22
                        font.weight: Font.Bold
                        elide: Text.ElideRight
                        Accessible.role: Accessible.Heading
                    }
                }
            }
            Item { width: 1; height: Kiosk.px(18) }
            KioskText { width: parent.width; text: card.body; size: 16; tone: "fog"; wrapMode: Text.WordWrap }
            Item { width: 1; height: Kiosk.px(16); visible: card.status !== "" }
            Row {
                visible: card.status !== ""
                width: parent.width
                spacing: Kiosk.px(10)
                KioskIcon {
                    id: statusIcon
                    name: card.statusGlyph
                    designSize: 18
                    color: card.statusTone === "accent" ? Kiosk.accent : card.statusTone === "amber" ? Kiosk.amber : Kiosk.fog
                }
                KioskText {
                    width: parent.width - statusIcon.width - parent.spacing
                    text: card.status
                    size: 15
                    tone: card.statusTone === "fog" ? "ink" : card.statusTone
                    wrapMode: Text.WordWrap
                }
            }
        }
        // On the card's top edge rather than in the kicker, where it wrapped
        // to a second line and pushed this card's title below the others.
        Rectangle {
            visible: card.recommended
            anchors.right: parent.right
            anchors.rightMargin: Kiosk.px(24)
            y: -height / 2
            width: badgeLabel.implicitWidth + Kiosk.px(20)
            height: Kiosk.px(24)
            radius: height / 2
            color: Kiosk.card
            border.width: Math.max(1, Kiosk.px(1))
            border.color: Kiosk.accentLine
            Rectangle { anchors.fill: parent; radius: parent.radius; color: Kiosk.accentSoft }
            KioskKicker {
                id: badgeLabel
                anchors.centerIn: parent
                text: I18n.tr("Recommended")
                size: 11
                tone: "accent"
            }
        }
        Flow {
            id: actionRow
            x: Kiosk.px(28)
            anchors.bottom: parent.bottom
            anchors.bottomMargin: Kiosk.px(28)
            width: card.width - Kiosk.px(56)
            spacing: Kiosk.px(12)
        }
        // Wiz in the card's top-left corner. Asleep, he snores: his own z's
        // rise beside his hat (Wiz.snoring, asked for only here; everywhere
        // else they stand still). With reduced motion they stand still too.
        Loader {
            active: card.character !== ""
            x: Kiosk.px(8)
            y: Kiosk.px(6)
            width: Kiosk.px(104)
            height: width
            sourceComponent: Character.Wiz {
                objectName: "connectWiz"
                pose: card.character
                snoring: true
            }
        }
    }

    Column {
        id: heading
        x: Kiosk.px(64)
        y: Kiosk.px(34)
        width: parent.width - Kiosk.px(128)
        spacing: Kiosk.px(8)
        KioskText {
            width: parent.width
            text: I18n.tr("Connect your accounts.")
            size: 40
            font.weight: Font.Bold
            font.letterSpacing: -Kiosk.px(1)
            elide: Text.ElideRight
            Accessible.role: Accessible.Heading
        }
        KioskText {
            width: parent.width
            text: root.shown.length === 3 ? I18n.tr("All three are optional. Start with 1Password, so it can fill in your passwords for the other two.")
                : Welcome.passwordAvailable && Assistant.available ? I18n.tr("Both are optional. Start with 1Password, so it can fill in the password for your AI account.")
                : Welcome.passwordAvailable && Welcome.googleAvailable ? I18n.tr("Both are optional. Start with 1Password, so it can fill in the password for your Google account.")
                : Welcome.googleAvailable && Assistant.available ? I18n.tr("Both are optional. Sign in to Google first if your AI account uses it.")
                : Assistant.available ? I18n.tr("Optional, and recommended: your assistant can then check this computer and help with what it finds.")
                : Welcome.googleAvailable ? I18n.tr("Optional: sign in to Chrome with your Google account.")
                : I18n.tr("Optional: sign in to 1Password if you use it.")
            size: 19
            tone: "fog"
            wrapMode: Text.WordWrap
        }
    }

    // Every sign-in needs the internet; say so before a button fails.
    Rectangle {
        id: offline
        x: Kiosk.px(64)
        anchors.top: heading.bottom
        anchors.topMargin: Kiosk.px(20)
        width: parent.width - Kiosk.px(128)
        height: root.offline ? Kiosk.px(52) : 0
        visible: root.offline
        radius: Kiosk.px(12)
        color: Kiosk.amberTint
        border.width: Math.max(1, Kiosk.px(1))
        border.color: Kiosk.amberLine
        Row {
            x: Kiosk.px(18)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Kiosk.px(12)
            KioskIcon { anchors.verticalCenter: parent.verticalCenter; name: "wifi_off"; color: Kiosk.amber }
            KioskText {
                anchors.verticalCenter: parent.verticalCenter
                text: I18n.tr("You are offline. Connect to a network to sign in.")
                size: 15
                tone: "amber"
            }
            KioskLink {
                anchors.verticalCenter: parent.verticalCenter
                text: I18n.tr("Connect")
                Accessible.name: I18n.tr("Connect to a network")
                onClicked: {
                    Welcome.stepAside(false);
                    Settings.showPanel("network");
                }
            }
        }
    }

    Row {
        id: cards
        // The cards share the tallest one's height, so their buttons line up.
        readonly property real cardHeight: Math.max(Kiosk.px(260), passwordCard.visible ? passwordCard.contentHeight : 0,
            googleCard.visible ? googleCard.contentHeight : 0, assistantCard.visible ? assistantCard.contentHeight : 0)
        readonly property real cardWidth: root.shown.length > 1
            ? (root.width - Kiosk.px(128) - spacing * (root.shown.length - 1)) / root.shown.length : Kiosk.px(720)
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: offline.bottom
        // Room above for the Recommended badge on the assistant's card.
        anchors.topMargin: Kiosk.px(root.offline ? 28 : 24)
        spacing: Kiosk.px(24)

        ConnectCard {
            id: passwordCard
            visible: Welcome.passwordAvailable
            width: cards.cardWidth
            height: cards.cardHeight
            glyph: "lock"
            kicker: root.kicker("password", I18n.tr("Password manager"))
            title: "1Password" // i18n: untranslated (brand)
            // Its extension in Chrome talks to the app, so the browser needs no sign-in of its own.
            body: Welcome.googleAvailable
                ? I18n.tr("If you use 1Password, sign in first. Its extension in Chrome can then fill in your passwords for what follows.")
                : I18n.tr("If you use 1Password, sign in first. It can then fill in your passwords for what follows, including your AI account.")
            status: Welcome.passwordSignedIn ? I18n.tr("Signed in to 1Password.")
                : root.offline ? I18n.tr("Signing in needs the internet.")
                : Welcome.passwordOpened ? I18n.tr("1Password is open. Sign in there, then close its window to come back.") : ""
            statusTone: Welcome.passwordSignedIn ? "accent" : "fog"
            statusGlyph: Welcome.passwordSignedIn ? "check" : root.offline ? "wifi_off" : "open_in_new"
            KioskButton {
                objectName: "connectPassword"
                text: Welcome.passwordOpened && !Welcome.passwordSignedIn ? I18n.tr("Open 1Password again") : I18n.tr("Open 1Password")
                enabled: Welcome.passwordSignedIn || !root.offline
                onClicked: Welcome.openPassword()
            }
        }

        ConnectCard {
            id: googleCard
            visible: Welcome.googleAvailable
            width: cards.cardWidth
            height: cards.cardHeight
            glyph: "account_circle"
            kicker: root.kicker("google", I18n.tr("Browser"))
            title: I18n.tr("Google account")
            body: I18n.tr("Sign in to Chrome with your Google account. Your bookmarks, passwords and history come along and stay in sync.")
            status: Welcome.googleSignedIn ? (Welcome.googleAccount.account !== ""
                    ? I18n.format("Signed in to Chrome as %1.", [Welcome.googleAccount.account]) : I18n.tr("Signed in to Chrome."))
                : root.offline ? I18n.tr("Signing in needs the internet.")
                : Welcome.googleOpened ? I18n.tr("Chrome is open. Sign in there, then close its window to come back.") : ""
            statusTone: Welcome.googleSignedIn ? "accent" : "fog"
            statusGlyph: Welcome.googleSignedIn ? "check" : root.offline ? "wifi_off" : "open_in_new"
            KioskButton {
                objectName: "connectGoogle"
                text: Welcome.googleSignedIn ? I18n.tr("Open Chrome")
                    : Welcome.googleOpened ? I18n.tr("Open Chrome again") : I18n.tr("Sign in to Chrome")
                enabled: Welcome.googleSignedIn || !root.offline
                onClicked: Welcome.openGoogle()
            }
        }

        ConnectCard {
            id: assistantCard
            visible: Assistant.available
            width: cards.cardWidth
            height: cards.cardHeight
            character: root.wizPose
            recommended: true
            kicker: root.kicker("assistant", I18n.tr("AI assistant"))
            title: I18n.tr("Cybex OS Assistant")
            // Names only the agents this computer offers.
            body: I18n.format("Sign in with %1. Your assistant can then check this computer for missing drivers and other problems, and fix what it finds once you agree.",
                [root.agentPhrase])
            readonly property bool waitsForNetwork: root.offline && Assistant.connected && root.installed.length > 0
                && !Assistant.agentReady && !root.signingIn
            status: !Assistant.connected ? I18n.tr("The assistant service is not running.")
                : root.installed.length === 0 ? I18n.tr("Claude Code and Codex are not installed. Add one in Software.")
                : Assistant.agentReady ? I18n.format("Connected with %1.", [Assistant.agentLabel])
                : root.signingIn ? I18n.tr("Finish signing in in your browser. The guide comes back by itself.")
                : assistantCard.waitsForNetwork ? I18n.tr("Signing in needs the internet.")
                : root.authUnknown ? I18n.tr("Sign-in status could not be checked.")
                : ""
            statusTone: Assistant.connected && Assistant.agentReady ? "accent" : root.signingIn || assistantCard.waitsForNetwork ? "fog" : "amber"
            statusGlyph: Assistant.connected && Assistant.agentReady ? "check" : root.signingIn ? "progress_activity"
                : assistantCard.waitsForNetwork ? "wifi_off" : "warning"

            KioskButton {
                visible: !Assistant.connected
                text: I18n.tr("Start the assistant")
                onClicked: Assistant.fix("service")
            }
            KioskButton {
                visible: Assistant.connected && root.installed.length === 0
                text: I18n.tr("Open Software")
                onClicked: {
                    Welcome.stepAside(false);
                    Software.show();
                }
            }
            // One button per installed agent. The one in use when signed in
            // is not repeated; another signed-in agent can be chosen instead.
            Repeater {
                model: Assistant.connected ? root.installed : []
                delegate: KioskButton {
                    id: agentButton
                    required property string modelData
                    required property int index
                    readonly property bool ready: (Assistant.agents[modelData] || {}).auth === "ready"
                    readonly property string label: AssistantHelpers.AGENT_LABELS[modelData] || modelData
                    objectName: "connectAgent-" + modelData
                    visible: !(Assistant.agentReady && Assistant.agent === modelData)
                    // Choosing an agent already signed in needs no network.
                    enabled: !Assistant.authChecking && !root.signingIn && !Assistant.busy && (ready || !root.offline)
                    text: ready ? I18n.format("Use %1", [label]) : I18n.format("Sign in to %1", [label])
                    onClicked: {
                        if (agentButton.ready)
                            Settings.set("assistantAgent", agentButton.modelData);
                        else
                            Welcome.signIn(agentButton.modelData);
                    }
                }
            }
            // A sign-in waiting in the background is checked every few
            // seconds, so Check gives way to Cancel: a page closed in the
            // browser would otherwise hold the buttons for five minutes.
            KioskButton {
                visible: Assistant.connected && root.authUnknown && !root.signingIn
                small: true
                text: Assistant.authChecking ? I18n.tr("Checking sign-in…") : I18n.tr("Check sign-in")
                enabled: !Assistant.authChecking
                onClicked: Assistant.refreshAuth()
            }
            KioskButton {
                objectName: "connectCancelSignIn"
                visible: Assistant.connected && root.signingIn
                small: true
                text: I18n.tr("Cancel sign-in")
                onClicked: Assistant.cancelSignIn()
            }
        }
    }

    KioskText {
        anchors.top: cards.bottom
        anchors.topMargin: Kiosk.px(16)
        anchors.horizontalCenter: parent.horizontalCenter
        width: cards.width
        text: Assistant.available ? I18n.format("Your sign-in stays with %1; Cybex OS never stores it. A check sends what it finds to your AI provider only when you ask.",
                [root.agentPhrase])
            : Welcome.passwordAvailable ? I18n.tr("Your passwords stay in 1Password; Cybex OS never sees them.")
            : I18n.tr("Your Google account stays with Chrome; Cybex OS never sees it.")
        size: 14
        tone: "faint"
        wrapMode: Text.WordWrap
    }

    KioskFooter {
        anchors.bottom: parent.bottom
        width: parent.width
        onNext: Welcome.move(1)
        KioskText {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            text: Welcome.error !== "" ? Welcome.error : I18n.tr("You can sign in later too, from the assistant’s menubar button.")
            size: 14
            tone: Welcome.error !== "" ? "red" : "faint"
            elide: Text.ElideRight
        }
    }
}
