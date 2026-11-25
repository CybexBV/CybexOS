//! Screen-specific snapshot projections (welcome, disk, account, software, review, progress, network).

use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;
use slint::{Image, Model, ModelRc, VecModel};

use crate::names;
use crate::protocol::{human_size, State};
use crate::software;
use crate::{AppTile, Check, CustomRow, DiskRow, ProfileCard, StageRow, Store, SummaryRow, WifiRow};

use super::{filesystem_label, format_elapsed, model, s, App};

const STAGES: [(&str, &str); 6] = [
    ("Preparing the selected disk", "A GPT layout with the EFI system partition and the Cybex OS root"),
    ("Creating filesystems and encryption", "Your password becomes the disk key"),
    ("Recording hardware and your configuration", "Your settings go into /etc/nixos; your password never enters the Nix store"),
    ("Building and installing your desktop", "Most of it is copied from this medium; the rest downloads"),
    ("Setting up your account and keyboard", ""),
    ("Keeping the tested sources and finishing", "Unmounting and closing encryption before reporting success"),
];

const TIPS: [(&[&str], &str); 6] = [
    (&["Super", "Space"], "opens the launcher: apps, files, calculator and web apps in one place."),
    (&["Super", "Return"], "opens a terminal. Fish is already set up."),
    (&["Super", "K"], "shows every keyboard shortcut the desktop actually has."),
    (&["Super", "Tab"], "opens the window overview with live thumbnails."),
    (&["Super", "I"], "talks to Wiz, the Cybex OS Assistant. Hold it to dictate."),
    (&["Super", "Ctrl", "V"], "opens clipboard history. Ctrl+P pins an entry."),
];

