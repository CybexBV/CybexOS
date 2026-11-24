import QtQuick
import "../Common"
// How a recovery point is used. The tab calls them recovery points
// throughout (2026-11-24 review); "NixOS generation", their technical name,
// appears only in the secondary line.
SettingsGroup {
    width: parent.width
    title: I18n.tr("Going back")
    SettingsHint {
        width: parent.width
        text: I18n.tr("Going back to a recovery point restores the system's programs and settings. Documents, passwords, VPN profiles, databases and plugin data are kept as they are; they do not go back.")
    }
    ValueRow {
        width: parent.width
        label: I18n.tr("Boot menu")
        hint: Updates.deployment.recovery || I18n.tr("Earlier recovery points are in the boot menu: press Esc while the computer starts. Each one is a NixOS system generation.")
        SettingsAction { text: I18n.tr("Update history"); onTriggered: Updates.openRecoveryPoints() }
    }
}
