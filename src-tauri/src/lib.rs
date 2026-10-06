mod config;
mod navigation;
mod sidecar;

use config::{AppPaths, DEFAULT_PORTS, Ports, new_control_token, pick_free_port};
use sidecar::{ReadyInfo, SidecarState, sidecar_info, spawn_sidecar, stop_sidecar};
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
            let handle = app.handle().clone();
            // The window is built here rather than declared in tauri.conf.json so it can carry
            // the navigation guard (spec §5.8): external pages go to the system browser.
            let host_port = DEFAULT_PORTS.host;
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Knowledge Vault")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 640.0)
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    if navigation::is_internal(url, host_port) {
                        return true;
                    }
                    if let Err(e) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
                        eprintln!("[shell] could not open {url} in the browser: {e}");
                    }
                    false
                })
                .build()?;
            // Dev loop (scripts/dev.mjs) already runs a sidecar: adopt it instead of spawning another.
            if let (Ok(p), Ok(c), Ok(t)) = (
                std::env::var("KV_DEV_SIDECAR_PORT"),
                std::env::var("KV_DEV_CONTROL_PORT"),
                std::env::var("KV_DEV_CONTROL_TOKEN"),
            ) {
                let port: u16 = p
                    .parse()
                    .map_err(|_| format!("KV_DEV_SIDECAR_PORT is not a port: {p}"))?;
                let control_port: u16 = c
                    .parse()
                    .map_err(|_| format!("KV_DEV_CONTROL_PORT is not a port: {c}"))?;
                let info = ReadyInfo {
                    port,
                    control_port,
                    control_token: t,
                };
                app.state::<Mutex<SidecarState>>().lock().unwrap().ready = Some(info);
                return Ok(());
            }
            // Spec §3.3: the engine owns `<app-data>/vault/`. The webview keeps its own profile
            // (CacheStorage, databases, hsts-storage.sqlite, …) in the app-data root, so the two never mix.
            let data_dir = app.path().app_data_dir()?.join("vault");
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
        .build(tauri::generate_context!())
        .expect("error while building the Knowledge Vault shell")
        .run(|app, event| {
            // ExitRequested fires when the last window closes or app.exit() runs. macOS Cmd+Q goes
            // through NSApp terminate: and arrives only as RunEvent::Exit — so both stop the engine
            // (idempotent: the second call finds no child).
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                stop_sidecar(app);
            }
        });
}