impl App {
    pub(super) fn apply_welcome(&self, store: &Store, state: &State) {
        let phase = state.phase.as_str();
        let started = !matches!(phase, "loading" | "development" | "preflight");
        let mut checks = Vec::new();
        let firmware = if !state.firmware.uefi {
            Check { label: s("Firmware"), value: s("Legacy BIOS boot"), detail: s("Start the installer in UEFI mode"), state: 4 }
        } else if state.firmware.secure_boot {
            Check { label: s("Firmware"), value: s("UEFI · Secure Boot on"), detail: s("This installer is not signed for Secure Boot yet"), state: 4 }
        } else {
            Check { label: s("Firmware"), value: s("UEFI · Secure Boot off"), detail: s(""), state: 0 }
        };
        checks.push(firmware);
        let net = &state.network;
        let network_issue = state.hardware.get("networkIssues").and_then(Value::as_array)
            .and_then(|issues| issues.first()).and_then(Value::as_str).unwrap_or("");
        checks.push(if net.connected {
            let kind = if net.kind == "wifi" { format!("Wi-Fi · {}", net.name) } else { format!("Ethernet · {}", net.interface) };
            let address = if net.address.is_empty() { String::new() } else { format!(" · {}", net.address) };
            Check { label: s("Network"), value: s(format!("{kind}{address}")), detail: s(network_issue), state: if network_issue.is_empty() { 0 } else { 3 } }
        } else if net.busy && net.wifi.interface.is_empty() && !net.ethernet_cable {
            Check { label: s("Network"), value: s("Looking for a connection…"), detail: s(""), state: 1 }
        } else {
            Check {
                label: s("Network"),
                value: s(if net.ethernet_cable { "Cable connected, no address yet" } else { "Not connected" }),
                detail: s(if network_issue.is_empty() { "Needed to download parts of your desktop" } else { network_issue }),
                state: 3,
            }
        });
        checks.push(match phase {
            "loading" => Check { label: s("Release"), value: s("Verifying this installation medium…"), detail: s(&net.message), state: 1 },
            "development" => Check { label: s("Release"), value: s("Unreleased development build"), detail: s("Use only on a disposable or backed-up disk"), state: 3 },
            "preflight" => Check { label: s("Release"), value: s("Could not be verified"), detail: s("See the message on the left"), state: 4 },
            _ if state.development => Check { label: s("Release"), value: s(format!("Cybex OS {}", self.statics.version)), detail: s("Bundled installation source"), state: 0 },
            _ => Check {
                label: s("Release"),
                value: s(format!("Cybex OS {}", self.statics.version)),
                detail: s(state.release.split(" • ").nth(1).unwrap_or("")),
                state: 0,
            },
        });
        let available = state.disks.iter().filter(|d| d.available).count();
        checks.push(if !started {
            Check { label: s("Disks"), value: s("Checked after the release"), detail: s(""), state: 2 }
        } else if available == 0 {
            Check { label: s("Disks"), value: s(format!("{} found · none can be used", state.disks.len())), detail: s(format!("Needs a disk of at least {} GiB", self.statics.layout.get("minimumDiskGiB").and_then(Value::as_i64).unwrap_or(64))), state: 3 }
        } else {
            Check { label: s("Disks"), value: s(format!("{} found · {available} can be used", state.disks.len())), detail: s(""), state: 0 }
        });
        let graphics = if state.graphics.is_empty() { "Firmware framebuffer".to_string() } else { state.graphics.join(" + ") };
        let graphics_blocker = state.hardware.get("blockers").and_then(Value::as_array)
            .and_then(|items| items.first()).and_then(Value::as_str).unwrap_or("");
        let graphics_detail = state.hardware.get("graphicsDetail").and_then(Value::as_str)
            .unwrap_or("Desktop compatibility has not been verified on this computer");
        checks.push(Check {
            label: s("Graphics"),
            value: s(graphics),
            detail: s(if graphics_blocker.is_empty() { graphics_detail } else { graphics_blocker }),
            state: if graphics_blocker.is_empty() { 2 } else { 4 },
        });
        let (support_identity, support_detail) = state.hardware_support();
        store.set_hardware_identity(s(&support_identity));
        store.set_hardware_detail(s(&support_detail));
        checks.push(Check {
            label: s("Hardware"), value: s(support_identity), detail: s(support_detail), state: 2,
        });
        let gib = state.memory as f64 / 1_073_741_824.0;
        checks.push(Check {
            label: s("Memory"),
            value: s(format!("{:.0} GB", (state.memory as f64 / 1e9).round())),
            detail: s(if gib < 7.5 { "Under 8 GB: the installation can be slow" } else { "" }),
            state: if gib < 7.5 { 3 } else { 0 },
        });
        let ok = checks.iter().all(|c| c.state == 0);
        let running = checks.iter().any(|c| c.state == 1);
        // Wiz checks while a check runs. A warning, an error or a question
        // is your move, except a test build you have already accepted.
        let asks = matches!(phase, "development" | "preflight") || checks.iter().any(|c| c.state >= 3 && c.label != "Release");
        store.set_check_pose(s(if running { "thinking" } else if asks { "needs-input" } else { "happy" }));
        store.set_checks(model(store.get_checks(), checks));
        store.set_check_summary(s(if running { "checking…" } else if ok { "all good" } else if !net.connected { "needs a network" } else { "" }));
        store.set_busy(running);
        store.set_can_start(phase == "setup" && graphics_blocker.is_empty());
        store.set_offline(!net.connected);
        store.set_development(phase == "development");
        store.set_development_message(s(if state.message.is_empty() { "This is an unreleased development build." } else { state.message.as_str() }));
        store.set_preflight_error(s(if phase == "preflight" { state.error.as_str() } else { "" }));
    }

    pub(super) fn apply_disks(&self, store: &Store, state: &State) {
        let show_all = store.get_show_all_disks();
        let rows: Vec<DiskRow> = state
            .disks
            .iter()
            .filter(|d| d.available || show_all)
            .map(|d| {
                let labels: Vec<String> = d.filesystems.iter().map(|f| filesystem_label(f)).collect();
                let contents = if labels.is_empty() { "empty or unrecognised".to_string() } else { format!("has {}", labels.join(", ")) };
                DiskRow {
                    path: s(&d.path),
                    model: s(if d.model.is_empty() { "Disk" } else { d.model.as_str() }),
                    size: s(human_size(d.size)),
                    bus: s(&d.bus),
                    contents: s(contents),
                    serial: s(format!("{} · {} GiB", if d.serial.is_empty() { "unavailable" } else { d.serial.as_str() }, d.size / 1_073_741_824)),
                    available: d.available,
                    reason: s(&d.reason),
                    selected: d.path == state.draft.disk,
                    removable: d.bus == "USB",
                }
            })
            .collect();
        store.set_disks(model(store.get_disks(), rows));
        store.set_hidden_disks(state.disks.iter().filter(|d| !d.available).count() as i32);
        store.set_encrypted(state.draft.encrypted);
        store.set_disk_chosen(state.disks.iter().any(|d| d.available && d.path == state.draft.disk));
        store.set_disk_error(s(if state.phase == "setup" && state.draft.screen == "disk" { state.error.as_str() } else { "" }));
    }

