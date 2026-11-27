import QtQuick
import "Common"
import "Software" as SoftwareUi

// Software: Explore, install and remove native apps. Opened from the
// launcher, Settings → Applications and `cybexos-software`. Every install is
// one checked, prebuilt system change; closing the window never interrupts it.
// AppWindow maps it, and maps it again when its window is gone.
AppWindow {
    id: window

    title: "Cybex OS Software" // i18n: untranslated (compositor identity)
    open: Software.open
    color: Theme.panelSurface
    // The window opens on the focused output; size it for that one.
    readonly property var output: Screens.focused
    implicitWidth: Math.min(Theme.scaled(1100, Theme.contentScale),
        output ? output.width - Theme.panelPadding * 2 : 1100)
    implicitHeight: Math.min(Theme.scaled(740),
        output ? output.height - Theme.barHeight - Theme.panelPadding * 2 : 740)
    minimumSize: Qt.size(760, 520)
    onClosed: Software.close()

    Connections {
        target: Software
        function onPresent() { window.present(); }
    }

    SoftwareUi.SoftwareView {
        anchors.fill: parent
        focus: true
    }

    // Pointer vs keyboard modality for focus rings (Common/FocusModality).
    FocusModalityObserver {}
}
