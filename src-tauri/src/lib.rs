mod backoff;
mod config;
mod log_tail;
mod navigation;
mod sidecar;
mod smoke;
mod tray;

use config::{
    AppPaths, DEFAULT_PORTS, Ports, SidecarLaunch, UiConfig, new_control_token, pick_free_port,
};
use sidecar::{ReadyInfo, SidecarState, sidecar_info, spawn_sidecar, stop_sidecar_blocking};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The engine's data directory, known once the engine is spawned or adopted (open_logs, reveal_path, close-to-tray).
#[derive(Default)]
struct DataDir(Mutex<Option<PathBuf>>);

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.state::<DataDir>().0.lock().ok()?.clone()
}

/// Stop the engine (waiting for its graceful stop), then exit — the tray's Quit, a close that
/// quits. Off the main thread: the window keeps painting "stopping", and the main thread stays
/// free for the tray and the event loop while the engine flushes its store.
pub(crate) fn quit(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        stop_sidecar_blocking(&app);
        app.exit(0);
    });
}

/// "Try again" after the engine kept stopping or refused to start.
#[tauri::command]
fn retry_engine(app: AppHandle) -> Result<(), String> {
    sidecar::retry_sidecar(&app)
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
    // Plan 6: an installed app (a release build) serves the host itself over loopback, on a port
    // picked free now — the server panics on a busy port — and runs the engine it bundles. In
    // development Vite serves the host on 4200 and the engine comes from the repository.
    let packaged = !tauri::is_dev();
    let host_port = if packaged {
        pick_free_port(DEFAULT_PORTS.host)
    } else {
        DEFAULT_PORTS.host
    };
    let mut builder = tauri::Builder::default()
        // First: a second launch hands over to this one and exits (spec §9 — one engine per store).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }));
    if packaged {
        // Loopback only (Review Focus 3): never reachable from the network.
        builder = builder.plugin(
            tauri_plugin_localhost::Builder::new(host_port)
                .host("127.0.0.1")
                .build(),
        );
    }
    builder
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
            quit_app,
            retry_engine
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Err(e) = tray::build(&handle) {
                eprintln!("[shell] no system tray ({e}); closing the window will quit the app");
            }
            // The window is built here rather than declared in tauri.conf.json so it can carry
            // the navigation guard (spec §5.8): external pages go to the system browser.
            let url = if packaged {
                tauri::WebviewUrl::External(
                    format!("http://127.0.0.1:{host_port}")
                        .parse()
                        .expect("a loopback URL"),
                )
            } else {
                tauri::WebviewUrl::default()
            };
            tauri::WebviewWindowBuilder::new(app, "main", url)
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
            let repo_dir = if packaged {
                PathBuf::new()
            } else {
                std::env::current_dir()?.join("..").canonicalize()?
            };
            let sidecar =
                SidecarLaunch::for_build(packaged, &app.path().resource_dir()?, &repo_dir);
            let paths = AppPaths { data_dir, sidecar };
            let ports = Ports {
                host: host_port,
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
            if std::env::var("KV_SMOKE").as_deref() == Ok("1") {
                let h = handle.clone();
                std::thread::spawn(move || smoke::watch(h, host_port));
            }
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
                api.prevent_close();
                if keep {
                    let _ = window.hide();
                } else {
                    // Wait for the engine before exiting: the process must not end while it flushes.
                    quit(app);
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
