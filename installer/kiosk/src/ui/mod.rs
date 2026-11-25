//! The controller: daemon snapshots in, Store properties out, requests back.
//!
//! The daemon's draft is authoritative. The only things kept here are what a
//! screen needs between snapshots: the time zone picker's search, the Wi-Fi
//! row being joined, clocks and the rendered maps.

mod handlers;
mod screens;
mod timezone;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, Timer, TimerMode, VecModel};

use crate::client::{Client, Event};
use crate::map::LandMask;
use crate::protocol::{human_size, Details, Message, State, Static, Usb};
use crate::zones::{Hit, ZoneDb};
use crate::{AppTile, Choice, InstallerWindow, Store, UsbRow};

/// What a filesystem type means to someone about to erase it.
pub fn filesystem_label(kind: &str) -> String {
    match kind {
        "ntfs" => "Windows (NTFS)",
        "vfat" | "fat" | "fat16" | "fat32" => "FAT/EFI",
        "exfat" => "exFAT",
        "ext4" => "Linux (ext4)",
        "ext3" | "ext2" => "Linux (ext)",
        "btrfs" => "Linux (Btrfs)",
        "xfs" => "Linux (XFS)",
        "swap" => "swap",
        "crypto_LUKS" => "encrypted data (LUKS)",
        "LVM2_member" => "LVM volumes",
        "zfs_member" => "ZFS",
        "linux_raid_member" => "RAID data",
        "apfs" => "macOS (APFS)",
        "hfsplus" => "macOS (HFS+)",
        "iso9660" | "udf" => "an installer image",
        other => other,
    }
    .to_string()
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn s(text: impl AsRef<str>) -> SharedString {
    SharedString::from(text.as_ref())
}

fn model<T: Clone + PartialEq + 'static>(current: ModelRc<T>, items: Vec<T>) -> ModelRc<T> {
    let Some(rows) = current.as_any().downcast_ref::<VecModel<T>>() else {
        return ModelRc::new(VecModel::from(items));
    };
    for (i, item) in items.iter().enumerate() {
        if i >= rows.row_count() {
            rows.push(item.clone());
        } else if rows.row_data(i).as_ref() != Some(item) {
            rows.set_row_data(i, item.clone());
        }
    }
    while rows.row_count() > items.len() {
        rows.remove(rows.row_count() - 1);
    }
    current
}

pub struct App {
    window: slint::Weak<InstallerWindow>,
    client: Client,
    statics: Static,
    zones: Option<ZoneDb>,
    state: Option<State>,
    mask: LandMask,
    reserved: Vec<String>,
    synced_account: bool,
    user_edited: bool,
    host_edited: bool,
    tz_pick: String,
    tz_hits: Vec<Hit>,
    tz_minute: i64,
    mini_key: String,
    big_key: String,
    region_seen: String,
    elapsed_base: (i64, Instant),
    toast_until: Option<Instant>,
    sheet_opened: Option<Instant>,
    details_pending: bool,
    timers: Vec<Timer>,
    preview_now: Option<i64>,
    /// App icons by path, and each profile's card tiles, built once per
    /// static message so unchanged cards keep comparing equal.
    icons: HashMap<String, Image>,
    tiles: HashMap<String, ModelRc<AppTile>>,
    /// Where the Reduce motion switch outlasts a restart (src/motion.rs).
    motion_file: Option<std::path::PathBuf>,
}

pub type Shared = Rc<RefCell<App>>;

impl App {
    pub fn new(window: &InstallerWindow, client: Client) -> Shared {
        let app = Rc::new(RefCell::new(App {
            window: window.as_weak(),
            client,
            statics: Static::default(),
            zones: None,
            state: None,
            mask: LandMask::embedded(),
            reserved: vec!["root".into(), "nixos".into()],
            synced_account: false,
            user_edited: false,
            host_edited: false,
            tz_pick: String::new(),
            tz_hits: Vec::new(),
            tz_minute: -1,
            mini_key: String::new(),
            big_key: String::new(),
            region_seen: String::new(),
            elapsed_base: (0, Instant::now()),
            toast_until: None,
            sheet_opened: None,
            details_pending: false,
            timers: Vec::new(),
            preview_now: None,
            icons: HashMap::new(),
            tiles: HashMap::new(),
            motion_file: None,
        }));
        handlers::bind(&app, window);
        let timer = Timer::default();
        let weak = Rc::downgrade(&app);
        timer.start(TimerMode::Repeated, Duration::from_secs(1), move || {
            if let Some(app) = weak.upgrade() {
                App::second(&app);
            }
        });
        app.borrow_mut().timers.push(timer);
        app
    }

    /// Reduced motion as the session left it, or as the environment asks,
    /// and where the menu's switch keeps its choice.
    pub fn init_motion(&mut self, file: Option<std::path::PathBuf>, env: Option<&str>) {
        let on = crate::motion::initial(file.as_deref(), env);
        self.motion_file = file;
        if let Some(window) = self.window() {
            window.global::<Store>().set_reduced_motion(on);
        }
    }

