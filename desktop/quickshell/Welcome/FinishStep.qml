pragma ComponentBehavior: Bound
import QtQuick
import "../Common"
import "../Assistant" as Character

// Ready, as the installer's done screen: the headline, three cards that
// recap the choices, what the system check found, and the optional extras
// as pills. Each extra opens its Settings page and the guide steps aside; a
// tick shows what the live backends report as done. Wiz stands in the
// system check's card and shows how it went; finishing hands him over to
// the assistant's corner (WelcomeWindow).
//
// Each finding names where it is fixed, as Settings' Home does: Software
// Update for firmware, its Settings page for disk space, battery, sound and
// the clock. Drivers and the rest have no page of their own; Ask Wiz, the
// card's secondary action, takes those (2026-11-24 review: the only action
// was "Connect the assistant", and Ready had two blue buttons).
Item {
    id: root
    readonly property Character.Wiz perch: wiz
    readonly property var labels: ({webapps: I18n.tr("Web apps"),
        fingerprint: I18n.tr("Fingerprint"), security: I18n.tr("Security keys"), backup: I18n.tr("Backups"),
        accounts: I18n.tr("Online accounts")})
    readonly property var glyphs: ({webapps: "web", fingerprint: "passkey", security: "key",
        backup: "archive", accounts: "account_circle"})
    readonly property string colours: Settings.paletteMode === "wallpaper" ? I18n.tr("wallpaper colours")
        : Themes.current.value !== "" && !Themes.current.modified ? I18n.format("%1 theme", [Themes.current.label])
        : I18n.tr("your own accent")
    readonly property string textSize: Settings.textScale === "large" ? I18n.tr("Large text")
        : Settings.textScale === "larger" ? I18n.tr("Larger text") : I18n.tr("Default text")
    Component.onCompleted: { Backup.refresh(); Doctor.refreshIfStale(); if (!Themes.loaded) Themes.refresh(); }
    // The Settings page that fixes a finding; firmware goes to Software Update.
    readonly property var checkPages: ({storage: "storage", battery: "power", audio: "sound", time: "region"})
    function placeLabel(id) {
        switch (id) {
        case "firmware-updates": return I18n.tr("Software Update…");
        case "storage": return I18n.tr("Disk space…");
        case "battery": return I18n.tr("Power…");
        case "audio": return I18n.tr("Sound…");
        case "time": return I18n.tr("Region…");
        }
        // A finding no page fixes (a graphics driver, say) gets Wiz on its
        // own row once he is signed in, rather than a blank row end
        // (2026-11-24 review, round 2).
        return Assistant.agentReady ? I18n.tr("Ask Wiz") : "";
    }
    function openPlace(id) {
        if (id === "firmware-updates") {
            Welcome.stepAside(false);
            Updates.show();
        } else if (root.checkPages[id] !== undefined) {
            Welcome.stepAside(false);
            Settings.showPanel(root.checkPages[id]);
        } else if (Assistant.agentReady && !Assistant.busy) {
            Welcome.stepAside(false);
            Assistant.checkSystem();
        }
    }
    Claim { active: root.visible; onClaimed: SystemSettings.security.acquire(); onReleased: SystemSettings.security.release() }
    Claim { active: root.visible; onClaimed: SystemSettings.accounts.acquire(); onReleased: SystemSettings.accounts.release() }

    // The step's name above its summary, without a number: Ready recaps
    // three of the stepper's steps, so 01–03 disagreed with it. The text
    // starts at the same height in every card, so the three line up even
    // when one title takes two lines.
    component Recap: KioskCard {
        id: recap
        property string kicker: ""
        property string title: ""
        property string detail: ""
        default property alias visual: visualSlot.data
        readonly property real contentHeight: texts.implicitHeight + Kiosk.px(44)
        width: (summary.width - Kiosk.px(28)) / 3
        height: summary.cardHeight
        Column {
            id: texts
            anchors.left: parent.left
            anchors.leftMargin: Kiosk.px(22)
            anchors.right: visualSlot.left
            anchors.rightMargin: Kiosk.px(14)
            anchors.top: parent.top
            anchors.topMargin: Kiosk.px(22)
            KioskText { width: parent.width; text: recap.kicker; mono: true; size: 13; font.weight: Font.DemiBold; tone: "accent"; elide: Text.ElideRight }
            Item { width: 1; height: Kiosk.px(8) }
            KioskText { width: parent.width; text: recap.title; size: 18; font.weight: Font.Bold; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight }
            Item { width: 1; height: Kiosk.px(4) }
            KioskText { width: parent.width; text: recap.detail; size: 14.5; tone: "fog"; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight }
        }
        Item {
            id: visualSlot
            anchors.right: parent.right
            anchors.rightMargin: Kiosk.px(22)
            anchors.verticalCenter: parent.verticalCenter
            width: childrenRect.width
            height: childrenRect.height
        }
    }

    Column {
        id: page
        anchors.horizontalCenter: parent.horizontalCenter
        // Centred when there is room; three findings take most of it.
        y: Math.max(Kiosk.px(20), Math.min(Kiosk.px(40), (root.height - page.implicitHeight) / 2))
        width: Kiosk.px(1000)
        spacing: 0
        KioskText {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: I18n.format("You’re all set, %1.", [Welcome.firstName])
            size: 50
            font.weight: Font.Bold
            font.letterSpacing: -Kiosk.px(1.2)
            elide: Text.ElideRight
            Accessible.role: Accessible.Heading
        }
        Item { width: 1; height: Kiosk.px(12) }
        KioskText {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: I18n.tr("Your choices are live. You will find every one of them again in Settings.")
            size: 19
            tone: "fog"
            wrapMode: Text.WordWrap
        }
        Item { width: 1; height: Kiosk.px(26) }
        Row {
            id: summary
            // The three cards share the tallest card's height.
            readonly property real cardHeight: Math.max(Kiosk.px(116), wallpaperRecap.contentHeight,
                styleRecap.contentHeight, shortcutsRecap.contentHeight)
            width: parent.width
            spacing: Kiosk.px(14)
            Recap {
                id: wallpaperRecap
                kicker: I18n.tr("Wallpaper")
                title: Welcome.wallpaperName
                detail: Welcome.wallpaperSource === "wallhaven" ? I18n.tr("From Wallhaven")
                    : Welcome.wallpaperSource === "none" ? I18n.tr("Choose a wallpaper") : I18n.tr("From your pictures")
                Rectangle {
                    width: Kiosk.px(76)
                    height: Kiosk.px(50)
                    radius: Kiosk.px(9)
                    color: Kiosk.bgDeep
                    clip: true
                    Image {
                        anchors.fill: parent
                        source: Wallpaper.current
                        asynchronous: true
                        fillMode: Image.PreserveAspectCrop
                        sourceSize.width: 200
                    }
                    Rectangle {
                        anchors.fill: parent
                        radius: parent.radius
                        color: "transparent"
                        border.width: Math.max(1, Kiosk.px(1))
                        border.color: Kiosk.line2
                    }
                }
            }
            Recap {
                id: styleRecap
                kicker: I18n.tr("Style")
                title: I18n.format("%1, %2", [Settings.themeMode === "light" ? I18n.tr("Light") : I18n.tr("Dark"), root.colours])
                detail: I18n.format("%1 · glass %2", [root.textSize, Settings.glassEnabled && !Settings.highContrast ? I18n.tr("on") : I18n.tr("off")])
                Rectangle {
                    width: Kiosk.px(34)
                    height: width
                    radius: width / 2
                    color: Theme.accent
                    border.width: Math.max(1, Kiosk.px(1))
                    border.color: "#24ffffff"
                }
            }
            Recap {
                id: shortcutsRecap
                kicker: I18n.tr("Shortcuts")
                title: I18n.tr("Super + K shows them all")
                detail: I18n.tr("Change any in Settings")
                KioskKeycap { text: "K" } // i18n: untranslated (key name)
            }
        }
        Item { width: 1; height: Kiosk.px(22) }
        // What the system check found, in the shell's own words, so it reads
        // the same without an AI account: the findings, each with the place
        // that fixes it, and Ask Wiz for all of them. The guide steps aside
        // for either.
        KioskCard {
            id: check
            readonly property bool waiting: Doctor.running || (Doctor.report === null && Doctor.error === "")
            readonly property bool failed: Doctor.report === null && !waiting
            readonly property int count: Doctor.attention.length
            // Three rows fit the canvas; with more, two and a count.
            readonly property var shown: Doctor.attention.slice(0, count > 3 ? 2 : 3)
            width: parent.width
            height: Math.max(Kiosk.px(104), checkBody.implicitHeight + Kiosk.px(36))
            Accessible.role: Accessible.Grouping
            Accessible.name: I18n.tr("System check")
            // In the card, where its icon would be: he thinks while the
            // check runs, is sorry when it could not, happy when all is well
            // and waits for you when there is something to look at.
            Character.Wiz {
                id: wiz
                objectName: "readyWiz"
                x: Kiosk.px(10)
                y: Kiosk.px(4)
                width: Kiosk.px(96)
                height: width
                // The hand-off's Wiz takes his place.
                visible: Welcome.handOff === ""
                pose: check.waiting ? "thinking" : Doctor.report === null ? "sorry"
                    : check.count === 0 ? "happy" : "needs-input"
            }
            Column {
                id: checkBody
                x: Kiosk.px(118)
                y: Kiosk.px(18)
                width: parent.width - x - Kiosk.px(22)
                Item {
                    width: parent.width
                    height: Math.max(Kiosk.px(68), headline.implicitHeight)
                    Column {
                        id: headline
                        anchors.left: parent.left
                        anchors.right: checkAction.left
                        anchors.rightMargin: Kiosk.px(16)
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Kiosk.px(2)
                        KioskText {
                            width: parent.width
                            text: check.waiting ? I18n.tr("Checking this computer…")
                                : check.failed ? I18n.tr("The system check could not run")
                                : check.count === 0 ? I18n.tr("This computer looks good")
                                : check.count === 1 ? I18n.tr("1 thing to look at")
                                : I18n.format("%1 things to look at", [check.count])
                            size: 17
                            font.weight: Font.Bold
                            elide: Text.ElideRight
                            Accessible.role: Accessible.Heading
                        }
                        KioskText {
                            width: parent.width
                            text: check.waiting ? I18n.tr("Drivers, services, sound, storage and firmware.")
                                : check.failed ? Doctor.error
                                : check.count === 0 ? I18n.tr("Drivers, services, sound, storage and firmware were checked.")
                                : I18n.tr("Found by the system check")
                            size: 14
                            tone: "fog"
                            elide: Text.ElideRight
                        }
                    }
                    Item {
                        id: checkAction
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        width: childrenRect.width
                        height: childrenRect.height
                        KioskButton {
                            objectName: "readyAskAssistant"
                            visible: Assistant.agentReady && check.count > 0
                            small: true
                            icon: "sparkles"
                            text: I18n.tr("Ask Wiz")
                            Accessible.description: I18n.tr("Wiz explains what the check found and helps fix it.")
                            enabled: !Assistant.busy
                            onClicked: {
                                Welcome.stepAside(false);
                                Assistant.checkSystem();
                            }
                        }
                        KioskLink {
                            objectName: "readyConnectAssistant"
                            visible: Assistant.available && !Assistant.agentReady && check.count > 0
                            text: I18n.tr("Connect the assistant")
                            onClicked: Welcome.leave("connect")
                        }
                        KioskLink {
                            visible: check.failed
                            text: I18n.tr("Try again")
                            onClicked: Doctor.refresh()
                        }
                    }
                }
                Repeater {
                    model: check.waiting || check.failed ? [] : check.shown
                    delegate: Item {
                        id: finding
                        required property var modelData
                        readonly property string place: root.placeLabel(modelData.id)
                        width: checkBody.width
                        height: Kiosk.px(34)
                        Rectangle { width: parent.width; height: Math.max(1, Kiosk.px(1)); color: Kiosk.line }
                        KioskIcon {
                            id: findingIcon
                            anchors.verticalCenter: parent.verticalCenter
                            name: "warning"
                            designSize: 16
                            color: finding.modelData.state === "problem" ? Kiosk.red : Kiosk.amber
                        }
                        KioskText {
                            anchors.left: findingIcon.right
                            anchors.leftMargin: Kiosk.px(10)
                            anchors.right: placeLink.visible ? placeLink.left : parent.right
                            anchors.rightMargin: placeLink.visible ? Kiosk.px(16) : 0
                            anchors.verticalCenter: parent.verticalCenter
                            text: Doctor.sentence(finding.modelData)
                            size: 15
                            elide: Text.ElideRight
                        }
                        KioskLink {
                            id: placeLink
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            // Sized by its text alone: binding width to
                            // visibility here looped (Binding loop on width).
                            visible: finding.place !== ""
                            text: finding.place
                            onClicked: root.openPlace(finding.modelData.id)
                        }
                    }
                }
                KioskText {
                    visible: !check.waiting && !check.failed && check.count > check.shown.length
                    topPadding: Kiosk.px(4)
                    text: I18n.format("And %1 more", [check.count - check.shown.length])
                    size: 14
                    tone: "faint"
                }
            }
        }
        Item { width: 1; height: Kiosk.px(26) }
        KioskKicker {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: I18n.tr("Whenever you like · optional")
        }
        Item { width: 1; height: Kiosk.px(14) }
        // Up to five extras in one centred row, more in two balanced rows.
        Column {
            id: extras
            readonly property var items: Welcome.checklist
            readonly property int split: items.length <= 5 ? items.length : Math.ceil(items.length / 2)
            width: parent.width
            spacing: Kiosk.px(10)
            Repeater {
                model: extras.split < extras.items.length ? [extras.items.slice(0, extras.split), extras.items.slice(extras.split)]
                    : [extras.items]
                delegate: Row {
                    id: extraRow
                    required property var modelData
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Kiosk.px(10)
                    Repeater {
                        model: extraRow.modelData
                        delegate: KioskChip {
                            required property var modelData
                            large: true
                            icon: root.glyphs[modelData.id] || "circle"
                            text: root.labels[modelData.id] || modelData.id
                            done: modelData.done === true
                            Accessible.name: done ? I18n.format("%1: %2", [text, I18n.tr("Done")]) : text
                            onClicked: {
                                Welcome.stepAside(false);
                                Settings.showPanel(modelData.page);
                            }
                        }
                    }
                }
            }
        }
        Item { width: 1; height: Kiosk.px(10) }
        KioskText {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: I18n.tr("Each one opens its page in Settings. The guide steps aside while you are there.")
            size: 14
            tone: "faint"
            wrapMode: Text.WordWrap
        }
        Item { width: 1; height: Kiosk.px(22) }
        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Kiosk.px(14)
            KioskButton {
                text: I18n.tr("Back")
                onClicked: Welcome.move(-1)
            }
            KioskButton {
                kind: "primary"
                text: I18n.tr("Start using Cybex OS")
                icon: "chevron_right"
                iconRight: true
                onClicked: Welcome.finish()
            }
        }
        Item { width: 1; height: Kiosk.px(14) }
        KioskText {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            visible: text !== ""
            text: Welcome.error
            size: 14
            tone: "red"
            wrapMode: Text.WordWrap
        }
    }
}
