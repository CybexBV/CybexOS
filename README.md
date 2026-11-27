<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo/svg/cybexos-logo-on-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/logo/svg/cybexos-logo-on-light.svg">
  <img src="assets/brand/logo/svg/cybexos-logo-on-light.svg" alt="Cybex OS" width="360">
</picture>

# Cybex OS

A personal NixOS desktop with staged, reversible updates.

Cybex OS is a NixOS desktop built around Hyprland, a custom Quickshell interface,
keyboard-driven applications, and personal extensions that stay yours.
NixOS on the rolling nixos-unstable branch, x86_64, is the current target; a
default installation downloads prebuilt packages from cache.nixos.org.
Releases are published on GitHub on a beta and a stable channel
([release operations](docs/releasing.md#channels)). The
[validation status](docs/validation.md) records what has been tested and what
has not, including physical hardware.

The same NixOS modules define the installed product and the installation ISO,
which boots straight into a native installer screen and carries the desktop as
an offline payload. Vendor desktop
code lives in immutable store paths. Your machine owns its configuration and lock
file; personal modules and persistent data are separate from vendor releases.

- [Fresh installation](docs/installation.md)
- [Architecture and ownership](docs/architecture/ownership.md)
- [Updates](docs/updates.md)
- [Personal configuration and plugin development](docs/customization.md)
- [Wallpapers and the shared picker](docs/wallpapers.md)
- [Welcome guide](docs/welcome.md)
- [Cybex OS Assistant](docs/assistant.md)
- [Release publishing and signing keys](docs/releasing.md)
- [Recovery, persistence and garbage collection](docs/recovery.md)
- [Shell crash recovery](docs/shell-recovery.md)
- [System check (`cybex doctor`)](docs/system-check.md)
- [Hardware and security](docs/hardware-security.md)
- [Hardware support and qualification](docs/hardware-support.md)
- [Matched laptops: Dell XPS 2026 and HP ZBook Ultra G1a](docs/laptop-support.md)
- [Music player in the menubar](docs/media-player.md)
- [Lid handling and external displays](docs/power.md)
- [Desktop integration boundaries](docs/integration-boundaries.md)
- [Artwork and licensing](docs/licensing.md)
- [Validation status](docs/validation.md)

Each release pins the Nixpkgs revision its full check built, and an update
moves a machine to that release and its Nixpkgs together
([updates](docs/updates.md#nixpkgs-comes-with-the-release)):

```console
cybex status                 # quick overview of this computer
cybex update                 # check, prepare, review and apply interactively
cybex apps search firefox    # search and install NixOS or Flathub apps
cybex cleanup                # preview and free space from old generations
cybex doctor                 # read-only system check
```

Add `--json` to any command for machine-readable output (used by Software
Update, Settings, and scripts). The low-level step-by-step commands
(`cybex update check`, `stage`, `status`, `apply`, `confirm`, `rollback`) stay
available alongside the guided flow.

Software Update and the CLI use the same supervised, serialized lifecycle.
When the combined update fails, for example on a package NixOS hasn't built
yet, it falls back to the release alone (`stage cybexos`) on the packages the
machine already has. Personal inputs are never refreshed implicitly.

For source work, use `nix develop` and `tests/run`. Build the ISO with
`nix build .#iso`; use task-specific staging and the repository's ISO/PXE rules.
A successful build or fixture suite does not qualify installation, runtime,
physical hardware, or a different source revision. Nothing in these commands
publishes a release or changes the running workstation.
