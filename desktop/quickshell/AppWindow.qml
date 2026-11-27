import QtQuick
import Quickshell
import Quickshell.Hyprland
import "Common"

// A shell app's own window (Settings, Software, Software Update): shown while
// its singleton's flag says the app is open, and closed through the same flag.
//
// `visible` is driven from `open`, never bound to it. Quickshell 0.3.2 hides
// and shows a window again when it is given another output while shown, and
// reports the hide as `closed`. An app that chose the focused output once its
// window was shown (Software Update 1.0.35) cleared its flag inside the
// binding that had just shown it: the window stayed while the app counted as
// closed, and once the compositor closed it, opening the app did nothing but
// ask Hyprland to focus a window that was gone. So the output is chosen only
// while the window is hidden, and opening checks the window that really
// exists: a hidden window, or one on an output that went away, is mapped
// again on the output the app opens on.
//
// A shown window keeps its output when outputs come and go: Qt moves it off
// one that disappears, and Hyprland moves the surface. The next opening
// chooses from the outputs there are then.
FloatingWindow {
    id: window

    // Whether the app is open. Bind it to the app's flag; clear that flag in
    // onClosed, which is how the compositor closing the window arrives.
    property bool open: false
    // The output to open on, read each time the window is mapped.
    property var openScreen: Screens.focused

    visible: false
    onOpenChanged: window.sync()
    Component.onCompleted: window.sync()

    // A window counts only while Qt shows it on an output that still exists.
    readonly property bool mapped: visible && Screens.hasBar(screen)

    function sync() {
        if (!window.open)
            window.visible = false;
        else if (!window.mapped)
            window.remap();
    }

    // Hidden first, so the output is never changed under a shown window and
    // a wish to show left over from a window that was taken away is cleared.
    function remap() {
        window.visible = false;
        const target = window.openScreen;
        if (target)
            window.screen = target;
        window.visible = true;
        window.minimized = false;
    }

    // The app was asked to open while open: bring its window forward, or map
    // it again when it is gone. Hyprland focuses a window as it maps, so only
    // one already there is focused by title.
    function present() {
        if (!window.open)
            return;
        if (!window.mapped) {
            window.remap();
            return;
        }
        window.minimized = false;
        Hyprland.dispatch('hl.dsp.focus({ window = "title:^' + window.title + '$" })');
    }
}
