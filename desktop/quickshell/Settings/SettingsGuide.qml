pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls as Controls
import "../Common"
import "../Common/SettingsGuide.js" as Guide
import "../Assistant" as AssistantUi

// "Show me where" (docs/assistant.md): while Settings.guideKey names a row,
// a small Wiz stands beside it and points at it, and a ring marks the row.
// The assistant's settings_show starts a guide (Settings.showGuide); it ends
// when the person changes that setting, leaves the page, closes Settings or
// Settings.guideTimeout passes, and here when the row goes away.
//
// He arrives (a short drop and a landing), then holds the pointing pose
// still: once he has settled nothing animates and no frame is drawn for him
// until something moves the row. Reduced motion puts him there at once.
// Common/SettingsGuide.js chooses where he stands so he never covers the
// row's label or control. Nothing of him exists between guides.
//
// The layer lies over the whole Settings view, under its palette and the
// review sheet; for a row in a widget's dialog it moves to the window's
// popup overlay, above the dialog.
Item {
    id: root

    // The Settings view this guide belongs to: where rows are looked for.
    required property Item view
    readonly property int size: Theme.scaled(48)
    readonly property bool motion: !Theme.reducedMotion && !Activity.idle
    readonly property Item overlay: Controls.Overlay.overlay

    // The row being pointed at, the page it scrolls in, and Wiz's spot.
    property Item row: null
    property Item page: null
    readonly property SettingsPage scrolling: page as SettingsPage
    property var spot: null
    property var ring: null
    property var area: null
    // Wiz is on screen (arriving, pointing or moving), or on his way out.
    property bool shown: false
    property bool leaving: false
    // The row is in view: out of view (scrolled away), he waits unseen.
    property bool inView: true
    property int tries: 0
    property var lastRect: null

    parent: row && inOverlay(row) ? overlay : view
    anchors.fill: parent
    z: parent === overlay ? 1000 : 0

    function inOverlay(item) {
        for (let node = item; node; node = node.parent) {
            if (node === overlay)
                return true;
        }
        return false;
    }

    // Depth-first over the visible tree, as SettingsPage.rowForKey, but
    // across the whole window: a row may sit in a widget's dialog.
    function findRow(item, key) {
        if (!item || !item.visible || item === root)
            return null;
        if ((item.settingKey !== undefined && item.settingKey === key)
                || (item.searchAnchor !== undefined && item.searchAnchor === key))
            return item;
        for (const child of item.children) {
            const hit = findRow(child, key);
            if (hit)
                return hit;
        }
        if (item.contentItem && item.contentItem !== item && item.children.indexOf(item.contentItem) === -1)
            return findRow(item.contentItem, key);
        return null;
    }

    // The scrolling page that holds the row: its viewport is where he may
    // stand. A page that does not scroll (Wallpaper) is the view's page
    // itself, the item its page loader holds.
    function pageOf(item: Item): Item {
        for (let node = item ? item.parent : null; node; node = node.parent) {
            const page = node as SettingsPage;
            if (page && !page.embedded)
                return page;
            if (node.parent && node.parent.objectName === "settingsPageLoader")
                return node;
        }
        return null;
    }

    function mapped(item, rect) {
        const point = item.mapToItem(root, rect.x, rect.y);
        return { x: point.x, y: point.y, width: rect.width, height: rect.height };
    }

    function measure() {
        if (!row || !page)
            return null;
        const rowRect = mapped(row, { x: 0, y: 0, width: row.width, height: row.height });
        const settingsRow = row as SettingsRow;
        const parts = settingsRow ? settingsRow.guideParts() : null;
        const topInset = scrolling ? scrolling.topInset : 0;
        const bottomInset = scrolling ? scrolling.bottomInset : 0;
        const top = mapped(page, { x: 0, y: topInset, width: page.width,
            height: Math.max(0, page.height - topInset - bottomInset) });
        // He may stand in the page's margin, a little above its top edge and
        // out to the gutter on either side, never over the rail or header.
        const pad = Theme.panelPadding;
        return {
            size: root.size,
            tips: Guide.tips(WizArt.wiz),
            row: rowRect,
            label: parts ? mapped(row, parts.label) : null,
            controls: parts ? parts.controls.map(rect => mapped(row, rect)) : [rowRect],
            viewport: top,
            area: { x: top.x - pad, y: top.y - Theme.scaled(8), width: top.width + pad * 2,
                height: top.height + Theme.scaled(8) + pad }
        };
    }

    function place() {
        const input = measure();
        if (!input)
            return;
        const line = input.label ? input.label.y + input.label.height / 2
            : input.row.y + Math.min(input.row.height, root.size) / 2;
        inView = line >= input.viewport.y && line <= input.viewport.y + input.viewport.height;
        area = input.area;
        ring = { x: input.row.x - Theme.scaled(6), y: input.row.y - Theme.scaled(2),
            width: input.row.width + Theme.scaled(12), height: input.row.height + Theme.scaled(4) };
        ringFrame.viewport = input.viewport;
        spot = Guide.place(input);
    }

    function schedulePlace() {
        if (shown && !leaving)
            Qt.callLater(root.place);
    }

    function begin() {
        lastRect = null;
        tries = 0;
        finder.restart();
        row = null;
        page = null;
    }

    // Looked for every 100 ms until the row is there and has stopped moving
    // (the page loads off the frame, a folded group opens, the page scrolls
    // to the row), for at most four seconds.
    Timer {
        id: finder
        interval: 100
        repeat: true
        onTriggered: {
            if (Settings.guideKey === "") {
                stop();
                return;
            }
            root.tries++;
            const found = root.findRow(root.view, Settings.guideKey)
                ?? root.findRow(root.overlay, Settings.guideKey);
            const page = found ? root.pageOf(found) : null;
            if (found && page && found.width > 0 && found.height > 0) {
                const point = found.mapToItem(null, 0, 0);
                const rect = [point.x, point.y, found.width, found.height].join(",");
                if (rect === root.lastRect) {
                    stop();
                    root.row = found;
                    root.page = page;
                    root.show();
                    return;
                }
                root.lastRect = rect;
            }
            if (root.tries >= 40) {
                stop();
                Settings.endGuide("missing");
            }
        }
    }

    function show() {
        // A Wiz made by this call enters as he loads (onLoaded).
        const figure = wizLoader.item as Figure;
        const moving = figure !== null && shown && !leaving;
        leaving = false;
        // Moving to another row, he glides there rather than jumping.
        if (moving && motion)
            figure.gliding = true;
        place();
        shown = true;
        lively.restart();
        if (moving)
            figure.glide();
        else if (figure)
            figure.enter();
        Settings.guideShown();
    }

    function hide() {
        finder.stop();
        if (!shown)
            return;
        leaving = true;
        if (motion && wizLoader.item)
            (wizLoader.item as Figure).leave();
        else
            gone();
    }

    function gone() {
        shown = false;
        leaving = false;
        row = null;
        page = null;
        spot = null;
    }

    Connections {
        target: Settings
        function onGuideSerialChanged() { root.begin(); }
        function onGuideKeyChanged() {
            if (Settings.guideKey === "")
                root.hide();
        }
    }

    // What moves the row on screen moves him with it.
    Connections {
        target: root.page
        enabled: root.page !== null
        function onWidthChanged() { root.schedulePlace(); }
        function onHeightChanged() { root.schedulePlace(); }
    }
    Connections {
        target: root.scrolling
        enabled: root.scrolling !== null
        function onContentYChanged() { root.schedulePlace(); }
        function onContentHeightChanged() { root.schedulePlace(); }
    }
    Connections {
        target: root.row
        enabled: root.row !== null
        function onXChanged() { root.schedulePlace(); }
        function onYChanged() { root.schedulePlace(); }
        function onWidthChanged() { root.schedulePlace(); }
        function onHeightChanged() { root.schedulePlace(); }
        // A dialog that closed, a group folded away: the row has gone.
        function onVisibleChanged() {
            if (root.row && !root.row.visible && root.shown && !root.leaving)
                Settings.endGuide("gone");
        }
    }
    onWidthChanged: schedulePlace()
    onHeightChanged: schedulePlace()
    // A page that unloads takes its rows with it.
    onRowChanged: {
        if (row === null && shown && !leaving && !finder.running)
            Settings.endGuide("gone");
    }

    // His arrival and any move run for a moment; then he holds still.
    Timer {
        id: lively
        interval: 3200
    }

    // The ring that marks the row while he points at it, kept inside the
    // page's viewport so it never runs over the tabs or the header.
    Item {
        id: ringFrame
        property var viewport: null
        visible: root.shown && root.ring !== null && viewport !== null
        x: viewport ? viewport.x - Theme.scaled(8) : 0
        y: viewport ? viewport.y : 0
        width: viewport ? viewport.width + Theme.scaled(16) : 0
        height: viewport ? viewport.height : 0
        clip: true
        opacity: root.leaving ? 0 : 1
        Behavior on opacity { enabled: root.motion; NumberAnimation { duration: Theme.chipFadeDuration } }

        Rectangle {
            objectName: "settingsGuideRing"
            x: root.ring ? root.ring.x - ringFrame.x : 0
            y: root.ring ? root.ring.y - ringFrame.y : 0
            width: root.ring ? root.ring.width : 0
            height: root.ring ? root.ring.height : 0
            radius: Theme.rowRadius
            color: "transparent"
            border.width: Theme.scaled(2)
            border.color: Theme.accent
        }
    }

    Loader {
        id: wizLoader
        active: root.shown
        sourceComponent: Figure {}
        onLoaded: (item as Figure).enter()
    }

    component Figure: Item {
        id: figure
        objectName: "settingsGuideWiz"
        readonly property var spot: root.spot
        // The drop he arrives with, and how far he has faded in.
        property real drop: 0
        property bool gliding: false
        property alias pose: wiz.pose
        property alias facing: wiz.facing
        // Whether he animates now: only while he arrives, moves or leaves.
        readonly property bool animating: wiz.animated
        x: spot ? spot.x : 0
        y: (spot ? spot.y : 0) + drop
        width: root.size
        height: root.size
        visible: root.inView
        opacity: 0
        Accessible.ignored: true

        Behavior on x { enabled: figure.gliding; NumberAnimation { duration: 320; easing.type: Easing.InOutCubic } }
        Behavior on y { enabled: figure.gliding; NumberAnimation { duration: 320; easing.type: Easing.InOutCubic } }

        function enter() {
            departing.stop();
            if (!root.motion) {
                drop = 0;
                opacity = 1;
                return;
            }
            arriving.restart();
        }

        function glide() {
            if (!root.motion)
                return;
            gliding = true;
            settle.restart();
        }

        function leave() {
            arriving.stop();
            departing.restart();
        }

        SequentialAnimation {
            id: arriving
            ScriptAction { script: { figure.drop = -Theme.scaled(14); figure.opacity = 0; } }
            ParallelAnimation {
                NumberAnimation { target: figure; property: "drop"; to: 0; duration: 220; easing.type: Easing.InQuad }
                NumberAnimation { target: figure; property: "opacity"; to: 1; duration: 160 }
            }
            ScriptAction { script: wiz.arrive() }
        }

        SequentialAnimation {
            id: departing
            ParallelAnimation {
                NumberAnimation { target: figure; property: "drop"; to: -Theme.scaled(10); duration: 220; easing.type: Easing.OutQuad }
                NumberAnimation { target: figure; property: "opacity"; to: 0; duration: 220 }
            }
            ScriptAction { script: root.gone() }
        }

        Timer {
            id: settle
            interval: 340
            onTriggered: {
                figure.gliding = false;
                wiz.arrive();
            }
        }

        AssistantUi.Wiz {
            id: wiz
            anchors.fill: parent
            pose: "pointing"
            aside: figure.spot ? figure.spot.aside : true
            boxAbove: figure.spot ? figure.spot.boxAbove : false
            facing: figure.spot ? figure.spot.facing : 1
            // Still once he has settled: no frame drawn while he points.
            animated: root.motion && (lively.running || figure.gliding || arriving.running || departing.running)
        }
    }
}
