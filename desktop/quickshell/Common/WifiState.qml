pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Networking
import "StatusHelpers.js" as StatusHelpers

// The Wi-Fi device and its active network. `Networking.devices` lists wired
// and wireless alike. Networks belong to the base NetworkDevice in Quickshell
// 0.3, so select the explicit device type before accessing Wi-Fi-only state.
//
// Named WifiState, not Network: Quickshell.Networking already exports a
// `Network` type, and a consumer importing both would resolve the name by
// import order. Same reason as BluetoothState.
Singleton {
    id: root

    readonly property var device: Networking.devices.values.find(d => d.type === DeviceType.Wifi) ?? null
    readonly property var active: device ? (device.networks.values.find(n => n.connected) ?? null) : null
    readonly property bool connected: active !== null
    readonly property string name: active ? active.name : ""

    // Whole percent, -1 when there is no reading — an unknown strength is
    // not the same as a genuine 0%.
    readonly property int signal: StatusHelpers.signalPercent(active ? active.signalStrength : null)

    // Whether the radio itself is on, which is independent of whether it
    // has associated with anything.
    readonly property bool enabled: Networking.wifiEnabled

    function setEnabled(value) {
        Networking.wifiEnabled = value;
    }
}
