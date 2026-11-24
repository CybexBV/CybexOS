import QtQuick

// The installer's 48×28 switch (widgets.slint, Toggle). Off is a quiet
// track with a 1 px fog edge and a smaller fog knob, like the shell's
// switches (Common/Toggle.qml, Theme.switchOff*): the track fill alone was
// about 1.5:1 against the page, the edge gives it the 3:1 a control's
// boundary needs (2026-11-24 review). On is the accent track.
Rectangle {
    id: root
    property bool checked: false
    property string label: ""
    signal toggled()
    implicitWidth: Kiosk.px(48)
    implicitHeight: Kiosk.px(28)
    radius: height / 2
    color: checked ? Kiosk.accent : Kiosk.switchOffTrack
    border.width: checked ? 0 : Math.max(1, Kiosk.px(1))
    border.color: Kiosk.fog
    opacity: enabled ? 1 : 0.4
    activeFocusOnTab: enabled && visible
    Accessible.role: Accessible.CheckBox
    Accessible.name: label
    Accessible.checkable: true
    Accessible.checked: checked
    Accessible.onToggleAction: if (root.enabled) root.toggled()
    Accessible.onPressAction: if (root.enabled) root.toggled()
    Keys.onPressed: event => {
        if ([Qt.Key_Return, Qt.Key_Enter, Qt.Key_Space].includes(event.key)) {
            if (!event.isAutoRepeat && root.enabled)
                root.toggled();
            event.accepted = true;
        }
    }
    KioskFocusRing { visible: root.activeFocus; gap: 3; baseRadius: root.radius }
    // The desktop's knob: 4 px inside the track when on, 8 px when off.
    Rectangle {
        width: Kiosk.px(root.checked ? 24 : 20)
        height: width
        radius: width / 2
        anchors.verticalCenter: parent.verticalCenter
        x: root.checked ? root.width - width - Kiosk.px(2) : Kiosk.px(4)
        color: root.checked ? Kiosk.accentInk : Kiosk.fog
    }
    MouseArea {
        anchors.fill: parent
        enabled: root.enabled
        cursorShape: Qt.PointingHandCursor
        onClicked: root.toggled()
    }
}