    pub(super) fn apply_account(&mut self, store: &Store, state: &State) {
        let draft = &state.draft;
        if !self.synced_account {
            // After a (re)connect the daemon's draft fills the fields once;
            // from then on typing here is the source and is sent as drafts.
            self.synced_account = true;
            self.user_edited = draft.user_edited;
            self.host_edited = draft.host_edited;
            store.set_full_name(s(&draft.full_name));
            store.set_username(s(&draft.username));
            store.set_hostname(s(if draft.host_edited && !draft.hostname.is_empty() {
                draft.hostname.clone()
            } else {
                names::hostname_for(&draft.username)
            }));
            store.set_host_edited(self.host_edited);
            self.update_account(store, "", "");
        }
        let layout = self.statics.layouts.iter().find(|l| l.0 == draft.layout);
        store.set_unlock_note(s(if draft.encrypted {
            format!("Also unlocks the disk at startup, typed with the {} layout", layout.map_or("US", |l| l.1.as_str()))
        } else {
            String::new()
        }));
        let error = if state.phase == "setup" && state.draft.screen == "account" { state.error.clone() } else { String::new() };
        store.set_account_error(s(&error));
        // The daemon marks a review in flight until the worker answers.
        store.set_review_busy(state.review_pending);
        if state.phase == "installing" || state.phase == "complete" {
            store.set_password(s(""));
            store.set_confirm(s(""));
        }
    }

    pub(super) fn update_account(&self, store: &Store, user_note: &str, host_note: &str) {
        let username = store.get_username().to_string();
        let hostname = store.get_hostname().to_string();
        let full_name = store.get_full_name().to_string();
        store.set_name_help(s(names::full_name_problem(&full_name).unwrap_or("")));
        let reserved = self.reserved.iter().any(|r| *r == username) || username.starts_with("nixbld");
        let (help, tone) = if !user_note.is_empty() {
            (user_note.to_string(), 3)
        } else if username.is_empty() {
            ("Lowercase letters, digits and hyphens. Starts with a letter.".to_string(), 0)
        } else if reserved {
            (format!("“{username}” is reserved by the system. Choose another username."), 2)
        } else {
            ("Looks good".to_string(), 1)
        };
        store.set_username_help(s(help));
        store.set_username_tone(tone);
        store.set_username_count(s(format!("{}/{}", username.len(), names::MAX_LEN)));
        let host_valid = names::is_valid(&hostname) && hostname != "root" && hostname != "nixos";
        let (host_help, host_tone) = if !host_note.is_empty() {
            (host_note.replace("names are lowercase", "computer names are lowercase"), 3)
        } else if !host_valid {
            ("Lowercase letters, digits and hyphens. Starts with a letter.".to_string(), if hostname.is_empty() { 0 } else { 2 })
        } else if self.state.as_ref().is_none_or(|st| st.draft.feature("localNetworkServices")) {
            (format!("Visible on your network as {hostname}.local"), 0)
        } else {
            (String::new(), 0)
        };
        store.set_hostname_help(s(host_help));
        store.set_hostname_tone(host_tone);
        store.set_home_note(s(if username.is_empty() { String::new() } else { format!("Home folder /home/{username}") }));
        let password = store.get_password();
        let confirm = store.get_confirm();
        let length = password.chars().count();
        store.set_strength(match length {
            0 => 0,
            1..=7 => 1,
            8..=11 => 2,
            12..=15 => 3,
            _ => 4,
        });
        let (confirm_help, confirm_tone) = if confirm.is_empty() {
            (if length > 0 && length < 8 { "At least 8 characters." } else { "" }, if length > 0 && length < 8 { 2 } else { 0 })
        } else if confirm == password {
            ("Passwords match", 1)
        } else if confirm.chars().count() >= length {
            ("Passwords don't match", 2)
        } else {
            ("", 0)
        };
        store.set_confirm_help(s(confirm_help));
        store.set_confirm_tone(confirm_tone);
        store.set_can_review(
            names::is_valid(&username)
                && !reserved
                && host_valid
                && names::full_name_problem(&full_name).is_none()
                && length >= 8
                && confirm == password,
        );
    }

