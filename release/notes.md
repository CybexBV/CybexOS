# Cybex OS 1.0.35

Wiz is redrawn: he now has hands, a wand, a cape and boots, and the star on his hat is his single status light. While the assistant works he shows what kind of work it is, such as reading, searching, writing or installing, gives a thumbs-up after a long job and a shrug when something is refused, and gets drowsy when left alone. Ask him where a setting is and he opens Settings and points at the row. The installer, terminal and notification pictures use the same new Wiz.

Online accounts are easier to add. Settings → Online Accounts has its own Add account picker, with Google, Microsoft 365 and Nextcloud first, and shows each account's logo. Google sign-in no longer stops at an empty Open With dialog. Microsoft 365 and Exchange calendars now appear in the clock's calendar, next to Google ones.

The `cybex` command is friendlier in a terminal. It has grouped help and plain-text output, and new guided commands: `cybex status`, `cybex update`, `cybex apps` (Nix and Flathub apps together), `cybex cleanup`, `cybex region` and `cybex ask`. Fish completes its commands with Tab. Scripts that read its output add `--json`.

Holding a key now starts repeating after a quarter of a second instead of 0.6 seconds.

This is a source update with no new ISO. Installation, boot, physical hardware and staged-updater qualification are separate from source tests and package builds.
