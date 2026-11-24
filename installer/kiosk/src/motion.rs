//! Reduced motion: Wiz holds still and the activity marks stop blinking.
//!
//! The menu's Reduce motion switch sets it for this installer session. It
//! starts on when `QS_REDUCED_MOTION` asks for it, the desktop's own override
//! (desktop/quickshell/Common/Theme.qml); the boot menu's kernel command line
//! can give every service that with `systemd.setenv=QS_REDUCED_MOTION=1`.
//!
//! The screen exits for a new keyboard layout and systemd starts it again, so
//! the switch is kept in the seat session's runtime directory, which logind
//! keeps across that restart. Without one it lasts as long as the process.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub const ENV: &str = "QS_REDUCED_MOTION";

/// The desktop's reading of the variable: 1, true, yes or on.
pub fn requested(value: Option<&str>) -> bool {
    value.is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

/// Where the session's choice is kept, inside `XDG_RUNTIME_DIR`.
pub fn session_file(runtime: Option<&OsStr>) -> Option<PathBuf> {
    let runtime = Path::new(runtime?);
    runtime.is_absolute().then(|| runtime.join("cybexos-installer-reduced-motion"))
}

/// The session's choice, if it made one.
pub fn load(file: &Path) -> Option<bool> {
    match std::fs::read_to_string(file).ok()?.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

/// Keep the choice; failing to is harmless, it then lasts this process.
pub fn save(file: &Path, on: bool) {
    if let Err(error) = std::fs::write(file, if on { "1\n" } else { "0\n" }) {
        eprintln!("cybexos-installer: could not keep the reduced motion choice ({error})");
    }
}

/// The starting value: the session's choice, else the environment.
pub fn initial(file: Option<&Path>, env: Option<&str>) -> bool {
    file.and_then(load).unwrap_or_else(|| requested(env))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_desktop_override_and_the_session_choice() {
        assert!(requested(Some(" Yes ")));
        assert!(requested(Some("1")));
        assert!(!requested(Some("0")));
        assert!(!requested(None));
        assert_eq!(session_file(Some(OsStr::new("relative"))), None);
        assert_eq!(session_file(None), None);

        let dir = std::env::temp_dir().join(format!("cybexos-motion-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = session_file(Some(dir.as_os_str())).unwrap();
        assert!(initial(Some(&file), Some("on")), "no choice yet: the environment decides");
        save(&file, false);
        assert!(!initial(Some(&file), Some("on")), "the session's choice outlasts a restart");
        save(&file, true);
        assert!(initial(Some(&file), None));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