    // ── software ─────────────────────────────────────────────────────────────

    pub(super) fn load_software(&mut self) {
        let software = &self.statics.software;
        let mut icons = HashMap::new();
        let included = software.profiles.iter().flat_map(|profile| profile.includes.iter().map(|item| &item.icon));
        for icon in software.apps.values().map(|app| &app.icon).chain(included) {
            if icon.starts_with('/') && icon.ends_with(".png") && !icons.contains_key(icon) {
                if let Ok(image) = Image::load_from_path(std::path::Path::new(icon)) {
                    icons.insert(icon.clone(), image);
                }
            }
        }
        self.icons = icons;
        self.tiles = software
            .profiles
            .iter()
            .map(|profile| {
                let tiles: Vec<AppTile> = software::tiles(profile, software)
                    .into_iter()
                    .map(|tile| {
                        let icon = self.icons.get(tile.icon).cloned();
                        AppTile {
                            name: s(tile.name),
                            mono: s(if tile.mono || icon.is_none() { software::monogram(tile.name) } else { String::new() }),
                            icon: icon.unwrap_or_default(),
                        }
                    })
                    .collect();
                (profile.id.clone(), ModelRc::new(VecModel::from(tiles)))
            })
            .collect();
    }

    pub(super) fn apply_software(&self, store: &Store, state: &State) {
        let draft = &state.draft;
        let software = &self.statics.software;
        let online = state.network.connected;
        let proprietary = draft.feature("proprietary");
        let cards: Vec<ProfileCard> = software
            .profiles
            .iter()
            .map(|profile| {
                let available = profile.on_medium || online;
                let (size, tone) = software::size_tag(profile, online);
                ProfileCard {
                    id: s(&profile.id),
                    name: s(&profile.name),
                    summary: s(&profile.summary),
                    icon: s(&profile.icon),
                    selected: available && draft.profiles.contains(&profile.id),
                    available,
                    recommended: profile.default,
                    size: s(size),
                    size_tone: s(tone),
                    vendor: s(software::vendor_tag(profile, online, proprietary)),
                    apps: self.tiles.get(&profile.id).cloned().unwrap_or_default(),
                }
            })
            .collect();
        store.set_profiles(model(store.get_profiles(), cards));
        store.set_always_included(s(software::always_included(proprietary)));
        let (strong, note, icon) = software::footer(software, &state.software);
        store.set_software_note_strong(s(strong));
        store.set_software_note(s(note));
        store.set_software_note_icon(s(icon));
        store.set_software_error(s(if state.phase == "setup" && draft.screen == "software" { state.error.as_str() } else { "" }));

        // The Customize sheet: each chosen profile's apps, then the switches.
        let row = |kind: i32, id: &str, title: String, detail: String| CustomRow {
            kind,
            id: s(id),
            title: s(title),
            detail: s(detail),
            enabled: true,
            ..CustomRow::default()
        };
        let mut rows = Vec::new();
        let chosen = software::customized(software, draft, online);
        if chosen.is_empty() {
            rows.push(row(3, "", "No profile is chosen: only the essentials are installed. Choose one on the Software step.".into(), String::new()));
        }
        for profile in chosen {
            let mut heading = row(0, &profile.id, profile.name.to_uppercase(), String::new());
            heading.aux = s(format!("{} app{}", profile.apps.len(), if profile.apps.len() == 1 { "" } else { "s" }));
            rows.push(heading);
            for id in &profile.apps {
                let Some(app) = software.apps.get(id) else { continue };
                let allowed = app.free || proprietary;
                let detail = match (app.free, proprietary) {
                    (true, _) => "Prebuilt by NixOS",
                    (false, true) => "Downloaded from the vendor · proprietary license",
                    (false, false) => "Proprietary license · needs proprietary applications",
                };
                let icon = self.icons.get(&app.icon).cloned();
                rows.push(CustomRow {
                    mono: s(if icon.is_none() { software::monogram(&app.name) } else { String::new() }),
                    icon: icon.unwrap_or_default(),
                    on: allowed && !draft.apps_off.contains(id),
                    enabled: allowed,
                    ..row(1, id, app.name.clone(), detail.into())
                });
            }
            if !profile.includes.is_empty() {
                let names: Vec<&str> = profile.includes.iter().map(|item| item.name.as_str()).collect();
                rows.push(row(3, "", format!("Also includes {}.", names.join(" · ")), String::new()));
            }
        }
        rows.push(row(0, "", "SYSTEM FEATURES".into(), String::new()));
        for (key, name, detail) in &self.statics.features {
            rows.push(CustomRow {
                symbol: s(software::feature_icon(key)),
                on: draft.feature(key),
                ..row(2, key, name.clone(), detail.clone())
            });
            if key == "proprietary" && !proprietary {
                let mut note = row(3, "", "Off: unfree apps and Steam are left out, and Claude Code, Chrome and 1Password aren't installed. Codex still is.".into(), String::new());
                note.warn = true;
                rows.push(note);
            }
        }
        let height: f32 = rows.iter().map(|r| match r.kind { 0 => 40.0, 3 => 46.0, _ => 52.0 }).sum();
        store.set_custom_height(height);
        store.set_custom_rows(model(store.get_custom_rows(), rows));
    }