    /// Previews render a fixed moment.
    pub fn set_preview_time(&mut self, time: i64) {
        self.preview_now = Some(time);
    }

    fn now(&self) -> i64 {
        self.preview_now.unwrap_or_else(now)
    }

    fn window(&self) -> Option<InstallerWindow> {
        self.window.upgrade()
    }

    fn send(&self, request: Value) {
        self.client.send(request);
    }

    fn draft(&self, values: Value) {
        self.send(json!({"action": "draft", "values": values}));
    }

    pub fn handle(app: &Shared, event: Event) {
        match event {
            Event::Connected => {
                let mut this = app.borrow_mut();
                this.synced_account = false;
                this.details_pending = false;
                this.send(json!({"action": "hello", "client": "screen"}));
            }
            Event::Disconnected => {
                if let Some(window) = app.borrow().window() {
                    window.global::<Store>().set_connected(false);
                }
            }
            Event::Message(message) => App::message(app, message),
        }
    }

    pub fn message(app: &Shared, message: Message) {
        match message {
            Message::Static(statics) => app.borrow_mut().apply_static(*statics),
            Message::State(state) => app.borrow_mut().apply_state(*state),
            Message::Details(details) => app.borrow_mut().apply_details(details),
            Message::Usb(usb) => app.borrow_mut().apply_usb(usb),
            Message::Restart => {
                // The daemon wrote the new keymap; systemd starts us again
                // with it. Nothing on screen needs saving.
                let _ = slint::quit_event_loop();
                std::process::exit(0);
            }
        }
    }

    // ── static data ──────────────────────────────────────────────────────────

    pub fn apply_static(&mut self, statics: Static) {
        self.zones = Some(ZoneDb::new(&statics.zones, &statics.countries, &statics.aliases, &statics.tzdata));
        self.reserved = statics.reserved.clone();
        self.statics = statics;
        self.mini_key.clear();
        self.big_key.clear();
        self.load_software();
        let Some(window) = self.window() else { return };
        let store = window.global::<Store>();
        store.set_version(s(&self.statics.version));
        store.set_tz_data(s(&self.statics.tzdata));
        if let Some(esp) = self.statics.layout.get("espGiB").and_then(Value::as_i64) {
            store.set_esp_gib(s(esp.to_string()));
        }
        if let Some(minimum) = self.statics.layout.get("minimumDiskGiB").and_then(Value::as_i64) {
            store.set_minimum_gib(s(minimum.to_string()));
        }
        if let Some(state) = self.state.take() {
            self.apply_state(state);
        }
    }

    // ── state ────────────────────────────────────────────────────────────────

    pub fn apply_state(&mut self, state: State) {
        let Some(window) = self.window() else { return };
        let store = window.global::<Store>();
        store.set_connected(true);
        if self.state.as_ref() == Some(&state) {
            return;
        }
        self.state = Some(state.clone());
        let draft = &state.draft;
        store.set_power_busy(state.power.busy);
        store.set_power_message(s(if !state.power.error.is_empty() {
            &state.power.error
        } else if state.power.busy {
            match state.power.kind.as_str() {
                "poweroff" => "Powering off…",
                "firmware" => "Restarting into firmware settings…",
                _ => "Restarting…",
            }
        } else {
            ""
        }));

        // Routing: the worker's phase decides, the draft picks the setup step.
        let screen = match state.phase.as_str() {
            "setup" => match draft.screen.as_str() {
                "disk" | "account" | "software" => draft.screen.clone(),
                _ => "welcome".into(),
            },
            "review" => "review".into(),
            "installing" => "installing".into(),
            "complete" => "done".into(),
            "error" if state.disk_touched => "failed".into(),
            "error" | "cancelled" => "stopped".into(),
            _ => "welcome".into(),
        };
        if store.get_screen() != screen.as_str() {
            store.set_screen(s(&screen));
        }
        if matches!(state.phase.as_str(), "installing" | "complete") && !store.get_sheet().is_empty()
            && store.get_sheet() != "log" && store.get_sheet() != "tools" && store.get_sheet() != "wifi"
        {
            store.set_sheet(s(""));
        }

        // Language and keyboard.
        let language = self.statics.languages.iter().find(|l| l.0 == draft.locale);
        store.set_language_name(s(language.map_or(draft.locale.as_str(), |l| l.1.as_str())));
        store.set_language_code(s(draft.locale.get(..2).unwrap_or("").to_uppercase()));
        let layout = self.statics.layouts.iter().find(|l| l.0 == draft.layout);
        store.set_layout_name(s(layout.map_or(draft.layout.as_str(), |l| l.1.as_str())));
        store.set_layout_code(s(draft.layout.to_uppercase()));
        store.set_languages(model(store.get_languages(),
            self.statics
                .languages
                .iter()
                .map(|(key, label)| Choice { key: s(key), label: s(label), detail: s(key), selected: *key == draft.locale })
                .collect(),
        ));
        store.set_layouts(model(store.get_layouts(),
            self.statics
                .layouts
                .iter()
                .map(|(key, label, console)| Choice {
                    key: s(key),
                    label: s(label),
                    detail: s(if key == console { key.clone() } else { format!("{key} · {console}") }),
                    selected: *key == draft.layout,
                })
                .collect(),
        ));

        self.apply_welcome(&store, &state);
        self.apply_disks(&store, &state);
        self.apply_account(&store, &state);
        self.apply_software(&store, &state);
        self.apply_review(&store, &state);
        self.apply_progress(&store, &state);
        self.apply_network(&store, &state);
        if screen == "account" {
            self.apply_timezone_card(&store, &state);
        }

        // A finished detection moves an open picker to the detected zone.
        if state.region.detected != self.region_seen {
            self.region_seen = state.region.detected.clone();
            if store.get_sheet() == "timezone" && !state.region.detected.is_empty() {
                self.tz_pick = state.region.detected.clone();
                self.refresh_picker(&store);
            }
        }
        store.set_tz_detecting(state.region.busy);
        if store.get_sheet() == "timezone" {
            self.refresh_pick_details(&store);
        }
    }

