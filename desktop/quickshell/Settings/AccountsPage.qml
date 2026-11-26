pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import "../Common"

// Online accounts: the GNOME Online Accounts on this computer, and whether
// Cybex OS reads their calendars. Add account opens Settings' own picker
// (AccountPicker); signing in, and Reconnect, open GOA's own dialog for that
// one provider or account through cybexos-goa-account (SystemSettings), with
// Settings out of the way until the result comes back. This page lists what
// is connected, says how the last sign-in went, and removes.
//
// Status is hint text, not a standing control: loading and updating are
// read on the page, and an error brings its own Refresh.
SettingsPage {
    id: page
    readonly property SystemSettingsBackend service: SystemSettings.accounts
    readonly property var accounts: service.snapshot.accounts || []
    readonly property bool available: service.snapshot.available !== false
    readonly property bool signingIn: SystemSettings.accountTaskRunning
    // Room for the provider's mark before an account's rows.
    readonly property real logoSize: Theme.scaled(28)
    readonly property real logoIndent: logoSize + Theme.scaled(10)
    property string removing: ""

    Claim {
        active: page.visible && Settings.panelOpen
        onClaimed: page.service.acquire()
        onReleased: {
            page.removing = "";
            SystemSettings.accountPickerOpen = false;
            page.service.release();
        }
    }

    function addAccount() {
        if (available && !SystemSettings.externalBusy)
            SystemSettings.accountPickerOpen = true;
    }

    Column {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Theme.settingsGroupSpacing

        SettingsGroup {
            width: parent.width
            title: I18n.tr("Online accounts")

            // The group's note, clear of the rule that opens the first row.
            Item {
                width: parent.width
                height: note.height + Theme.settingsContentSpacing

                SettingsHint {
                    id: note
                    width: parent.width
                    maximumLines: 5
                    text: I18n.tr("Connect an account to show its calendars in Cybex OS. GNOME Online Accounts keeps your accounts; signing in happens in its window and your browser.")
                }
            }
            SettingsHint {
                width: parent.width
                text: page.service.error !== "" ? ""
                    : page.service.busy ? I18n.tr("Updating…")
                    : !page.service.loaded ? I18n.tr("Loading accounts…")
                    : !page.available ? page.service.snapshot.message || I18n.tr("Online account services are not installed.") : ""
            }
            // How the last sign-in went, until the next one starts.
            SettingsHint {
                objectName: "accountNotice"
                width: parent.width
                visible: text !== "" && !page.signingIn
                tone: SystemSettings.accountNoticeTone
                text: SystemSettings.accountNotice
            }
            ValueRow {
                width: parent.width
                visible: page.signingIn
                label: I18n.tr("Signing in")
                hint: I18n.tr("Finish in the GNOME Online Accounts window.")

                SettingsAction {
                    text: I18n.tr("Cancel")
                    enabled: !SystemSettings.accountTaskCancelling
                    onTriggered: SystemSettings.cancelAccountTask()
                }
            }
            ValueRow {
                width: parent.width
                visible: page.service.error !== ""
                label: I18n.tr("Status")
                hint: page.service.error
                hintTone: "error"

                SettingsAction {
                    text: I18n.tr("Refresh")
                    glyph: "refresh"
                    enabled: !page.service.busy && !page.service.loading
                    onTriggered: {
                        page.service.error = "";
                        page.service.refresh();
                    }
                }
            }

            ValueRow {
                width: parent.width
                visible: page.service.loaded && page.accounts.length === 0
                label: I18n.tr("No accounts connected")

                SettingsAction {
                    text: I18n.tr("Add account")
                    glyph: "add"
                    primary: true
                    enabled: page.available && !SystemSettings.externalBusy
                    onTriggered: page.addAccount()
                }
            }

            Repeater {
                model: ScriptModel { values: page.accounts.map(a => a.id) }

                delegate: RowCluster {
                    id: account
                    required property string modelData
                    readonly property var info: page.accounts.find(a => a.id === modelData)
                        || {id: "", provider: "", providerType: "", identity: "", locked: true, attention: false, calendar: false, calendarDisabled: true}
                    readonly property bool confirming: page.removing === info.id
                    readonly property bool reconnecting: page.signingIn
                        && SystemSettings.accountTaskKind === "reconnect" && SystemSettings.accountTaskTarget === info.id
                    width: parent.width

                    // The provider's mark, then the account's rows beside it.
                    Item {
                        width: parent.width
                        height: accountRow.height

                        AccountLogo {
                            x: Theme.settingsMarkInset
                            y: Math.max(0, (accountRow.lineHeight - height) / 2)
                            size: page.logoSize
                            providerType: account.info.providerType || ""
                        }
                        ValueRow {
                            id: accountRow
                            x: page.logoIndent
                            width: parent.width - x
                            label: account.info.identity || account.info.provider
                            hint: [account.info.provider,
                                account.info.locked ? I18n.tr("Managed by your administrator")
                                : account.info.attention ? I18n.tr("Needs attention: sign in again")
                                : I18n.tr("Connected")].filter(part => part !== "").join(" · ")
                            hintTone: account.info.attention && !account.info.locked ? "warning" : "info"

                            SettingsAction {
                                visible: account.info.attention && !account.info.locked
                                text: I18n.tr("Reconnect")
                                glyph: "refresh"
                                enabled: !SystemSettings.externalBusy
                                Accessible.name: "Reconnect " + (account.info.identity || account.info.provider)
                                onTriggered: SystemSettings.reconnectAccount(account.info.id,
                                    account.info.identity || account.info.provider)
                            }
                            SettingsAction {
                                visible: !account.info.locked && !account.confirming
                                text: I18n.tr("Remove…")
                                glyph: "delete"
                                danger: true
                                enabled: !page.service.busy && !account.reconnecting
                                Accessible.name: "Remove " + account.info.identity + " from this computer"
                                onTriggered: page.removing = account.info.id
                            }
                        }
                    }
                    SwitchRow {
                        x: page.logoIndent
                        width: parent.width - x
                        divider: false
                        visible: account.info.calendar
                        label: I18n.tr("Use calendars")
                        accessibleName: "Use calendars from " + (account.info.identity || account.info.provider)
                        checked: !account.info.calendarDisabled
                        disabledReason: account.info.locked ? I18n.tr("Managed account")
                            : account.reconnecting ? I18n.tr("Signing in…")
                            : page.service.busy ? I18n.tr("Updating…") : ""
                        onToggled: value => page.service.run({action: "calendar", id: account.info.id, enabled: value})
                    }
                    ValueRow {
                        x: page.logoIndent
                        width: parent.width - x
                        divider: false
                        visible: account.confirming
                        label: I18n.tr("Remove from this computer?")
                        hint: account.info.identity
                            ? I18n.format("Other applications on this computer also lose access to %1. The online account and its data stay.", [account.info.identity])
                            : I18n.tr("Other applications on this computer also lose access to this account. The online account and its data stay.")
                        hintTone: "warning"

                        SettingsAction {
                            text: I18n.tr("Remove account")
                            danger: true
                            enabled: !page.service.busy
                            onTriggered: {
                                page.service.run({action: "remove", id: account.info.id, confirmed: true});
                                page.removing = "";
                            }
                        }
                        SettingsAction {
                            text: I18n.tr("Cancel")
                            onTriggered: page.removing = ""
                        }
                    }
                }
            }

            // With accounts listed, adding another is no longer the page's
            // one job, so the button stops leading.
            ValueRow {
                width: parent.width
                visible: page.accounts.length > 0
                label: I18n.tr("Connect another account")

                SettingsAction {
                    text: I18n.tr("Add account")
                    glyph: "add"
                    enabled: page.available && !SystemSettings.externalBusy
                    onTriggered: page.addAccount()
                }
            }
        }
    }
}
