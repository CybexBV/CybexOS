import QtQuick
import Quickshell
import "../Common"

// An online-account provider's mark. Brand marks come from the icon theme:
// the official logos GNOME Online Accounts itself installs (goa-account-*),
// so they match the accounts goa-daemon reports and stay current with GOA.
// They are drawn as installed, without a tile of our own. Generic kinds
// (mail server, WebDAV, Kerberos) and unknown providers get a Tabler glyph
// on a chip. Only these names are looked up; nothing from D-Bus becomes a
// path. See assets/README.md (provider marks).
Item {
    id: root

    property string providerType: ""
    property real size: Theme.scaled(28)

    readonly property string iconName: ({
        google: "goa-account-google",
        ms_graph: "goa-account-ms365",
        owncloud: "goa-account-owncloud",
        exchange: "goa-account-exchange"
    })[providerType] || ""
    readonly property string glyph: ({
        imap_smtp: "inbox",
        webdav: "calendar",
        kerberos: "key"
    })[providerType] || "account_circle"
    readonly property bool branded: iconName !== "" && mark.status === Image.Ready

    implicitWidth: size
    implicitHeight: size
    Accessible.ignored: true

    Image {
        id: mark
        anchors.fill: parent
        visible: root.branded
        source: root.iconName !== "" ? Quickshell.iconPath(root.iconName, true) : ""
        sourceSize.width: Math.ceil(root.size * 2)
        sourceSize.height: Math.ceil(root.size * 2)
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
    }

    Rectangle {
        visible: !root.branded
        anchors.fill: parent
        radius: Theme.chipRadius
        color: Theme.chip

        Sym {
            anchors.centerIn: parent
            name: root.glyph
            size: Theme.iconSmall
            color: Theme.icon
        }
    }
}
