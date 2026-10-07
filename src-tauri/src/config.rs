use serde::Deserialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

/// Spec §4.4: the `local` section of the sidecar-owned config.json — read by the shell to build
/// KV_PROTECTED/KV_ADMIN_ADDRESS at spawn; the sidecar writes it (PUT /local/protection).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalProtection {
    pub protected: bool,
    pub admin_address: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ConfigFile {
    local: LocalProtection,
}

impl LocalProtection {
    /// Open when the file or the section is missing or unreadable, and when protection names no
    /// administrator (such an engine refuses to start — the sidecar requires KV_ADMIN_ADDRESS).
    pub fn load(path: &Path) -> LocalProtection {
        let mut protection = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<ConfigFile>(&text).ok())
            .map(|file| file.local)
            .unwrap_or_default();
        if protection
            .admin_address
            .as_deref()
            .is_none_or(str::is_empty)
        {
            protection.protected = false;
        }
        protection
    }
}

#[derive(Clone)]
pub struct AppPaths {
    /// Spec §3.3: the app-data directory (reactor/, read-model/, secrets/, logs/ live here).
    pub data_dir: PathBuf,
    /// The sidecar entry: in dev `../sidecar/dist/main.js` relative to the repo root.
    pub sidecar_main: PathBuf,
}

#[derive(Clone, Copy)]
pub struct Ports {
    pub host: u16,
    pub sidecar: u16,
    pub control: u16,
}

pub const DEFAULT_PORTS: Ports = Ports {
    host: 4200,
    sidecar: 4201,
    control: 4202,
};

/// First port at or after `start` that binds on loopback, probing at most 20.
pub fn pick_free_port(start: u16) -> u16 {
    for p in start..start.saturating_add(20) {
        if TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    start
}

/// 32 random bytes as hex; a new one every launch.
pub fn new_control_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn picks_the_next_free_port_when_the_default_is_taken() {
        let taken = TcpListener::bind("127.0.0.1:0").unwrap();
        let start = taken.local_addr().unwrap().port();
        let picked = pick_free_port(start);
        assert_ne!(picked, start);
        assert!(picked > start && picked <= start + 20);
    }

    #[test]
    fn local_protection_defaults_when_missing_and_reads_the_camel_case_section() {
        let dir = std::env::temp_dir().join(format!("kv-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let _ = std::fs::remove_file(&path);
        let missing = LocalProtection::load(&path);
        assert!(!missing.protected);
        assert!(missing.admin_address.is_none());
        std::fs::write(&path, r#"{"version":1,"models":{"model":"x"},"local":{"protected":true,"adminAddress":"0xabc"}}"#).unwrap();
        let p = LocalProtection::load(&path);
        assert!(p.protected);
        assert_eq!(p.admin_address.as_deref(), Some("0xabc"));
        // A section without an administrator cannot start a protected engine: read as open.
        std::fs::write(&path, r#"{"local":{"protected":true}}"#).unwrap();
        assert!(!LocalProtection::load(&path).protected);
        std::fs::write(&path, "{nope").unwrap();
        assert!(!LocalProtection::load(&path).protected);
    }

    #[test]
    fn control_token_is_long_and_random() {
        let a = new_control_token();
        let b = new_control_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
