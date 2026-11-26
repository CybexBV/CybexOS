pragma ComponentBehavior: Bound
import QtQuick
import "../Common"

// Add an account (2026-11): the account kinds this computer's GNOME Online
// Accounts offers, in a sheet over Settings like Review changes. Google,
// Microsoft 365 and Nextcloud lead; the other kinds GOA installs follow
// under "Other accounts". Cybex OS orders and describes them itself (GOA's
// own provider groups are deprecated and would not give this split), and
// names only what the computer uses them for: calendars. Choosing one
// closes Settings and opens GOA's own sign-in dialog for that kind
// (SystemSettings.addAccount); the footer stays put while the list scrolls.
Item {
    id: root

    readonly property bool open: SystemSettings.accountPickerOpen
    readonly property var lead: ["google", "ms_graph", "owncloud"]
    readonly property var installed: SystemSettings.accountProviders
    readonly property var leading: lead.map(type => installed.find(p => p.type === type)).filter(p => p !== undefined)
    readonly property var order: ["imap_smtp", "webdav", "exchange", "kerberos"]
    readonly property var others: installed.filter(p => lead.indexOf(p.type) === -1)
        .sort((a, b) => rank(a) - rank(b))
    function rank(provider) {
        const at = order.indexOf(provider.type);
        return at === -1 ? order.length : at;
    }

    visible: open
    Accessible.role: Accessible.Dialog
    Accessible.name: I18n.tr("Add an account")

    function hide() {
        SystemSettings.accountPickerOpen = false;
    }
    onOpenChanged: {
        if (!open)
            return;
        SystemSettings.loadAccountProviders();
        Qt.callLater(() => cancelAction.forceActiveFocus());
    }

    // Brand names stay as they are; generic kinds get plain names.
    function label(provider) {
        return ({
            imap_smtp: I18n.tr("Email (IMAP and SMTP)"),
            webdav: I18n.tr("Calendar and contacts (WebDAV)"),
            kerberos: I18n.tr("Enterprise login (Kerberos)")
        })[provider.type] || provider.name || provider.type;
    }
    function detail(provider) {
        return ({
            google: I18n.tr("Signs in with your browser"),
            ms_graph: I18n.tr("Personal, work or school account. Signs in with your browser"),
            owncloud: I18n.tr("Your own Nextcloud server. Signs in with your browser"),
            exchange: I18n.tr("An Exchange server run by your organization"),
            imap_smtp: I18n.tr("Any mail server"),
            webdav: I18n.tr("A CalDAV or CardDAV server"),
            kerberos: I18n.tr("A Kerberos ticket from your organization")
        })[provider.type] || "";
    }
    function choose(provider) {
        SystemSettings.addAccount(provider.type, label(provider));
    }

    // Click outside to dismiss: the scrim is not a button, so no hand.
    Rectangle {
        anchors.fill: parent
        color: Theme.scrim
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.ArrowCursor
            onClicked: root.hide()
        }
    }

    Rectangle {
        id: sheet
        readonly property real pad: Theme.scaled(20)
        width: Math.min(Theme.scaled(560, Theme.typeScale), root.width - Theme.scaled(32))
        height: Math.min(heading.height + list.contentHeight + footer.height + pad * 2 + Theme.scaled(28),
            root.height - Theme.scaled(32))
        anchors.centerIn: parent
        radius: Theme.popRadius
        color: Theme.popBg
        border.width: 1
        border.color: Theme.hairline
        // Swallow clicks so they never reach the scrim's close.
        MouseArea { anchors.fill: parent }

        Column {
            id: heading
            x: sheet.pad
            y: sheet.pad
            width: sheet.width - sheet.pad * 2
            spacing: Theme.scaled(3)
            Text {
                text: I18n.tr("Add an account")
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.heading
                font.weight: Theme.weightSemibold
                color: Theme.textHi
            }
            Text {
                width: parent.width
                wrapMode: Text.Wrap
                text: I18n.tr("Choose the kind of account. Settings closes while you sign in, in a GNOME Online Accounts window and your browser, and comes back when you are done.")
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
                color: Theme.textFaint
            }
        }

        Flickable {
            id: list
            x: sheet.pad - Theme.scaled(8)
            y: heading.y + heading.height + Theme.scaled(14)
            width: sheet.width - (sheet.pad - Theme.scaled(8)) * 2
            height: Math.max(0, footer.y - y - Theme.scaled(14))
            contentHeight: rows.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
                id: rows
                width: list.width
                spacing: Theme.scaled(2)

                SettingsHint {
                    x: Theme.scaled(8)
                    width: parent.width - Theme.scaled(16)
                    visible: text !== ""
                    tone: SystemSettings.accountProvidersError !== "" ? "error" : "info"
                    text: SystemSettings.accountProvidersError !== "" ? SystemSettings.accountProvidersError
                        : !SystemSettings.accountProvidersLoaded ? I18n.tr("Loading account kinds…") : ""
                }
                Repeater {
                    model: root.leading
                    delegate: PickRow {}
                }
                Text {
                    visible: root.others.length > 0
                    x: Theme.scaled(10)
                    topPadding: Theme.scaled(10)
                    bottomPadding: Theme.scaled(4)
                    text: I18n.tr("Other accounts").toUpperCase()
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.metadata
                    font.weight: Theme.weightSemibold
                    font.letterSpacing: 1
                    color: Theme.textFaint
                }
                Repeater {
                    model: root.others
                    delegate: PickRow {}
                }
            }
        }

        Row {
            id: footer
            anchors.right: parent.right
            anchors.rightMargin: sheet.pad
            y: sheet.height - sheet.pad - height
            spacing: Theme.controlSpacing
            SettingsAction {
                id: cancelAction
                text: I18n.tr("Cancel")
                onTriggered: root.hide()
            }
        }
    }

    // One account kind: its mark, its name, what it is for.
    component PickRow: Rectangle {
        id: pick
        required property var modelData
        readonly property bool lit: pickMouse.containsMouse || activeFocus
        width: rows.width
        height: Theme.scaled(52)
        radius: Theme.chipRadius + 1
        color: pickMouse.containsMouse ? Theme.hoverFill : "transparent"
        border.width: Theme.focusWidth(activeFocus)
        border.color: Theme.focusRing
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: root.label(modelData)
        Accessible.description: root.detail(modelData)
        Accessible.onPressAction: root.choose(modelData)
        Keys.onReturnPressed: root.choose(modelData)
        Keys.onEnterPressed: root.choose(modelData)
        Keys.onSpacePressed: root.choose(modelData)

        AccountLogo {
            id: logo
            x: Theme.scaled(10)
            anchors.verticalCenter: parent.verticalCenter
            providerType: pick.modelData.type
        }
        Column {
            anchors.left: logo.right
            anchors.leftMargin: Theme.scaled(12)
            anchors.right: chevron.left
            anchors.rightMargin: Theme.controlSpacing
            anchors.verticalCenter: parent.verticalCenter
            spacing: 2
            Text {
                width: parent.width
                text: root.label(pick.modelData)
                elide: Text.ElideRight
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.primary
                font.weight: Theme.weightMedium
                color: Theme.textHi
            }
            Text {
                width: parent.width
                visible: text !== ""
                text: root.detail(pick.modelData)
                elide: Text.ElideRight
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
                color: Theme.textFaint
            }
        }
        Sym {
            id: chevron
            anchors.right: parent.right
            anchors.rightMargin: Theme.scaled(10)
            anchors.verticalCenter: parent.verticalCenter
            name: "chevron_right"
            size: Theme.iconSmall
            color: pick.lit ? Theme.textHi : Theme.textFaint
        }
        MouseArea {
            id: pickMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.choose(pick.modelData)
        }
    }

    Keys.onEscapePressed: event => {
        root.hide();
        event.accepted = true;
    }
}
