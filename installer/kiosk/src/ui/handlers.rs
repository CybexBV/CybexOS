//! Store callback bindings forwarding user input to the controller and daemon.

use std::collections::HashMap;
use std::rc::Rc;
use std::time::Instant;

use serde_json::json;
use slint::{ComponentHandle, SharedString};

use crate::names;
use crate::{Filtered, InstallerWindow, Store};

use super::{s, Shared};

/// Wire every Store callback to the controller.
pub(super) fn bind(app: &Shared, window: &InstallerWindow) {
    let store = window.global::<Store>();
    macro_rules! on {
        ($method:ident, |$this:ident, $store:ident $(, $arg:ident : $ty:ty)*| $body:block) => {{
            let weak = Rc::downgrade(app);
            let window_weak = window.as_weak();
            store.$method(move |$($arg: $ty),*| {
                let (Some(app), Some(window)) = (weak.upgrade(), window_weak.upgrade()) else { return Default::default() };
                let $store = window.global::<Store>();
                #[allow(unused_mut)]
                let mut $this = app.borrow_mut();
                $body
            });
        }};
    }

    on!(on_navigate, |this, store, screen: SharedString| {
        store.set_screen(screen.clone());
        this.draft(json!({"screen": screen.as_str()}));
    });
    on!(on_open_sheet, |this, store, sheet: SharedString| {
        match sheet.as_str() {
            "timezone" => this.open_picker(&store),
            "log" => {
                store.set_usb_message(s(""));
                this.sheet_opened = Some(Instant::now());
                this.request_details();
                this.send(json!({"action": "usb-list"}));
            }
            "wifi" => this.send(json!({"action": "network-refresh"})),
            _ => {}
        }
        store.set_sheet(sheet);
    });
    on!(on_close_sheet, |this, store| {
        let _ = &this;
        store.set_sheet(s(""));
    });
    on!(on_start, |this, store| {
        store.set_screen(s("disk"));
        this.draft(json!({"screen": "disk"}));
    });
    on!(on_accept_development, |this, store| {
        let _ = &store;
        this.send(json!({"action": "development"}));
    });
    on!(on_retry, |this, store| {
        let _ = &store;
        this.send(json!({"action": "retry"}));
    });
    on!(on_choose_language, |this, store, key: SharedString| {
        this.draft(json!({"locale": key.as_str()}));
        store.set_sheet(s(""));
    });
    on!(on_choose_layout, |this, store, key: SharedString| {
        let current = this.state.as_ref().map(|s| s.draft.layout.clone()).unwrap_or_default();
        store.set_sheet(s(""));
        if key.as_str() != current {
            store.set_password(s(""));
            store.set_confirm(s(""));
            this.send(json!({"action": "keyboard", "layout": key.as_str()}));
        }
    });
    on!(on_choose_disk, |this, store, path: SharedString| {
        let _ = &store;
        let Some(state) = this.state.as_ref() else { return };
        let available: Vec<&str> = state.disks.iter().filter(|d| d.available).map(|d| d.path.as_str()).collect();
        let target = match path.as_str() {
            "+next" | "+previous" if !available.is_empty() => {
                let current = available.iter().position(|p| *p == state.draft.disk);
                let index = match (path.as_str(), current) {
                    ("+next", Some(i)) => (i + 1).min(available.len() - 1),
                    ("+previous", Some(i)) => i.saturating_sub(1),
                    _ => 0,
                };
                available[index].to_string()
            }
            p if available.contains(&p) => p.to_string(),
            _ => return,
        };
        this.draft(json!({"disk": target}));
    });
    on!(on_toggle_encrypted, |this, store| {
        let _ = &store;
        let encrypted = this.state.as_ref().map(|s| s.draft.encrypted).unwrap_or(true);
        this.draft(json!({"encrypted": !encrypted}));
    });
    on!(on_toggle_all_disks, |this, store| {
        store.set_show_all_disks(!store.get_show_all_disks());
        if let Some(state) = this.state.clone() {
            this.apply_disks(&store, &state);
        }
    });
    on!(on_rescan, |this, store| {
        let _ = &store;
        this.send(json!({"action": "rescan"}));
    });
    on!(on_full_name_edited, |this, store, text: SharedString| {
        let mut values = json!({"fullName": text.as_str()});
        if !this.user_edited {
            let suggestion = names::suggest(&text);
            store.set_username(s(&suggestion));
            values["username"] = json!(suggestion);
            values["userEdited"] = json!(false);
            if !this.host_edited {
                store.set_hostname(s(names::hostname_for(&suggestion)));
            }
        }
        if names::full_name_problem(&text).is_none() {
            this.draft(values);
        }
        this.update_account(&store, "", "");
    });
    store.on_wiz_art(|name, ppu, size| crate::wiz::art(&name, ppu, size));
    let filter_store = window.as_weak();
    store.on_filter_name(move |text, caret| {
        let _ = &filter_store;
        let result = names::filter(&text, caret.max(0) as usize);
        Filtered { text: s(result.text), caret: result.caret as i32, note: s(result.note) }
    });
    on!(on_username_edited, |this, store, text: SharedString, note: SharedString| {
        // The filtered text, before the field shows it.
        store.set_username(text.clone());
        this.user_edited = !text.is_empty();
        if !this.host_edited {
            store.set_hostname(s(names::hostname_for(&text)));
        }
        this.draft(json!({"username": text.as_str(), "userEdited": this.user_edited}));
        this.update_account(&store, &note, "");
    });
    on!(on_hostname_edited, |this, store, text: SharedString, note: SharedString| {
        store.set_hostname(text.clone());
        this.host_edited = !text.is_empty();
        store.set_host_edited(this.host_edited);
        this.draft(json!({"hostname": text.as_str(), "hostEdited": this.host_edited}));
        this.update_account(&store, "", &note);
    });
    on!(on_passwords_edited, |this, store| {
        this.update_account(&store, "", "");
    });
    on!(on_continue_account, |this, store| {
        this.update_account(&store, "", "");
        if !store.get_can_review() {
            return;
        }
        // The passwords stay here until the Software step's Continue.
        store.set_screen(s("software"));
        this.draft(json!({"screen": "software"}));
    });
    on!(on_continue_software, |this, store| {
        this.update_account(&store, "", "");
        if !store.get_can_review() {
            // A restarted screen (a keyboard change) has no password yet.
            store.set_screen(s("account"));
            this.draft(json!({"screen": "account"}));
            return;
        }
        store.set_review_busy(true);
        let request = json!({
            "action": "review",
            "password": store.get_password().as_str(),
            "confirm": store.get_confirm().as_str(),
        });
        this.send(request);
    });
    on!(on_toggle_profile, |this, store, id: SharedString| {
        let _ = &store;
        let Some(state) = this.state.as_ref() else { return };
        let available = this.statics.software.profiles.iter().any(|p| p.id == id.as_str() && (p.on_medium || state.network.connected));
        if !available {
            return;
        }
        let mut profiles = state.draft.profiles.clone();
        if let Some(position) = profiles.iter().position(|p| p == id.as_str()) {
            profiles.remove(position);
        } else {
            profiles.push(id.to_string());
        }
        this.draft(json!({"profiles": profiles}));
    });
    on!(on_toggle_feature, |this, store, key: SharedString| {
        let _ = &store;
        let on = this.state.as_ref().is_none_or(|s| s.draft.feature(key.as_str()));
        let mut features = HashMap::new();
        features.insert(key.to_string(), !on);
        this.draft(json!({"features": features}));
    });
    on!(on_tz_query_edited, |this, store, _text: SharedString| {
        this.refresh_picker(&store);
    });
    on!(on_tz_pick, |this, store, id: SharedString| {
        this.pick(&store, &id);
    });
    on!(on_tz_use, |this, store| {
        this.use_pick(&store);
    });
    on!(on_tz_toggle_fixed, |this, store| {
        store.set_tz_fixed(!store.get_tz_fixed());
        this.refresh_picker(&store);
    });
    on!(on_tz_detect, |this, store| {
        store.set_tz_detecting(true);
        this.send(json!({"action": "detect-region"}));
    });
    on!(on_tz_map_click, |this, store, fx: f32, fy: f32| {
        let (lat, lon) = this.mask.coordinates(fx as f64, fy as f64);
        let id = this.zones.as_ref().and_then(|z| z.nearest(lat, lon)).map(|i| this.zones.as_ref().unwrap().zones[i].id.clone());
        if let Some(id) = id {
            this.pick(&store, &id);
        }
    });
    on!(on_tz_map_hover, |this, store, fx: f32, fy: f32| {
        if fx < 0.0 || fy < 0.0 {
            store.set_tz_hover(s(""));
            return;
        }
        let (lat, lon) = this.mask.coordinates(fx as f64, fy as f64);
        let now = this.now();
        if let Some(zones) = this.zones.as_ref() {
            if let Some(i) = zones.nearest(lat, lon) {
                let zone = &zones.zones[i];
                store.set_tz_hover(s(format!("{} · {}", zone.city, zones.clock(&zone.id, now, false))));
                store.set_tz_hover_x(fx);
                store.set_tz_hover_y(fy);
            }
        }
    });
    on!(on_tz_key, |this, store, key: SharedString| {
        let Some(zones) = this.zones.as_ref() else { return };
        if key.as_str() == "enter" {
            if !this.tz_hits.iter().any(|h| zones.zones[h.index].id == this.tz_pick) {
                if let Some(first) = this.tz_hits.first() {
                    this.tz_pick = zones.zones[first.index].id.clone();
                }
            }
            this.use_pick(&store);
            return;
        }
        if this.tz_hits.is_empty() {
            return;
        }
        let current = this.tz_hits.iter().position(|h| zones.zones[h.index].id == this.tz_pick);
        let next = match (key.as_str(), current) {
            ("down", Some(i)) => (i + 1).min(this.tz_hits.len() - 1),
            ("up", Some(i)) => i.saturating_sub(1),
            _ => 0,
        };
        let id = zones.zones[this.tz_hits[next].index].id.clone();
        this.pick(&store, &id);
    });
    on!(on_back_to_software, |this, store| {
        let _ = &store;
        this.send(json!({"action": "back"}));
    });
    on!(on_install, |this, store| {
        let _ = &store;
        this.send(json!({"action": "install"}));
    });
    on!(on_change, |this, store, action: SharedString| {
        match action.as_str() {
            // Back from the review returns to the Software step.
            "software" => this.send(json!({"action": "back"})),
            "account" | "disk" => {
                this.send(json!({"action": "back"}));
                this.draft(json!({"screen": action.as_str()}));
            }
            "timezone" => {
                this.open_picker(&store);
                store.set_sheet(s("timezone"));
            }
            other => store.set_sheet(s(other)),
        }
    });
    on!(on_toggle_app, |this, store, id: SharedString| {
        let _ = &store;
        let Some(state) = this.state.as_ref() else { return };
        let mut off = state.draft.apps_off.clone();
        if let Some(position) = off.iter().position(|a| a == id.as_str()) {
            off.remove(position);
        } else {
            off.push(id.to_string());
        }
        this.draft(json!({"appsOff": off}));
    });
    on!(on_set_nvidia_open, |this, store, open: bool| {
        if (open && !store.get_nvidia_open_available()) || (!open && !store.get_nvidia_closed_available()) {
            return;
        }
        this.draft(json!({"nvidiaOpen": open}));
    });
    on!(on_wifi_select, |this, store, index: i32| {
        let Some(state) = this.state.as_ref() else { return };
        let Some(network) = state.network.wifi.networks.get(index as usize).cloned() else { return };
        if network.connected {
            return;
        }
        let security = network.security.to_uppercase();
        let open = security.is_empty() || security == "--" || security == "NONE" || security == "OPEN";
        if open || network.known {
            this.send(json!({"action": "network-connect", "network": {
                "ssid": network.ssid, "security": network.security, "uuid": network.uuid, "saved": network.known}}));
            this.toast(&store, &format!("Connecting to {}…", network.ssid));
        } else {
            store.set_wifi_selected(index);
        }
    });
    on!(on_wifi_connect, |this, store, index: i32, password: SharedString, identity: SharedString| {
        let Some(state) = this.state.as_ref() else { return };
        let Some(network) = state.network.wifi.networks.get(index as usize).cloned() else { return };
        this.send(json!({"action": "network-connect", "network": {
            "ssid": network.ssid, "security": network.security, "password": password.as_str(), "identity": identity.as_str()}}));
        store.set_wifi_selected(-1);
        this.toast(&store, &format!("Connecting to {}…", network.ssid));
    });
    on!(on_network_refresh, |this, store| {
        let _ = &store;
        this.send(json!({"action": "network-refresh"}));
    });
    on!(on_tool, |this, store, tool: SharedString| {
        store.set_sheet(s(""));
        match tool.as_str() {
            "shell" => this.send(json!({"action": "shell"})),
            "text-installer" => this.send(json!({"action": "text-installer"})),
            _ => {}
        }
    });
    on!(on_toggle_reduced_motion, |this, store| {
        let on = !store.get_reduced_motion();
        store.set_reduced_motion(on);
        if let Some(file) = this.motion_file.as_deref() {
            crate::motion::save(file, on);
        }
    });
    on!(on_request_details, |this, store| {
        let _ = &store;
        this.request_details();
        this.send(json!({"action": "usb-list"}));
    });
    on!(on_usb_save, |this, store, device: SharedString| {
        store.set_usb_message(s("Saving…"));
        this.send(json!({"action": "usb-save", "device": device.as_str()}));
    });
    on!(on_start_over, |this, store| {
        store.set_sheet(s(""));
        this.send(json!({"action": "start-over"}));
    });
    on!(on_power, |this, store, kind: SharedString| {
        if store.get_power_busy() {
            return;
        }
        store.set_sheet(s(""));
        let installing = this.state.as_ref().is_some_and(|s| s.phase == "installing");
        if installing {
            this.toast(&store, "Installation is in progress. Keep the computer on until it finishes.");
            return;
        }
        this.send(json!({"action": "power", "kind": kind.as_str()}));
    });
}
