//! Time zone card, search picker and live world map projections.

use serde_json::json;
use slint::{Image, Model};

use crate::map::Marker;
use crate::protocol::State;
use crate::zones::{Hit, ZoneDb};
use crate::{Store, ZoneRow};

use super::{model, s, App};

impl App {
    pub(super) fn apply_timezone_card(&mut self, store: &Store, state: &State) {
        let Some(zones) = self.zones.as_ref() else { return };
        let id = state.draft.timezone.clone();
        let now = self.now();
        let zone = zones.get(&id);
        store.set_tz_clock(s(zones.clock(&id, now, false)));
        store.set_tz_city(s(zone.map_or(id.as_str(), |z| z.city.as_str())));
        store.set_tz_sub(s(format!(
            "{} · {}",
            zone.map_or("", |z| if z.fixed { "fixed offset" } else { z.country.as_str() }),
            zones.long_offset(&id, now)
        )));
        store.set_tz_source(s(match state.draft.tz_source.as_str() {
            "detected" => "detected from your connection",
            "manual" => "chosen by you",
            _ => if state.region.busy { "detecting…" } else { "not detected yet" },
        }));
        let minute = now / 60;
        let key = format!("{id}@{minute}");
        if key != self.mini_key {
            self.mini_key = key;
            let marker = zone.and_then(|z| Some(Marker { lat: z.lat?, lon: z.lon? }));
            let canvas = self.mask.render(1016, 340, now, &[], marker.as_ref());
            store.set_mini_map(Image::from_rgba8_premultiplied(canvas.into_buffer()));
        }
    }

    // ── time zone picker ─────────────────────────────────────────────────────

    pub fn open_picker(&mut self, store: &Store) {
        let current = self.state.as_ref().map(|s| s.draft.timezone.clone()).unwrap_or_else(|| "UTC".into());
        self.tz_pick = current;
        store.set_tz_query(s(""));
        self.refresh_picker(store);
    }

    pub(super) fn refresh_picker(&mut self, store: &Store) {
        let Some(zones) = self.zones.as_ref() else { return };
        let now = self.now();
        let query = store.get_tz_query().to_string();
        self.tz_hits = zones.search(&query, store.get_tz_fixed(), &self.tz_pick, now);
        let rows: Vec<ZoneRow> = self.tz_hits.iter().map(|hit| self.zone_row(zones, hit, now)).collect();
        let selected = self.tz_hits.iter().position(|h| zones.zones[h.index].id == self.tz_pick).map_or(-1, |p| p as i32);
        store.set_tz_results(model(store.get_tz_results(), rows));
        store.set_tz_selected_row(-1);
        store.set_tz_selected_row(selected);
        self.tz_minute = now / 60;
        self.big_key.clear();
        self.refresh_pick_details(store);
    }

    pub(super) fn zone_row(&self, zones: &ZoneDb, hit: &Hit, now: i64) -> ZoneRow {
        let zone = &zones.zones[hit.index];
        let note = match &hit.alias {
            Some(alias) => format!("formerly {} · {}", alias.rsplit('/').next().unwrap_or(alias).replace('_', " "), zone.id),
            None if !zone.comment.is_empty() && !zone.fixed => format!("{} · {}", zone.comment, zone.id),
            None => zone.id.clone(),
        };
        ZoneRow {
            id: s(&zone.id),
            title: s(&zone.city),
            sub: s(if zone.fixed { if zone.id == "UTC" { "Coordinated Universal Time" } else { "fixed offset" } } else { zone.country.as_str() }),
            note: s(note),
            time: s(zones.clock(&zone.id, now, false)),
            offset: s(zones.short_offset(&zone.id, now)),
            selected: zone.id == self.tz_pick,
        }
    }

    pub(super) fn refresh_pick_details(&mut self, store: &Store) {
        let Some(zones) = self.zones.as_ref() else { return };
        let now = self.now();
        let id = self.tz_pick.clone();
        let zone = zones.get(&id);
        store.set_tz_pick_clock(s(zones.clock(&id, now, true)));
        store.set_tz_pick_title(s(match zone {
            Some(z) if !z.fixed => format!("{}, {}", z.city, z.country),
            Some(z) => z.city.clone(),
            None => id.clone(),
        }));
        store.set_tz_pick_id(s(format!("{id} · {}", zones.long_offset(&id, now))));
        let change = zones.next_change(&id, now);
        store.set_tz_pick_changes(change.is_some());
        store.set_tz_pick_change(s(change.unwrap_or_else(|| "No clock changes in the next year".into())));
        let source = match self.state.as_ref() {
            Some(st) if st.draft.timezone == id && st.draft.tz_source == "detected" => "Detected from your internet connection",
            Some(st) if st.draft.timezone == id => "Your current choice",
            _ => "Not applied yet",
        };
        store.set_tz_pick_source(s(source));
        let query = store.get_tz_query().to_string();
        let pins: Vec<Marker> = if query.trim().is_empty() {
            Vec::new()
        } else {
            self.tz_hits.iter().filter_map(|h| {
                let z = &zones.zones[h.index];
                Some(Marker { lat: z.lat?, lon: z.lon? })
            }).collect()
        };
        let key = format!("{id}|{query}|{}|{}", store.get_tz_fixed(), now / 60);
        if key != self.big_key {
            self.big_key = key;
            let marker = zone.and_then(|z| Some(Marker { lat: z.lat?, lon: z.lon? }));
            let canvas = self.mask.render(1392, 541, now, &pins, marker.as_ref());
            store.set_big_map(Image::from_rgba8_premultiplied(canvas.into_buffer()));
        }
    }

    pub(super) fn pick(&mut self, store: &Store, id: &str) {
        self.tz_pick = id.to_string();
        let zones = self.zones.as_ref();
        let results = store.get_tz_results();
        let mut selected = -1;
        for i in 0..results.row_count() {
            if let Some(mut row) = results.row_data(i) {
                let is = row.id == id;
                if is {
                    selected = i as i32;
                }
                if row.selected != is {
                    row.selected = is;
                    results.set_row_data(i, row);
                }
            }
        }
        if selected < 0 && zones.is_some() {
            // Picked on the map outside the current results: show it first.
            store.set_tz_query(s(""));
            self.refresh_picker(store);
            return;
        }
        store.set_tz_selected_row(selected);
        self.refresh_pick_details(store);
    }

    pub(super) fn use_pick(&mut self, store: &Store) {
        let current = self.state.as_ref().map(|s| s.draft.timezone.clone()).unwrap_or_default();
        if !self.tz_pick.is_empty() && self.tz_pick != current {
            self.draft(json!({"timezone": self.tz_pick, "tzSource": "manual"}));
        }
        store.set_sheet(s(""));
    }
}
