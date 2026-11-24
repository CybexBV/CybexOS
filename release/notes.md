# Cybex OS 1.0.32

To install this release, first run `cybex update stage cybexos` once, then install it from Software Update. That prepares Cybex OS on the NixOS packages you already have; your computer's current update check would otherwise combine it with whatever NixOS packages are newest that day, the way earlier updates failed. After this release, updates take care of this themselves.

Updates are steadier from now on. Until now your computer took the newest NixOS packages every day and combined them with Cybex OS, a mix nobody had built before; that is how 1.0.16, 1.0.27 and 1.0.31 failed to install. Now each Cybex OS release brings the NixOS packages it was checked with, and your computer moves to those only, never to untested ones and never back. NixOS packages arrive with Cybex OS releases instead of every day.

A Cybex OS release now always installs, even when new NixOS packages don't. If an update that brings both fails for any reason, Software Update prepares the Cybex OS release on its own, on the packages you already have.

The connected-service widgets are now optional extras, turned on in Settings → Bar: Model Usage, Fusebox, T3 Code, Hermes Agent and Remote Server. If you see Model Usage today, you keep it; if you never changed a setting, turn it on there. The Hermes bridge now starts only once its widget is on, instead of in every session.

Cybex OS's repository moved to CybexBV/CybexOS. Your computer moves to the new name with this update; nothing else changes.

When an update's trial boot fails and your computer goes back to the previous version on the next start, the desktop now starts normally. Before, the bar could stay away and the keyring stay locked.

This is a source update with no new ISO. Installation, boot, physical hardware and staged-updater qualification are separate from source tests and package builds.