    pub(super) fn apply_review(&self, store: &Store, state: &State) {
        let draft = &state.draft;
        // Hardware facts remain useful even before a disk has been selected.
        store.set_nvidia(state.nvidia());
        store.set_nvidia_open(draft.nvidia_open);
        let selection = state.hardware.get("nvidiaSelection");
        store.set_nvidia_open_available(selection.and_then(|s| s.get("open")).and_then(Value::as_bool).unwrap_or(true));
        store.set_nvidia_closed_available(selection.and_then(|s| s.get("closed")).and_then(Value::as_bool).unwrap_or(true));
        store.set_gpu_names(s(if state.graphics.is_empty() { "NVIDIA graphics".into() } else { state.graphics.join(" + ") }));
        let Some(disk) = state.disks.iter().find(|d| d.path == draft.disk) else { return };
        let model_name = if disk.model.is_empty() { format!("The disk {}", disk.path) } else { disk.model.clone() };
        let short = model_name
            .split_whitespace()
            .filter(|w| !w.chars().next().is_some_and(|c| c.is_ascii_digit()) || !w.ends_with("B"))
            .collect::<Vec<_>>()
            .join(" ");
        store.set_erase_title(s(format!("{model_name} will be erased")));
        let labels: Vec<String> = disk.filesystems.iter().map(|f| filesystem_label(f)).collect();
        let including = if labels.is_empty() { String::new() } else { format!(", including {}", labels.join(" and ")) };
        store.set_erase_detail(s(format!(
            "Every partition and file on {} ({}) will be deleted{including}.",
            disk.path,
            human_size(disk.size)
        )));
        store.set_erase_button(s(format!("Erase {} & install", if disk.model.is_empty() || short.len() > 26 { "disk" } else { short.as_str() })));
        let now = self.now();
        let zone_title = self.zones.as_ref().and_then(|z| z.get(&draft.timezone)).map(|z| z.city.clone()).unwrap_or_else(|| draft.timezone.clone());
        let clock = self.zones.as_ref().map(|z| z.clock(&draft.timezone, now, false)).unwrap_or_default();
        let offset = self.zones.as_ref().map(|z| z.long_offset(&draft.timezone, now)).unwrap_or_default();
        let language = self.statics.languages.iter().find(|l| l.0 == draft.locale).map_or(draft.locale.clone(), |l| l.1.clone());
        let layout = self.statics.layouts.iter().find(|l| l.0 == draft.layout);
        let console = layout.map_or(draft.layout.clone(), |l| l.2.clone());
        let hostname = if draft.host_edited && !draft.hostname.is_empty() { draft.hostname.clone() } else { names::hostname_for(&draft.username) };
        let row = |label: &str, value: String, detail: String, action: &str, action_label: &str, warn: bool, mono: bool| SummaryRow {
            label: s(label),
            value: s(value),
            detail: s(detail),
            action: s(action),
            action_label: s(action_label),
            warn,
            mono,
        };
        let account = if draft.full_name.trim().is_empty() { draft.username.clone() } else { format!("{} · {}", draft.full_name.trim(), draft.username) };
        let mut left = vec![
            row(
                "Account",
                account,
                format!("{} · home /home/{}", if draft.encrypted { "signs in after disk unlock" } else { "password login" }, draft.username),
                "account",
                "Change",
                false,
                false,
            ),
            row("Time zone", format!("{zone_title} · {clock} now"), format!("{} · {offset}", draft.timezone), "timezone", "Change", false, false),
            row(
                "Encryption",
                if draft.encrypted { "On · LUKS2".into() } else { "Off · readable by anyone with the disk".into() },
                if draft.encrypted { "unlocked with your password at startup".into() } else { String::new() },
                "disk",
                "Change",
                !draft.encrypted,
                false,
            ),
        ];
        if state.nvidia() {
            left.push(row(
                "Graphics",
                format!("NVIDIA · {}", if draft.nvidia_open { "open kernel driver" } else { "proprietary legacy driver" }),
                "Selected for the detected GPU device IDs".into(),
                "gpu",
                "Customize",
                false,
                false,
            ));
        }
        let right = vec![
            row("Computer", hostname, String::new(), "account", "Change", false, true),
            row("Language", format!("{language} · keyboard {}", layout.map_or(draft.layout.as_str(), |l| l.1.as_str())), format!("locale {} · disk unlock keymap {console}", draft.locale), "language", "Change", false, false),
            {
                let (value, detail) = software::review(&self.statics.software, &state.software, draft.feature("proprietary"));
                row("Software", value, detail, "software", "Change", false, false)
            },
            row(
                "Release",
                format!("Cybex OS {}", self.statics.version),
                if state.development { "bundled installation source".into() } else { "exact release source".into() },
                "",
                "",
                false,
                false,
            ),
        ];
        store.set_summary_left(model(store.get_summary_left(), left));
        store.set_summary_right(model(store.get_summary_right(), right));
        store.set_review_error(s(if state.phase == "review" { state.error.as_str() } else { "" }));
    }

