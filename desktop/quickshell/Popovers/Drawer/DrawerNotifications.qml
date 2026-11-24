pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Services.Notifications
import "../../Common"
import "../../Common/NotifPolicy.js" as NotifPolicy
import "../../Assistant"

// The drawer's Notifications tab: the recent hour's cards, an EARLIER block
// for the rest, newest first, and the Focus switch — the same Focus as the
// Overview's tile. Cards reuse the shared NotifCard anatomy the toasts draw,
// app on each card's meta line; its expand and dismiss buttons are drawn at
// 24 px and answer to a 32 px target (NotifCard's hitInset). An arrival
// while the tab is showing lands at the top, briefly lit; one that came
// while another tab was showing was counted on the tab instead
// (DrawerArrival, NotifPolicy.drawerRoute). Dismissing a card from the
// keyboard hands focus to its neighbour.
//
// Repeated notifications from one app fold into one row (2026-11-24 review),
// as the toast stack groups them: the newest card with the count, and a
// click shows them all (NotifPolicy.historyFold). A critical notification
// never folds away. Folding is presentation only: unread counts, the arrival
// strip and the critical banner read Notifs' entries as before.
Column {
    id: root

    property double nowMs: Date.now()
    readonly property var entries: Notifs.entries
    // Entries are newest first, so the recent hour is a prefix. The clock
    // tick only moves this int; the lists below re-slice when it actually
    // changes, not every 30 s, and the ScriptModels keep each surviving
    // card (its expansion and focus) across a re-slice.
    readonly property int recentCount: {
        const index = entries.findIndex(entry =>
            root.nowMs - entry.arrived >= 3600 * 1000);
        return index === -1 ? entries.length : index;
    }
    readonly property var recent: entries.slice(0, recentCount)
    readonly property var earlier: entries.slice(recentCount)
    // Source keys of the groups the person opened, for this visit.
    property var openGroups: ({})
    // The same entry objects, each source's run together, and what each card
    // shows; the models below hold entries, so a card survives a refold.
    readonly property var recentFold: NotifPolicy.historyFold(recent, openGroups,
        NotificationUrgency.Critical)
    readonly property var earlierFold: NotifPolicy.historyFold(earlier, openGroups,
        NotificationUrgency.Critical)
    // Cards for entries that arrive after this moment are new to the person
    // looking at the list.
    readonly property double shownAt: Date.now()

    readonly property var cardStyle: ({
        face: Theme.fontMenu,
        header: Theme.typography.notification,
        body: Theme.typography.notification,
        bodyColor: Theme.textMid,
        bodyLines: 3,
        bodyLeading: 1.25,
        stampFace: Theme.fontNumeric,
        stampSize: Theme.fontCaption,
        target: Theme.scaled(24),
        closeAlways: true,
        close: Theme.iconMedium,
        closeColor: Theme.textMid,
        pill: Theme.fontCaption
    })

    // The cards on show, top to bottom: folded cards are not among them.
    function shownCards() {
        const cards = [];
        for (const list of [recentCards, earlierCards]) {
            for (let i = 0; i < list.count; i++) {
                const row = list.itemAt(i);
                if (row && row.visible)
                    cards.push(row.card);
            }
        }
        return cards;
    }

    // The card at `index` in the list as it now stands — the one after a
    // dismissed card, or the last — else the Focus switch.
    function focusCardAt(index) {
        const cards = shownCards();
        const card = index < 0 ? null : cards[Math.min(index, cards.length - 1)];
        if (card)
            card.forceActiveFocus();
        else
            focusSwitch.forceActiveFocus();
    }

    // A folded row's × clears its whole group, as the toast stack's does.
    function dismiss(row) {
        const refocus = row.card.holdsFocus;
        const index = shownCards().indexOf(row.card);
        const members = (row.folded ? row.fold.members : [row.modelData]).slice();
        for (const entry of members)
            Notifs.dismiss(entry);
        if (refocus)
            Qt.callLater(() => root.focusCardAt(index));
    }

    function toggleGroup(source, refocus) {
        const next = Object.assign({}, openGroups);
        if (next[source])
            delete next[source];
        else
            next[source] = true;
        openGroups = next;
        // Show less hides with the header it sits in; the group's card
        // takes the focus it held.
        if (refocus)
            Qt.callLater(() => {
                if (refocus.visible)
                    refocus.forceActiveFocus();
            });
    }

    width: parent ? parent.width : 0
    spacing: Theme.scaled(14)

    Timer {
        interval: 30000
        running: root.visible
        repeat: true
        triggeredOnStart: true
        onTriggered: root.nowMs = Date.now()
    }

    // One history row: an open group's header on its newest card, then the
    // card. Folded members stay in the model, invisible, so opening a group
    // keeps every card's own state.
    component HistoryRow: Column {
        id: row

        required property var modelData
        property bool older: false
        readonly property var fold: (older ? root.earlierFold : root.recentFold).fold[modelData.key]
            || ({ source: "", lead: true, count: 1, hidden: false, open: false, members: [modelData] })
        // The newest of a closed group: it stands for the rest.
        readonly property bool folded: fold.lead && fold.count > 1 && !fold.open
        readonly property alias card: rowCard
        // Lit for a moment when it arrives while the list is open.
        property bool fresh: !older && modelData.arrived > root.shownAt

        visible: !fold.hidden
        width: parent ? parent.width : 0
        spacing: 4

        Item {
            visible: row.fold.open && row.fold.lead
            width: parent.width
            height: Math.max(Theme.inlineActionHeight, groupLabel.implicitHeight)

            Text {
                id: groupLabel
                anchors.left: parent.left
                anchors.leftMargin: 4
                anchors.right: showLess.left
                anchors.rightMargin: Theme.controlSpacing
                anchors.verticalCenter: parent.verticalCenter
                text: [row.modelData.displayAppName || "",
                    I18n.format("%1 notifications", [row.fold.count])].filter(Boolean).join(" · ")
                textFormat: Text.PlainText
                elide: Text.ElideRight
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.metadata
                font.weight: Theme.weightSemibold
                color: Theme.textLow
            }

            NotifButton {
                id: showLess
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: I18n.tr("Show less")
                onTriggered: root.toggleGroup(row.fold.source, rowCard)
            }
        }

        NotifCard {
            id: rowCard

            entry: row.modelData
            style: root.cardStyle
            nowMs: root.nowMs
            groupCount: row.folded ? row.fold.count : 1
            allowTextExpansion: true
            keyboardEnabled: true
            showIcon: true
            framedIcon: true
            iconWell: row.older ? Theme.chip : Theme.chipHover
            iconExtent: Theme.scaled(32)
            iconSize: Theme.scaled(22, Theme.typeScale)
            width: parent.width
            radius: 10
            opacity: row.older ? 0.75 : 1
            padV: row.older ? 8 : 12
            color: rowCard.urgent && !row.older ? Theme.redBgSoft
                : row.fresh ? Theme.selectedFill
                : rowCard.hovered ? Theme.chipHover
                : row.older ? "transparent" : Theme.chip
            // A new arrival keeps its accent hairline; resting cards take
            // light mode's card edge so they do not melt into the drawer.
            border.width: row.fresh ? 1 : row.older ? 0 : Theme.cardEdgeWidth
            border.color: row.fresh ? Theme.selectedMark : Theme.cardEdge
            onActivated: {
                if (row.folded)
                    root.toggleGroup(row.fold.source, null);
                else
                    Notifs.activate(rowCard.entry);
            }
            onCloseRequested: root.dismiss(row)
        }

        Timer {
            running: row.fresh
            interval: 1600
            onTriggered: row.fresh = false
        }
    }

    // ---- header ----------------------------------------------------------
    Item {
        width: parent.width
        height: Math.max(Theme.scaled(28), focusRow.implicitHeight)

        Row {
            anchors.left: parent.left
            anchors.leftMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            // One message per state (2026-11-24 review): how many are new,
            // or "Nothing new" over older ones. An empty list says it once,
            // under Wiz, so the header stays quiet.
            Text {
                anchors.verticalCenter: parent.verticalCenter
                visible: text !== ""
                text: root.recent.length > 0
                    ? I18n.format("%1 new", [root.recent.length])
                    : Notifs.count > 0 ? I18n.tr("Nothing new") : ""
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.title
                font.weight: Theme.weightSemibold
                color: Theme.textHi
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                visible: root.earlier.length > 0
                text: I18n.format("%1 earlier", [root.earlier.length])
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.secondary
                color: Theme.textFaint
            }
        }

        // Focus, labelled, as a switch: the Overview's tile and the bar's
        // indicators read the same Notifs.dnd.
        Row {
            id: focusRow
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.controlSpacing + 2

            // The label toggles too, as a settings row's does.
            Item {
                anchors.verticalCenter: parent.verticalCenter
                width: focusLabels.implicitWidth
                height: focusLabels.implicitHeight

                Column {
                    id: focusLabels

                    Text {
                        anchors.right: parent.right
                        text: I18n.tr("Focus")
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.control
                        font.weight: Theme.weightSemibold
                        color: Theme.textHi
                    }

                    Text {
                        anchors.right: parent.right
                        text: I18n.tr("Silences notifications")
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.metadata
                        color: Theme.textMid
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Notifs.setDnd(!Notifs.dnd)
                }
            }

            Toggle {
                id: focusSwitch
                anchors.verticalCenter: parent.verticalCenter
                metrics: Theme.switchCompact
                checked: Notifs.dnd
                accessibleName: I18n.tr("Focus: silences notifications")
                onToggled: value => Notifs.setDnd(value)
            }
        }
    }

    NotifSnoozes { width: parent.width }

    // ---- cards -----------------------------------------------------------
    Column {
        width: parent.width
        spacing: 4

        Repeater {
            id: recentCards

            model: ScriptModel {
                values: root.recentFold.entries
            }

            delegate: HistoryRow {}
        }

        // Nothing kept at all: Wiz rests where the cards would be, asleep
        // while Focus holds notifications back, over one line. Idle he holds
        // still between a blink or a glance, so an open, empty centre draws
        // next to nothing.
        Loader {
            active: Notifs.count === 0
            visible: active
            width: parent.width

            sourceComponent: Item {
                implicitHeight: emptyColumn.implicitHeight + Theme.scaled(20)

                Column {
                    id: emptyColumn
                    anchors.centerIn: parent
                    width: parent.width
                    spacing: Theme.scaled(4)

                    Wiz {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: Theme.scaled(64)
                        height: Theme.scaled(64)
                        pose: Notifs.dnd ? "asleep" : "idle"
                    }

                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: I18n.tr("You're all caught up.")
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.primary
                        font.weight: Theme.weightMedium
                        color: Theme.textMid
                    }
                }
            }
        }

        Item {
            visible: root.earlier.length > 0
            width: parent.width
            height: 26

            Text {
                anchors.left: parent.left
                anchors.leftMargin: 4
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 4
                text: I18n.tr("EARLIER")
                font.family: Theme.fontMenu
                font.pixelSize: Theme.typography.section
                font.weight: Theme.weightSemibold
                font.letterSpacing: 0.6
                color: Theme.textFaint
            }
        }

        Repeater {
            id: earlierCards

            model: ScriptModel {
                values: root.earlierFold.entries
            }

            delegate: HistoryRow {
                older: true
            }
        }
    }

    // Nothing kept, nothing to say or clear: Wiz's empty state ends the tab.
    DrawerFooter {
        visible: Notifs.count > 0
        info: Notifs.count === 0 ? ""
            : Notifs.count === 1 ? I18n.tr("1 notification kept")
            : I18n.format("%1 notifications kept", [Notifs.count])
        actionText: Notifs.count > 0 ? I18n.tr("Clear all") : ""
        onActionClicked: Notifs.clearAll()
    }
}
