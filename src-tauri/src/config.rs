use std::net::TcpListener;
use std::path::PathBuf;

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
    fn control_token_is_long_and_random() {
        let a = new_control_token();
        let b = new_control_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