    pub(super) fn apply_progress(&mut self, store: &Store, state: &State) {
        let stage = state.stage.clamp(0, 6) as i32;
        store.set_stage(stage);
        let rows: Vec<StageRow> = STAGES
            .iter()
            .enumerate()
            .map(|(i, (title, detail))| {
                let n = i as i32 + 1;
                let current = n == stage.max(1) && state.phase == "installing";
                StageRow {
                    title: s(*title),
                    detail: s(if current && !state.message.is_empty() { state.message.as_str() } else { detail }),
                    state: if n < stage || state.phase == "complete" { 0 } else if current { 1 } else { 2 },
                }
            })
            .collect();
        store.set_stages(model(store.get_stages(), rows));
        let (keys, text) = TIPS[(stage.max(1) as usize - 1) % TIPS.len()];
        store.set_tip_keys(model(store.get_tip_keys(), keys.iter().map(|k| s(*k)).collect()));
        store.set_tip_text(s(text));
        // The worker waits for a lost connection with this message
        // (lifecycle/cybexos/installer_network.py); Wiz checks meanwhile.
        let waiting = state.phase == "installing" && state.message.starts_with("Connection interrupted");
        store.set_install_pose(s(if waiting { "thinking" } else { "working" }));
        self.elapsed_base = (state.elapsed, Instant::now());
        store.set_elapsed(s(format_elapsed(state.elapsed)));
        if let Some(result) = &state.result {
            store.set_done_name(s(names::given_name(&state.draft.full_name, &result.username)));
            store.set_done_user(s(&result.username));
            store.set_done_host(s(&result.hostname));
            store.set_done_encrypted(result.encrypted);
        }
        // Stopped before any disk change, or failed after it. Wiz waits for
        // you when the fix is yours, and is sorry when something failed.
        let error = state.error.clone();
        let (kicker, title, body, check_label, check_value, steps, action, pose) = if state.phase == "cancelled" {
            ("STOPPED · NO DISK WAS CHANGED", "Installation cancelled.", "Nothing was written to any disk. Start again whenever you are ready.".to_string(), "", String::new(), vec![], "retry", "needs-input")
        } else if !state.firmware.uefi {
            (
                "STOPPED BEFORE ANY DISK CHANGE",
                "This computer started in legacy BIOS mode.",
                "Cybex OS installs only in UEFI mode. None of your disks have been touched.".to_string(),
                "Boot mode",
                "Legacy BIOS".to_string(),
                vec!["Restart and open the boot menu (often F12, F11 or Esc).", "Choose the UEFI entry for this USB drive or network boot.", "If there is none, enable UEFI boot in the firmware settings."],
                // A BIOS boot cannot request the firmware settings screen.
                "restart",
                "needs-input",
            )
        } else if state.firmware.secure_boot || error.contains("Secure Boot") {
            (
                "STOPPED BEFORE ANY DISK CHANGE",
                "Secure Boot is turned on.",
                "This installer isn't signed for Secure Boot yet, and it never turns Secure Boot off for you. None of your disks have been touched.".to_string(),
                "Secure Boot",
                "Enabled".to_string(),
                vec!["Keep Secure Boot enabled.", "This computer needs signed installation media and a qualified key enrollment path.", "Use a qualified signed installer when one is available."],
                "",
                "needs-input",
            )
        } else {
            ("STOPPED BEFORE ANY DISK CHANGE", "The installer could not continue.", format!("{}. None of your disks have been touched.", error.trim_end_matches('.')), "", String::new(), vec!["Open the details to see what happened.", "Fix the cause, for example the network connection.", "Choose Try again."], "retry", "sorry")
        };
        store.set_stop_kicker(s(kicker));
        store.set_stop_title(s(title));
        store.set_stop_body(s(body));
        store.set_stop_check_label(s(check_label));
        store.set_stop_check_value(s(check_value));
        store.set_stop_steps(model(store.get_stop_steps(), steps.into_iter().map(s).collect()));
        store.set_stop_action(s(action));
        store.set_stop_pose(s(pose));
        store.set_fail_title(s("Installation stopped."));
        store.set_fail_message(s(if error.is_empty() { "The installation worker stopped." } else { error.as_str() }));
        store.set_fail_touched(state.disk_touched);
    }