    // ── details and USB ──────────────────────────────────────────────────────

    fn request_details(&mut self) {
        if !self.details_pending {
            self.details_pending = true;
            self.sheet_opened = Some(Instant::now());
            self.send(json!({"action": "details"}));
        }
    }

    fn apply_details(&mut self, details: Details) {
        self.details_pending = false;
        let Some(window) = self.window() else { return };
        let store = window.global::<Store>();
        // Keep the screen light: the most recent part of the bounded log.
        let lines: Vec<&str> = details.text.lines().collect();
        let start = lines.len().saturating_sub(400);
        store.set_details(s(lines[start..].join("\n")));
        store.set_details_error(s(&details.error));
        store.set_details_note(s(format!(
            "Private log /run/cybexos-installer.log{}. Passwords never appear here.",
            if details.truncated || start > 0 { ", most recent part" } else { "" }
        )));
    }

    fn apply_usb(&mut self, usb: Usb) {
        let Some(window) = self.window() else { return };
        let store = window.global::<Store>();
        store.set_usb(model(store.get_usb(),
            usb.targets
                .iter()
                .map(|t| UsbRow { device: s(&t.device), label: s(&t.label), size: s(human_size(t.size)) })
                .collect(),
        ));
        if !usb.saved.is_empty() {
            store.set_usb_message(s(format!("Saved as {} on the USB stick. You can remove it now.", usb.saved)));
        } else if !usb.error.is_empty() {
            store.set_usb_message(s(&usb.error));
        }
    }

    fn toast(&mut self, store: &Store, text: &str) {
        store.set_toast(s(text));
        self.toast_until = Some(Instant::now() + Duration::from_millis(2600));
    }

    // ── once a second ────────────────────────────────────────────────────────

    fn second(app: &Shared) {
        let mut this = app.borrow_mut();
        let Some(window) = this.window() else { return };
        let store = window.global::<Store>();
        if this.toast_until.is_some_and(|t| Instant::now() >= t) {
            this.toast_until = None;
            store.set_toast(s(""));
        }
        let state = this.state.clone();
        let Some(state) = state else { return };
        let running = store.get_busy() || state.phase == "installing" || state.network.busy && !state.network.connected;
        if running {
            store.set_tick((store.get_tick() + 1) % 1000);
        }
        if state.phase == "installing" {
            let (base, at) = this.elapsed_base;
            store.set_elapsed(s(format_elapsed(base + at.elapsed().as_secs() as i64)));
        }
        // Clocks: the card changes once a minute, the picker's clock every second.
        if store.get_screen() == "account" {
            this.apply_timezone_card(&store, &state);
        }
        if store.get_sheet() == "timezone" {
            let now = this.now();
            if now / 60 != this.tz_minute {
                this.refresh_picker(&store);
            } else if let Some(zones) = this.zones.as_ref() {
                store.set_tz_pick_clock(s(zones.clock(&this.tz_pick, now, true)));
            }
        }
        if store.get_sheet() == "log" && this.sheet_opened.is_some_and(|t| t.elapsed() >= Duration::from_secs(2)) {
            this.sheet_opened = Some(Instant::now());
            this.request_details();
        }
    }
}

pub fn format_elapsed(seconds: i64) -> String {
    let seconds = seconds.max(0);
    if seconds >= 3600 {
        format!("{}:{:02}:{:02}", seconds / 3600, seconds % 3600 / 60, seconds % 60)
    } else {
        format!("{:02}:{:02}", seconds / 60, seconds % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::format_elapsed;

    #[test]
    fn elapsed_time_reads_naturally() {
        assert_eq!(format_elapsed(0), "00:00");
        assert_eq!(format_elapsed(754), "12:34");
        assert_eq!(format_elapsed(3661), "1:01:01");
    }
}
