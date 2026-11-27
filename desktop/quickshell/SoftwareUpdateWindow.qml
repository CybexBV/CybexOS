import QtQuick
import "Common"
import "SoftwareUpdate" as SoftwareUpdateUi

// Software Update: opened from the menubar indicator, Control Center and the
// launcher. Closing it never interrupts an update; the worker owns that.
// AppWindow maps it, and maps it again when its window is gone.
AppWindow {
    id: window

    title: "Software Update" // i18n: untranslated (compositor identity)
    open: Updates.appOpen
    color: Theme.panelSurface
    implicitWidth: Math.min(Theme.scaled(720, Theme.contentScale),
        screen ? screen.width - Theme.panelPadding * 2 : 720)
    implicitHeight: Math.min(Theme.scaled(700),
        screen ? screen.height - Theme.barHeight - Theme.panelPadding * 2 : 700)
    minimumSize: Qt.size(600, 460)
    onClosed: Updates.close()

    Connections {
        target: Updates
        function onPresent() { window.present(); }
    }

    // Escape steps back from What's New first, then closes.
    SoftwareUpdateUi.UpdateView {
        objectName: "updateView"
        anchors.fill: parent
        focus: true
        Keys.onEscapePressed: {
            if (Updates.whatsNew !== null) Updates.closeWhatsNew();
            else Updates.close();
        }
    }

    // Pointer vs keyboard modality for focus rings (Common/FocusModality).
    FocusModalityObserver {}
}
