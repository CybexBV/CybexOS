# Moving to NixOS 26.11

This is the plan for moving Cybex OS from `nixos-unstable` to the stable
`nixos-26.11` branch, as AGENTS.md asks ("NixOS installation and lifecycle
contract"). John decided on 2026-11-28 to plan it now, and that the
`system.stateVersion` change happens as part of this move. Nothing here has
been carried out yet: `flake.nix`, `flake.lock` and the code are unchanged.

The short version: the move is ready on the code side and safe on the package
side today. The updater already moves a machine's branch forward, and nothing
gets older, because the 26.11 branch is strictly ahead of the Nixpkgs that
every release pins. What remains is a few small checks, the move commit, a
release with an ISO and qualification, a week on beta, then stable.

## Where things stand (checked 2026-11-28)

- `flake.nix:4` follows `github:NixOS/nixpkgs/nixos-unstable`. `flake.lock`
  pins `2786a2a72088ecf32aea5b3ec52099e6a7cff78f` (lines 103–118), dated
  2026-11-21. Releases 1.0.32 to 1.0.37 all pin this revision; 1.0.20 to
  1.0.31 pin `31ecbaca1bde` (2026-10-27).
- The `nixos-26.11` branch exists. Its head is
  `3068c73a96a6979ee8e72e7196577d0bd842d412` (2026-11-27), the same as
  `refs/heads/nixos-26.11` on GitHub and `channels.nixos.org/nixos-26.11`.
- Hydra has built and tested it. The channel advanced twice on 2026-11-27:
  `nixos-26.11beta177.3115e401b5d1` at 16:11 UTC and
  `nixos-26.11beta285.3068c73a96a6` at 18:54 UTC. A channel only advances
  once its tested job passes and its binaries are on cache.nixos.org. NixOS
  still names these builds "beta": the 26.11 release has not been announced
  yet.
- The pin is an ancestor of the 26.11 head: GitHub's compare of the two says
  26.11 is 3,959 commits ahead and 0 behind. So today the move goes strictly
  forward.
- `nixos-unstable` itself has not moved since 2026-11-21: its channel still
  names `2786a2a7`, our pin. Master now says 27.05 (`lib/.version`). Once
  unstable moves again, it carries 27.05 work that 26.11 will never get.
- Both revisions call themselves NixOS 26.11 (`lib.trivial.release`,
  codename "Zokor"). Boot entries, labelled
  `CybexOS-<version>-<system.nixos.release>` (`nix/modules/default.nix:174`),
  keep the same name.
- Evaluated on The Beast with this tree and the lock moved to `3068c73a`
  (evaluation only, nothing built): `nix flake check --no-build` passes, 48
  derivations, no warnings. `scripts/check-prebuilt` passes for the default
  system (611 local derivations, all configuration or allowed local builds), `--nvidia`, `--catalogue` and
  `--xps`, the same as on today's pin. The same tree on the older `31ecbaca`
  pin passes `scripts/check-prebuilt` too.

## Packages: nothing gets older

Machines never move Nixpkgs backwards (AGENTS.md; `docs/updates.md`), but
the updater decides a branch move by branch order alone
(`lifecycle/cybexos/inputs.py:153-157`), not by package versions. A
26.11 revision could carry older packages than a newer unstable one. Today
it doesn't: it is a descendant of our pin.

Versions evaluated on The Beast for `2786a2a7` (pin) and `3068c73a` (26.11
head):

| Package | Pin (unstable) | 26.11 head |
| --- | --- | --- |
| `linuxPackages_latest.kernel` | 7.3.5 | 7.3.6 |
| NVIDIA `stable` and `production` | 595.112.07 | 620.73.04 |
| NVIDIA `legacy_580` | 580.196.07 | 580.196.07 |
| `linux-firmware` | 20261019 | 20261124 |
| `zfs_2_4` (kernel module) | 2.4.4 | 2.4.4 |
| `hyprland` | 0.57.2 | 0.57.2 |
| `quickshell` | 0.3.2 | 0.3.2 |
| `qt6.qtbase`, `qtdeclarative` | 6.12.0 | 6.12.0 |
| `mesa` | 26.3.1 | 26.3.1 |
| `pipewire` / `wireplumber` | 1.6.11 / 0.5.19 | same |
| `networkmanager` | 1.58.1 | 1.58.1 |
| `systemd` | 262 | 262.2 |
| `nix` | 2.35.6 | 2.35.6 |
| `firefox` | 160.0.1 | 161.0 |
| `google-chrome`, `chromium` | 158.0.8127.36 | 158.0.8127.88 |
| `gnome-keyring` | 50.0 | 50.0 |
| `xdg-desktop-portal-hyprland` | 1.5.0 | 1.5.0 |
| `voxtype` / `whisper-cpp` | 1.1.1 / 1.9.5 | same |
| `matugen` | 4.2.0 | 4.2.0 |
| `polkit` | 127 | 128 |
| `glib` / `gtk4` | 2.90.0 / 4.24.0 | 2.90.1 / 4.24.1 |

Also newer on 26.11: at-spi2-core, brave, cups, dbus, gh, git, jdk25, kitty,
`linuxPackages.kernel` (6.18.65), nodejs, slack, tailscale, thunderbird,
yt-dlp. The same on both: about 130 more that Cybex OS installs or offers,
among them hyprlock, hypridle, hyprsunset, hyprpicker, xwayland, sddm,
1Password, ChatGPT, codex, opencode, evolution-ews, gnome-online-accounts,
fwupd, bluez, python3, plymouth, grub, sbctl, flatpak, podman, docker, steam,
uwsm, libadwaita and the Software catalogue's apps.

What this means:

- **No package gets older** for any machine on a published release.
- The desktop's reviewed runtime series still match
  (`desktop/runtime-compatibility.json`: Quickshell 0.3, Qt 6.11–6.12,
  Hyprland 0.56–0.57; enforced by `lifecycle/bin/cybexos-desktop-check:18-23`).
  The Lua desktop's floor, Hyprland 0.56.2 (`nix/modules/default.nix:199`),
  holds. Quickshell, Qt and Hyprland don't change at all.
- The vendored and adjusted packages see the same inputs: the `zfs_2_4`
  override in `nix/kernel-packages.nix:11` still matches 2.4.4, Brave,
  codex, Claude Code and t3-code are vendor downloads, and the checks above
  evaluate them all.
- The real changes for people are NVIDIA 595 → 620 (a new driver branch;
  `nix/modules/hardware.nix:120` picks `stable` for open modules) and the
  newer kernel and firmware. Those need hardware qualification, not code.

This stays true only while no release pins a newer `nixos-unstable`. Two ways
it could break:

- The weekly `nixpkgs-update` workflow (Mondays 03:23 UTC,
  `.github/workflows/nixpkgs-update.yml:12`) moves the lock to the unstable
  head on its branch. Once unstable passes the branch-off, merging that
  branch and releasing it would put machines ahead of 26.11. **Don't merge a
  `nixpkgs-update` branch until the move.** After the move the same workflow
  follows `nixos-26.11` by itself (line 51 updates the branch `flake.nix`
  names).
- A machine on an updater before 1.0.32 takes the unstable head itself
  (`docs/updates.md`, "Nixpkgs comes with the release"), and so can a person
  by hand. Once unstable moves, such a machine is ahead of 26.11 in some
  packages, and the branch order would still move it "forward". Firefox is
  one place where that hurts: 26.11 no longer lets Firefox silently open a
  profile from a newer version (rl-2611 notes). See the guard in the order
  of work below.

Repeat the version comparison with the exact 26.11 revision the move commit
locks (see "How to repeat the checks").

## Code that names "unstable"

`grep -rn unstable` outside `docs/measurements`, with what each place does.
Most of the work was done on 2026-11-24 (1.0.32 and 1.0.34).

| Place | What it does | Ready? |
| --- | --- | --- |
| `flake.nix:4`, `flake.lock:103-118` | The branch and revision every release pins | Change in the move commit |
| `release/compatibility.json:7` | Branches a release supports: `["unstable"]` | Move commit: `["unstable", "26.11"]` |
| `lifecycle/cybexos/inputs.py:18-42` | `branch_order`: unstable, then 26.11, 27.05, …; older stable branches refused | Ready |
| `inputs.py:45-51` | `validate_machine` accepts unstable or a stable branch from 26.11 | Ready |
| `inputs.py:138-158` | `newer`: a later branch always counts as forward | Ready; no package-version guard (below) |
| `inputs.py:161-167` | `take`: writes the release's revision and branch into the lock | Ready |
| `lifecycle/cybexos/engine.py:183-186`, `194-205` | Compatibility uses the branch in the machine's own `flake.lock` | Ready since 1.0.34 |
| `engine.py:235-254` | `nixpkgs_branch`/`move_nixpkgs` rewrite the literal `nixpkgs.url` in `/etc/nixos/flake.nix` with the lock | Ready since 1.0.32 |
| `lifecycle/cybexos/staging.py:192-199` | Moves Nixpkgs only to a release's pin, only forward | Ready |
| `lifecycle/cybexos/trust.py:308` | Refuses a release whose list lacks the machine's branch | Ready |
| `lifecycle/cybexos/hardware.py:299-311` | Inventory reads the branch from the lock | Ready |
| `installer/cybexos-install:187-215`, `676` | The machine flake names the medium's own lock branch | Ready |
| `installer/cybexos-install:714` | Writes `system.stateVersion = "26.05"` | Change in the move commit (below) |
| `installer/cybexos-installerd` | No branch logic | Ready |
| `templates/machine/flake.nix:6` | Default URL; the installer rewrites it | Move commit, for clarity |
| `release/promote:123-155` | Candidate must list the current stable release's branch and keep every branch it listed | Ready |
| `release/publish:104-131` | A release keeps every branch the newest published one lists | Ready; gap below |
| `scripts/qualify-upgrade:156-178` | Expected Nixpkgs after an upgrade, branch order from 1.0.33 | Ready; gap below |
| `scripts/full-check-image` | Upgrades from the previous release, which is on unstable | Ready: it exercises the move |
| `.github/workflows/nixpkgs-update.yml` | Follows the branch `flake.nix` names | Ready |
| `nix/modules/default.nix:176-195` | `release.json` takes the pinned branch from the lock | Ready |
| `nix/modules/default.nix:198` | Asserts NixOS ≥ 26.11 | Ready |
| `nix/tests/lifecycle.nix:14` | Preview flake takes the branch from the lock | Ready |
| `tests/nixos/test_installer.py:922`, `1042` | Assert the repository's lock is on `nixos-unstable` | Move commit |
| `desktop/quickshell/Common/UpdatesHelpers.js:348-354`, `assets/scripts/cybexos-runtime:303`, `desktop/quickshell/scripts/theme_hyprlock.py:84` | "unstable" in other senses (version strings, sort order) | Not affected |

Docs that describe the current branch, to update in the move commit:
`README.md:13`, `docs/updates.md:6` and `374-383`, `docs/releasing.md:375`,
`docs/hardware-security.md:4`, `docs/hardware-compatibility.md:22`,
`docs/update-performance-plan.md:19`, and `AGENTS.md:140-154` (the "until
NixOS 26.11 ships" part).

Three gaps, all small:

1. Nothing checks that a release lists its own branch. If the move commit
   pinned `nixos-26.11` but `compatibility.json` still said `["unstable"]`,
   it would publish, machines would move, and every later release would be
   refused on them (`trust.py:308`). Add a source test that the branch of
   `flake.lock` is in `release/compatibility.json`'s `nixos` list.
2. `qualify-upgrade` checks the upgraded lock's revision
   (`scripts/qualify-upgrade:683-684`) but not its `original.ref`, the
   machine's `nixpkgs.url`, or that `system.stateVersion` stayed. Add those
   three checks to the "upgraded" step.
3. No guard stops a move that would take packages back (above). Add one to
   `inputs.newer`: across branches, move only when the machine's revision is
   an ancestor of the release's pin. Either ask GitHub's compare API once per
   pair (cached forever, like `Engine.release_pin`), or let the release name
   its branch-off point and refuse an unstable revision dated after it. A
   machine that fails the guard keeps its Nixpkgs and gets the release alone,
   with a message. John decides whether this is worth it (below).

## How an installed machine moves

The move is an ordinary update (AGENTS.md: "part of the update path, not a
migration"):

1. Software Update offers the release. Its `compatibility.json` lists
   `unstable`, the branch in the machine's `/etc/nixos/flake.lock`, so the
   updater accepts it (`engine.py:183-186`, `trust.py:308`).
2. `cybex update check` also offers NixOS packages, because the release's pin
   is on a later branch (`inputs.newer`). The combined update (`both`) is
   what Software Update prepares.
3. Staging locks Nixpkgs to the release's 26.11 revision and rewrites the one
   literal `nixpkgs.url` in `/etc/nixos/flake.nix` to
   `github:NixOS/nixpkgs/nixos-26.11` (`staging.py:197-199`,
   `engine.py:245-254`). A flake with no or several literal URLs is refused
   before anything changes (`engine.py:240-241`).
4. The prebuilt check, build, trial boot and confirmation run as for any
   update. Kernel and firmware change, so the boot path changes and the trial
   boot is used.
5. From then on the machine's branch is 26.11. It never goes back: a later
   release on unstable would leave it where it is (`inputs.py:153-157`).

Other paths:

- **The release alone** (`cybex update stage cybexos`, or the automatic
  fallback when NixOS packages can't be installed): the machine keeps
  unstable and gets Cybex OS's modules on its old Nixpkgs. That is why
  `"unstable"` stays in `compatibility.json` until no machine runs it
  (AGENTS.md). Afterwards the new updater offers the 26.11 packages
  separately, from the installed release's pin (`engine.py:289` onward).
- **Updaters before 1.0.32** (1.0.25 to 1.0.31) don't know about pins. They
  install the release alone or with the unstable head of that day, as
  `docs/updates.md` describes. Once on the new updater, the machine moves
  like any other. These are the machines the guard above protects.
- **Fresh installations** from the move's ISO: the installer seeds the lock
  from the medium's own `flake.lock` and writes its branch into the machine
  flake (`cybexos-install:676`). They start on 26.11.

## `system.stateVersion`

Where it is set:

- New machines: `installer/cybexos-install:714` writes `"26.05"` into the
  machine-owned `/etc/nixos/machine.nix`.
- The ISO's payload system: `nix/modules/installer-payload.nix:27`
  (`"26.05"`), which `nix/tests/parity.nix:21` compares with an ordinary
  machine. The live ISO itself: `nix/modules/installer.nix:431`.
- Test machines: `nix/tests/machine.nix:9` and the VM tests.
- No Cybex OS module reads it, and no updater changes it
  (`docs/architecture/ownership.md:36`; AGENTS.md: "Do not change
  `system.stateVersion` during routine updates").

Every machine installed so far has `"26.05"`.

What 26.11 gates on it, from the 26.11 source (`nixos/modules`) and release
notes:

- PostgreSQL's default becomes 18 (`postgresql.nix:207`). Its data folder is
  per major version, so an existing PostgreSQL 17 database would seem to
  vanish and a new empty one would start.
- MySQL/MariaDB's first start secures `root@localhost` with `auth_socket`
  (`mysql.nix:591`).
- ZFS stops force-importing root pools at boot (`zfs.nix:357`).
- Major-version defaults for Nextcloud 34, NetBox 4.7, Flarum 2, Grav 2, and
  Hyphanet's names.

Cybex OS enables none of these. People can, in their own modules.

What changing it would and would not do:

- For a **new machine**, `"26.11"` simply records that its state began on
  26.11. Nothing in the default system changes.
- For an **existing machine**, changing it upgrades nothing. It only switches
  those defaults for data that already exists, which is the one thing it
  must not do. The NixOS manual and the option's own assertion
  (`nixos/modules/misc/version.nix:296-300`) say to leave it.

**Recommendation:** in the move commit, new installations get `"26.11"`;
installed machines keep their value.

- Change `installer/cybexos-install:714`,
  `nix/modules/installer-payload.nix:27`, `nix/modules/installer.nix:431` and
  `nix/tests/parity.nix:21` together, so ISO/payload parity still holds.
  Optionally `nix/tests/machine.nix:9` too; the VM tests can stay on
  `"26.05"`, which is what most real machines have.
- Don't touch `machine.nix` on installed machines. It belongs to the machine,
  and rewriting it would be the kind of migration AGENTS.md rules out.
- If John wants installed machines changed anyway, it needs its own updater
  step that refuses when any gated service is enabled, plus a VM test with a
  PostgreSQL database. That is more code for no gain; not recommended.

## Tests before the move

AGENTS.md asks for three things before the move. How each is covered:

1. **VM test of the branch move from an installed release.** The full
   check's image job does this already: it installs the previous release
   from its own ISO and lets that release's updater move the VM to the
   commit under test (`scripts/full-check-image`, `scripts/qualify-upgrade`,
   `docs/releasing.md` "The upgrade"). For the move commit the previous
   release is on unstable, so this run *is* the branch move. Add gap 2's
   checks first, so the job proves the URL and branch moved and the
   stateVersion stayed.
2. **The installer's and `release/promote`'s "unstable" assumptions.** Source
   tests already cover them: `tests/nixos/test_installer.py` (a stable branch
   lock is accepted and written into the flake, around line 1000),
   `tests/nixos/test_release.py:490-513` (promote keeps unstable while stable
   runs it). The image job's two installations prove the ISO on 26.11 end to
   end. Add gap 1's test.
3. **Compatibility follows the branch the machine runs.**
   `tests/nixos/test_lifecycle.py:1397-1530` covers it in source. End to end:
   run the full check once more with `-f from=v1.0.25`. That updater prepares
   the release alone, so the VM stays on unstable and runs the new release
   there; the upgraded updater must then offer the 26.11 packages
   (`qualify-upgrade` "upgradedDiscovery"). Extend that step to also apply
   them and check the move, so the "release alone, then NixOS packages" path
   is covered too.

Expect the first full check on 26.11 to run cold (about 52 minutes for the
checks job, more on a new Nixpkgs): the runners' Nix cache holds unstable
builds.

## Order of work

### 1. Preparation on `main` (now, ordinary changes)

- Don't merge `nixpkgs-update` branches until the move.
- Add the three gaps: the own-branch test, the `qualify-upgrade` checks, and
  (if John wants it) the ancestry guard. Each is a normal change with
  `fast-test`; no release needed.
- Optionally add a `-f from=…` "release alone then NixOS packages" step to
  `qualify-upgrade` (test 3).
- These ship with the next release, which may still be on unstable. That is
  fine: they only read branches.

### 2. The move commit (on a `release-X.Y.Z` branch)

Make it on the release branch, not on `main` first, so the full check covers
it with the release:

- `flake.nix:4` → `github:NixOS/nixpkgs/nixos-26.11`, then
  `nix flake update nixpkgs` (in fast-test's container on The Beast) to the
  26.11 head of that day. One commit, lock included.
- `release/compatibility.json` → `"nixos": ["unstable", "26.11"]`.
- `templates/machine/flake.nix:6` → `nixos-26.11`.
- `system.stateVersion` → `"26.11"` for new installations (four files above).
- `tests/nixos/test_installer.py:922`, `1042` → `nixos-26.11`.
- The docs listed above and `AGENTS.md`'s lifecycle paragraph.
- Re-run the version comparison against the pinned revision and keep the
  "nothing older" result in the release's measurements.
- `VERSION` and `release/notes.md` as for any beta. The notes say what people
  notice: NixOS 26.11 stable base, the NVIDIA 620 driver, kernel 7.3.6.

### 3. The release (its own beta, with ISO and qualification)

- Timing: 1–2 weeks after the branch exists and is built, so from
  **2026-12-04** to **2026-12-11** (first built 2026-11-27).
- Run the full check on `release-X.Y.Z`, then the `from=v1.0.25` run.
- Build the ISO and put it on PXE (`/data/pxe/iso` on The Beast) as AGENTS.md
  describes; only when John asks for it.
- Qualify on hardware: a fresh install from the ISO, and the update of an
  installed machine from the previous release. At least one NVIDIA machine
  (driver 620) and one laptop with thermald (its NixOS service changed in
  26.11) besides the usual ones. Record what was exercised.
- `release/publish X.Y.Z` (beta), merge the release branch into `main`.

### 4. A week on beta

- Watch beta machines: `cybex update status`, failed confirmations, desktop
  health. Fix forward on `main`, staying on 26.11.
- `main` now follows 26.11, and so do the weekly `nixpkgs-update` runs.

### 5. Stable

- `release/promote X.Y.Z` after the week, its passing full check and John's
  OK. It requires the candidate to list `unstable`, which stable machines
  run (`release/promote:146-148`).

### Later

- Keep `"unstable"` in `release/compatibility.json` until no machine runs it
  (AGENTS.md). `release/publish` and `release/promote` refuse dropping it
  early (`release/publish:104-131`, `release/promote:151-154`).
- The next move (27.05, May 2027) follows the same path; `branch_order`
  already knows it.

## Decisions for John

1. **stateVersion:** new installations on `"26.11"`, installed machines keep
   `"26.05"` (recommended), or rewrite installed machines too.
2. **The ancestry guard:** add it (recommended; small), or rely on not
   releasing a newer unstable and accept the risk for pre-1.0.32 updaters and
   hand-moved machines.
3. **Timing:** move in the 2026-12-04 to 12-11 window, or wait for NixOS to
   announce 26.11 (its builds are still called "beta").
4. **Version number:** the next patch (1.0.38 or later), or 1.1.0 to mark the
   new base. AGENTS.md leaves minor bumps to a deliberate decision.
5. **ISO and hardware:** ask for the ISO build and PXE copy; say which
   machines qualify it (at least one NVIDIA).
6. **Stable:** the OK to promote after the week on beta.

## Risks and rolling back

- **A machine whose move fails** (build, trial boot or confirmation) stays on
  its previous generation, on unstable: the trial boot is one-shot and the
  old generation stays the default (`docs/recovery.md`). `cybex update
  rollback ID` restores its lock and `flake.nix` together.
- **A machine that moved and then has problems:** roll back the same way. It
  returns to unstable and its old generation. The updater will offer the
  move again with the next release; a failed system is quarantined from
  being applied again.
- **A bad 26.11 release on beta:** stable machines are untouched until
  promotion. Fix forward on `main` on 26.11. Don't publish a release that
  goes back to unstable: machines that moved would stay on 26.11 anyway
  (`inputs.newer`), and it would have to keep listing `"26.11"`.
- **NVIDIA 620** may behave differently from 595 on some cards. Qualify on
  real hardware; `legacy_580` is unchanged for older cards.
- **A personal module that relied on unstable-only packages** fails the
  build during preparation; the machine keeps its system and the person
  sees why. Since 26.11 is ahead of the pin, this is unlikely now.
- **26.11 point updates** arrive through the weekly `nixpkgs-update` branch
  and a release, as before. NixOS's stable backports are smaller than
  unstable's changes.
- **Machines ahead of 26.11** (old updaters, hand moves): see the guard.

## How to repeat the checks

Run these from a worktree on The Beast with `fast-test run -- …` (they only
evaluate; The Dragon blocks builds and flake checks). The command must be one
line of at most 2,700 bytes, so pass longer scripts compressed and
base64-encoded; the container has no `sed`.

- Branch and channel: `git ls-remote https://github.com/NixOS/nixpkgs
  refs/heads/nixos-26.11` and `curl -sL
  https://channels.nixos.org/nixos-26.11/git-revision`.
- Ancestry: `https://api.github.com/repos/NixOS/nixpkgs/compare/<pin>...<26.11
  rev>` must report `behind_by: 0`.
- Versions: `nix eval --raw github:NixOS/nixpkgs/<rev>#hyprland.version`, or
  one `nix eval --json --impure --file` over a list of attributes for both
  revisions (`import (fetchTarball …) { config.allowUnfree = true; }`).
- Whole system: copy the tree, point `flake.nix` and `flake.lock` at the
  26.11 revision (`nix flake prefetch --json` gives its `narHash` and
  `lastModified`), then `nix flake check --no-build path:<copy>` and
  `tests/fast-test-container python3 scripts/check-prebuilt [--nvidia |
  --catalogue | --xps]` in the copy.
- stateVersion gates: `grep -rn stateVersion nixos/modules | grep '"26.11"'`
  in the 26.11 source, and the release notes'
  `nixos/doc/manual/release-notes/rl-2611.section.md`.
