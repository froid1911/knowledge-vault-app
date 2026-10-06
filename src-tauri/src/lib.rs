mod config;
mod sidecar;

use config::{AppPaths, DEFAULT_PORTS, Ports, new_control_token, pick_free_port};
use sidecar::{ReadyInfo, SidecarState, sidecar_info, spawn_sidecar, stop_sidecar};
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
            let handle = app.handle().clone();
            // Dev loop (scripts/dev.mjs) already runs a sidecar: adopt it instead of spawning another.
            if let (Ok(p), Ok(c), Ok(t)) = (
                std::env::var("KV_DEV_SIDECAR_PORT"),
                std::env::var("KV_DEV_CONTROL_PORT"),
                std::env::var("KV_DEV_CONTROL_TOKEN"),
            ) {
                let info = ReadyInfo {
                    port: p.parse().unwrap_or(4201),
                    control_port: c.parse().unwrap_or(4202),
                    control_token: t,
                };
                app.state::<Mutex<SidecarState>>().lock().unwrap().ready = Some(info);
                return Ok(());
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let sidecar_main = std::env::current_dir()?
                .join("../sidecar/dist/main.js")
                .canonicalize()?;
            let paths = AppPaths {
                data_dir,
                sidecar_main,
            };
            let ports = Ports {
                host: DEFAULT_PORTS.host,
                sidecar: pick_free_port(DEFAULT_PORTS.sidecar),
                control: pick_free_port(DEFAULT_PORTS.control),
            };
            spawn_sidecar(
                &handle,
                &paths,
                ports,
                new_control_token(),
                env!("CARGO_PKG_VERSION"),
            )?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                stop_sidecar(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Knowledge Vault shell");
}
