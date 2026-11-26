pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io

Singleton {
    id: root
    readonly property bool externalBusy: external.running || accountTask.running
    property string externalDomain: "sound"
    function openExternal(domain) {
        if (externalBusy) return;
        // Native tools can be tiled below this floating Settings window.
        // Dismiss it so the window we launch is visible and receives input.
        Settings.closePanel();
        externalDomain = domain;
        external.running = true;
    }
    property Process external: Process {
        command: [root.externalDomain === "sound" ? "pavucontrol" : "nm-connection-editor"]
        stdout: StdioCollector {}
        stderr: StdioCollector {}
        onExited: exitCode => {
            const service = root.externalDomain === "sound" ? root.sound : root.network;
            if (exitCode !== 0)
                service.error = "The advanced settings window could not open. Check that its package is installed.";
            service.refresh();
        }
    }

    // ---- online accounts ------------------------------------------------
    // Settings lists the account kinds and the accounts; signing in stays
    // GNOME Online Accounts' own. cybexos-goa-account (desktop/goa-account)
    // opens GOA's dialog for one provider or one account and prints one JSON
    // result; nothing secret passes through it to here. Settings floats above
    // every tiled window, so it would hide the browser page the sign-in opens:
    // it closes while the dialog is open and comes back with the result.
    //
    // A command that cannot start gives only the falling edge of `running`
    // (Common/ProcHelpers.js), so both processes finish on any falling edge
    // while a request is pending, whether or not they ever ran.
    property bool accountPickerOpen: false
    property var accountProviders: []
    property bool accountProvidersLoaded: false
    property string accountProvidersError: ""
    property bool accountProvidersPending: false
    property string accountProvidersOutput: ""
    readonly property bool accountTaskRunning: accountTask.running || accountTaskPending
    property bool accountTaskPending: false
    property bool accountTaskStarted: false
    property bool accountTaskCancelling: false
    property string accountTaskKind: ""
    property string accountTaskTarget: ""
    property string accountTaskLabel: ""
    property string accountTaskOutput: ""
    property string accountNotice: ""
    property string accountNoticeTone: "info"

    // Loads once; a failed load is tried again the next time the picker opens.
    function loadAccountProviders() {
        if (accountProvidersPending || (accountProvidersLoaded && accountProvidersError === ""))
            return;
        accountProvidersPending = true;
        accountProvidersOutput = "";
        providerList.running = true;
        Qt.callLater(() => {
            if (root.accountProvidersPending && !providerList.running)
                root.providersFinished();
        });
    }
    function providersFinished() {
        if (!accountProvidersPending)
            return;
        accountProvidersPending = false;
        const result = lastJson(accountProvidersOutput);
        const providers = result ? result.providers : null;
        accountProviders = providers && (Array.isArray(providers) || providers instanceof Array) ? providers : [];
        accountProvidersError = accountProviders.length ? ""
            : I18n.tr("No account kinds are available. Check that online accounts are installed.");
        accountProvidersLoaded = true;
    }
    function addAccount(type, label) {
        return startAccountTask("add", type, label);
    }
    function reconnectAccount(id, label) {
        return startAccountTask("reconnect", id, label);
    }
    function startAccountTask(kind, target, label) {
        if (accountTaskRunning || external.running || !target)
            return false;
        accountTaskKind = kind;
        accountTaskTarget = target;
        accountTaskLabel = label || "";
        accountTaskOutput = "";
        accountTaskStarted = false;
        accountTaskCancelling = false;
        accountNotice = "";
        accountPickerOpen = false;
        Settings.closePanel();
        accountTaskPending = true;
        accountTask.running = true;
        Qt.callLater(() => {
            if (root.accountTaskPending && !accountTask.running)
                root.accountTaskEnded();
        });
        return true;
    }
    function cancelAccountTask() {
        if (accountTask.running && !accountTaskCancelling) {
            accountTaskCancelling = true;
            accountTask.signal(15);
        }
    }
    function accountTaskEnded() {
        if (!accountTaskPending)
            return;
        accountTaskPending = false;
        accountFinished(lastJson(accountTaskOutput));
    }
    function lastJson(text) {
        const lines = String(text || "").trim().split("\n");
        try {
            const value = JSON.parse(lines[lines.length - 1]);
            return value && typeof value === "object" && !(Array.isArray(value) || value instanceof Array) ? value : null;
        } catch (_) {
            return null;
        }
    }
    function accountFailure(result) {
        const reasons = {
            "no-service": I18n.tr("The online accounts service is not running."),
            "gone": I18n.tr("This account is no longer on this computer."),
            "managed": I18n.tr("This account is managed by your administrator."),
            "unsupported": I18n.tr("This kind of account cannot be reconnected here."),
            "unknown-provider": I18n.tr("This kind of account is not available on this computer."),
            "response": I18n.tr("The browser's answer could not be used. Close older sign-in tabs and try again.")
        };
        return reasons[result.reason] || result.message
            || (accountTaskStarted ? I18n.tr("The sign-in did not finish. Try again.")
                : I18n.tr("The sign-in window could not open. Check that online accounts are installed."));
    }
    function accountFinished(result) {
        const label = accountTaskLabel;
        const outcome = result ? result.result : "";
        if (outcome === "added" || outcome === "reconnected") {
            let done = outcome === "added" ? I18n.format("%1 account added.", [label])
                : I18n.format("%1 is connected again.", [label]);
            // GOA can add an account and still fail to keep its sign-in, as
            // when the keyring would not store it.
            if (result.reason === "unverified")
                done += " " + I18n.tr("GNOME Online Accounts could not confirm its sign-in; if it asks for attention, reconnect it.");
            accountNotice = result.message ? done + " " + result.message : done;
            accountNoticeTone = result.reason === "unverified" || result.message ? "warning" : "active";
            Calendar.refreshDefault();
        } else if (outcome === "cancelled") {
            // The account list below says what, if anything, changed.
            accountNotice = I18n.tr("The sign-in was cancelled.");
            accountNoticeTone = "info";
        } else {
            accountNotice = accountFailure(result || {});
            accountNoticeTone = "error";
        }
        accounts.refresh();
        Settings.showPanel("accounts");
    }
    property Process accountTask: Process {
        command: ["cybexos-goa-account", root.accountTaskKind, root.accountTaskTarget]
        stdout: StdioCollector { onStreamFinished: root.accountTaskOutput = text }
        onRunningChanged: {
            if (running)
                root.accountTaskStarted = true;
            else
                Qt.callLater(root.accountTaskEnded);
        }
    }
    property Process providerList: Process {
        command: ["cybexos-goa-account", "list"]
        stdout: StdioCollector { onStreamFinished: root.accountProvidersOutput = text }
        onRunningChanged: {
            if (!running)
                Qt.callLater(root.providersFinished);
        }
    }

    readonly property SystemSettingsBackend sound: SystemSettingsBackend { domain: "sound" }
    readonly property SystemSettingsBackend network: SystemSettingsBackend { domain: "network" }
    readonly property SystemSettingsBackend keybindings: SystemSettingsBackend { domain: "keybindings" }
    readonly property SystemSettingsBackend input: SystemSettingsBackend { domain: "input" }
    readonly property SystemSettingsBackend region: SystemSettingsBackend { domain: "region" }
    readonly property SystemSettingsBackend security: SystemSettingsBackend { domain: "security" }
    readonly property SystemSettingsBackend sshServer: SystemSettingsBackend { domain: "ssh-server" }
    readonly property SystemSettingsBackend passwordlessSudo: SystemSettingsBackend { domain: "passwordless-sudo" }
    readonly property SystemSettingsBackend accounts: SystemSettingsBackend {
        domain: "accounts"
        onCompleted: result => { if (result.success) Calendar.refreshDefault(); }
    }
}