    pub(super) fn apply_network(&self, store: &Store, state: &State) {
        let net = &state.network;
        store.set_net_connected(net.connected);
        store.set_net_kind(s(&net.kind));
        store.set_net_name(s(&net.name));
        store.set_net_address(s(&net.address));
        store.set_net_busy(net.busy);
        store.set_net_error(s(&net.error));
        store.set_net_message(s(&net.message));
        store.set_wifi_device(!net.wifi.interface.is_empty());
        let rows: Vec<WifiRow> = net
            .wifi
            .networks
            .iter()
            .map(|n| {
                let security = n.security.to_uppercase();
                WifiRow {
                    ssid: s(&n.ssid),
                    bars: ((n.signal + 12) / 25).clamp(0, 4) as i32,
                    secure: !(security.is_empty() || security == "--" || security == "NONE" || security == "OPEN"),
                    enterprise: security.contains("EAP") || security.contains("802.1X"),
                    connected: n.connected,
                }
            })
            .collect();
        let selected = store.get_wifi_selected();
        let previous = (selected >= 0).then(|| store.get_wifi().row_data(selected as usize)).flatten();
        let same_network = previous.as_ref().is_some_and(|old| {
            rows.get(selected as usize).is_some_and(|new| {
                old.ssid == new.ssid && old.secure == new.secure && old.enterprise == new.enterprise
            })
        });
        // Do not retain credentials if a rescan reorders/replaces the network
        // at the selected index. Signal-only changes preserve the input field.
        if rows.iter().any(|r| r.connected) || selected >= 0 && !same_network {
            store.set_wifi_selected(-1);
        }
        store.set_wifi(model(store.get_wifi(), rows));
    }
}
