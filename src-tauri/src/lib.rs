mod backoff;
mod config;
mod log_tail;
mod navigation;
mod sidecar;
mod tray;

use config::{AppPaths, DEFAULT_PORTS, Ports, UiConfig, new_control_token, pick_free_port};
use sidecar::{
    ReadyInfo, SidecarState, sidecar_info, spawn_sidecar, stop_sidecar, stop_sidecar_blocking,
};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The engine's data directory, known once the engine is spawned or adopted (open_logs, reveal_path, close-to-tray).
#[derive(Default)]
struct DataDir(Mutex<Option<PathBuf>>);

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.state::<DataDir>().0.lock().ok()?.clone()
}

/// Stop the engine (waiting for its graceful stop), then exit — the tray's Quit.
pub(crate) fn quit(app: &AppHandle) {
    stop_sidecar_blocking(app);
    app.exit(0);
}

/// Open the engine's logs folder in the file manager.
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)
        .ok_or("The engine's data folder is not known yet.")?
        .join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())
}

/// Show a file the app wrote (an export, a backup) in the file manager — only inside the data folder.
#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let root = data_dir(&app).ok_or("The engine's data folder is not known yet.")?;
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("Only files in the app's data folder can be shown.".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

pub fn run() {
    tauri::Builder::default()
        // First: a second launch hands over to this one and exits (spec §9 — one engine per store).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(SidecarState::default()))
        .manage(DataDir::default())
        .manage(tray::Tray::default())
        .invoke_handler(tauri::generate_handler![
            sidecar_info,
            open_logs,
            reveal_path,
            quit_app
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = tray::build(&handle) {
                eprintln!("[shell] no system tray ({e}); closing the window will quit the app");
            }
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
                    match navigation::external_target(url) {
                        Some(target) => {
                            if let Err(e) = tauri_plugin_opener::open_url(target, None::<&str>) {
                                eprintln!("[shell] could not open {target} in the browser: {e}");
                            }
                        }
                        None => eprintln!("[shell] refused navigation to {url}"),
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
                if let Ok(dir) = std::env::var("KV_DEV_DATA_DIR") {
                    *app.state::<DataDir>().0.lock().unwrap() = Some(PathBuf::from(dir));
                }
                tray::refresh(&handle, "ready");
                return Ok(());
            }
            // Spec §3.3: the engine owns `<app-data>/vault/`. The webview keeps its own profile
            // (CacheStorage, databases, hsts-storage.sqlite, …) in the app-data root, so the two never mix.
            let data_dir = app.path().app_data_dir()?.join("vault");
            std::fs::create_dir_all(&data_dir)?;
            *app.state::<DataDir>().0.lock().unwrap() = Some(data_dir.clone());
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                // Plan 5: with a tray, closing hides the window and the engine keeps serving
                // tools; read at every close, so the Appearance switch applies at once.
                let keep = app.state::<tray::Tray>().available()
                    && data_dir(app)
                        .map(|d| UiConfig::load(&d.join("config.json")).close_to_tray)
                        .unwrap_or(true);
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    stop_sidecar(app);
                }
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
                stop_sidecar_blocking(app);
            }
        });
}
