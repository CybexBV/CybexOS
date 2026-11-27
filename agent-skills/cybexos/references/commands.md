# Commands and recovery

Human-readable output is the default across `cybex`; add `--json` for
machine-readable JSON (and structured `{"error": ...}` errors on stderr).

- `cybex status [--json]`: quick read-only overview of Cybex OS, updates,
  storage, backup, desktop shell and region.
- `cybex update`: guided check, prepare, review and apply.
- `cybex update check [--json]`: Cybex OS release status and the NixOS packages
  (Nixpkgs revision) that release was checked with.
- `cybex update stage upstream|cybexos|both|local [--json]`: build and validate a
  staged complete configuration, preserving the working configuration.
- `cybex update status [--json]`: durable progress, actual closure changes, the
  readable `highlights` summary, errors, restart needs, transaction ID, review
  token and the `automatic` policy. A non-empty `desktopRestart` says that
  applying restarts the desktop shell or, later, the assistant; tell the
  person before applying. Adding or removing apps restarts neither.
- `cybex update apply [ID TOKEN] [--json]`: supervised activation of the reviewed build.
- `cybex update confirm [--json]`: after an explicit reboot and authenticated desktop
  login, check boot/services/Hyprland/Quickshell and retain the known-good system.
  The signed-in desktop normally requests this itself.
- `cybex update automatic [prepare|confirm on|off] [--json]`: show or configure
  background preparation and automatic trial-boot confirmation (machine policy;
  both default on).
- `cybex update channel [stable|beta] [--json]`: show or choose the Cybex OS release
  channel (machine policy; changing it asks for authorization). Beta gets new
  Cybex OS releases first, and NixOS packages come with the release. A
  `cybexos` source in state `ahead` runs a newer version than its channel's
  newest release and waits for the next one; it is not an error.
- `cybex update discard [ID] [--json]`: discard an unapplied preview or dismiss a
  finished failure, keeping its files and logs.
- `cybexos-software-update`: open the Software Update app.
- `cybex update history [--json]`: retained deployment identities and recovery state.
- `cybex update rollback [ID] [--json]`: restore the pending or selected deployment's
  previous system and configuration. No automatic reboot or application-data
  rollback is implied.
- `cybex apps list|search|info|install|remove|updates|update [--json]`: unified
  NixOS and Flathub app management.
- `cybex cleanup [status|preview|run|pin|policy|resume] [--json]`: preview and
  free disk space from old generations.
- `cybex region [status|set|timezones|locales] [--json]`: view or change
  timezone and locale.
- `cybex ask "<question>"`, `cybex plugin ...`, `cybex theme ...`, `cybex shell ...`:
  Wiz assistant, persistent desktop extensions, themes and diagnostics.

Read the error and transaction status before retrying. Interrupted staging
retains the working system. Interrupted activation is recovered at boot. A trial
boot leaves the previous generation as the persistent boot default until fresh
boot and login health pass. If a trial fails before userspace, reboot and choose
the previous generation; automatic reboots are disabled. Boot the installation
ISO for offline recovery if the firmware cannot find a retained generation.

Persistent credentials, NetworkManager profiles, databases and widget data
remain in place through rollback. Back up and test explicit data migrations
before a future service/schema change; rolling system code back does not undo
data writes. Do not downgrade a database or rewrite an unknown newer schema.

Use the user's normal desktop commands for screenshots (`screenshot region`, or
`omasnap FILE` to annotate an existing image), recording (`screen-record`), OCR
(`screen-ocr`) and file sharing (`localsend-share`).
Do not capture or transmit private material without an authorized task.
