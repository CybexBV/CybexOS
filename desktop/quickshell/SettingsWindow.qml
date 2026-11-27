import QtQuick
import "Common"
import "Settings" as SettingsUi

// AppWindow maps it on the output Settings was opened from, and maps it
// again when its window is gone.
AppWindow {
    id: window

    // Stable compositor target; the workspace header carries localized copy.
    title: "Cybex OS Settings" // i18n: untranslated (compositor identity)
    open: Settings.panelOpen
    openScreen: Screens.byName(Settings.panelScreenName) ?? Screens.focused
    color: Theme.panelSurface
    // 960 by 700 (2026-10 redesign): room for the rail's nineteen entries
    // without scrolling; smaller screens get a scrolling rail.
    implicitWidth: Math.min(Theme.scaled(960, Theme.contentScale),
        screen ? screen.width - Theme.panelPadding * 2 : 960)
    implicitHeight: Math.min(Theme.scaled(700),
        screen ? screen.height - Theme.barHeight - Theme.panelPadding * 2 : 700)
    minimumSize: Qt.size(480, 400)
    onClosed: Settings.closePanel()

    Connections {
        target: Settings

        function onPresentPanel() { window.present(); }
    }

    SettingsUi.SettingsView {
        id: view
        objectName: "settingsView"
        anchors.fill: parent
        implicitWidth: preferredWidth
        implicitHeight: preferredHeight
        availableWidth: window.width
        availableHeight: window.height
        onMoveRequested: window.startSystemMove()
        Keys.onEscapePressed: event => {
            if (!view.handleEscape())
                Settings.closePanel();
            event.accepted = true;
        }
    }

    // Pointer vs keyboard modality for focus rings (Common/FocusModality).
    FocusModalityObserver {}
}
