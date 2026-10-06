use crate::config::{AppPaths, Ports};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInfo {
    pub port: u16,
    pub control_port: u16,
    pub control_token: String,
}

#[derive(Default)]
pub struct SidecarState {
    pub ready: Option<ReadyInfo>,
    pub child: Option<CommandChild>,
}

pub struct SidecarEnv;
impl SidecarEnv {
    pub fn build(
        paths: &AppPaths,
        ports: &Ports,
        token: &str,
        app_version: &str,
    ) -> Vec<(String, String)> {
        vec![
            (
                "KV_DATA_DIR".into(),
                paths.data_dir.to_string_lossy().into_owned(),
            ),
            ("KV_PORT".into(), ports.sidecar.to_string()),
            ("KV_CONTROL_PORT".into(), ports.control.to_string()),
            ("KV_CONTROL_TOKEN".into(), token.to_string()),
            (
                "KV_HOST_ORIGIN".into(),
                format!("http://127.0.0.1:{}", ports.host),
            ),
            ("KV_APP_VERSION".into(), app_version.to_string()),
            ("KV_STDIN_STOP".into(), "1".into()),
        ]
    }
}

/// `{"event":"ready","port":4201,"controlPort":4202}` → (4201, 4202); anything else → None.
pub fn parse_ready_line(line: &str) -> Option<(u16, u16)> {
    let t = line.trim();
    if !t.starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(t).ok()?;
    if v.get("event")?.as_str()? != "ready" {
        return None;
    }
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    let control = u16::try_from(v.get("controlPort")?.as_u64()?).ok()?;
    Some((port, control))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    state: &'static str,
    code: Option<i32>,
}

/// Spawn `node <sidecar_main>` with the env (cwd = sidecar/), relay readiness and exit as `sidecar:status` events.
pub fn spawn_sidecar(
    app: &AppHandle,
    paths: &AppPaths,
    ports: Ports,
    token: String,
    app_version: &str,
) -> tauri::Result<()> {
    let env = SidecarEnv::build(paths, &ports, &token, app_version);
    // cwd = sidecar/ (dist/main.js → ..): package names resolve through the workspace's node_modules.
    let sidecar_dir = paths
        .sidecar_main
        .parent()
        .and_then(|d| d.parent())
        .map(|d| d.to_path_buf())
        .unwrap_or_default();
    let mut cmd = app
        .shell()
        .command("node")
        .args([paths.sidecar_main.to_string_lossy().as_ref()])
        .current_dir(sidecar_dir);
    for (k, v) in env {
        cmd = cmd.env(k, v);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| tauri::Error::Anyhow(e.into()))?;
    {
        let state = app.state::<Mutex<SidecarState>>();
        state.lock().unwrap().child = Some(child);
    }
    let _ = app.emit(
        "sidecar:status",
        Status {
            state: "starting",
            code: None,
        },
    );
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some((port, control_port)) = parse_ready_line(&line) {
                        let info = ReadyInfo {
                            port,
                            control_port,
                            control_token: token.clone(),
                        };
                        handle.state::<Mutex<SidecarState>>().lock().unwrap().ready = Some(info);
                        let _ = handle.emit(
                            "sidecar:status",
                            Status {
                                state: "ready",
                                code: None,
                            },
                        );
                    } else {
                        print!("[sidecar] {line}");
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes))
                }
                CommandEvent::Terminated(payload) => {
                    let state = handle.state::<Mutex<SidecarState>>();
                    let mut st = state.lock().unwrap();
                    st.ready = None;
                    st.child = None;
                    let _ = handle.emit(
                        "sidecar:status",
                        Status {
                            state: "exited",
                            code: payload.code,
                        },
                    );
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// Graceful stop: a `stop` line is the sidecar's stop request (its stdin EOF is the other); wait up to 15 s, then kill.
pub fn stop_sidecar(app: &AppHandle) {
    let child = app
        .state::<Mutex<SidecarState>>()
        .lock()
        .unwrap()
        .child
        .take();
    if let Some(mut child) = child {
        let _ = child.write(b"stop\n");
        // The Terminated event clears `ready`; wait up to 15 s (75 × 200 ms) for it.
        for _ in 0..75 {
            if app
                .state::<Mutex<SidecarState>>()
                .lock()
                .unwrap()
                .ready
                .is_none()
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn sidecar_info(state: tauri::State<'_, Mutex<SidecarState>>) -> Option<ReadyInfo> {
    state.lock().unwrap().ready.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_the_ready_line_and_skips_everything_else() {
        assert_eq!(
            parse_ready_line(r#"{"event":"ready","port":4201,"controlPort":4202}"#),
            Some((4201, 4202))
        );
        assert_eq!(
            parse_ready_line("[15:23:40] [switchboard] Registered /graphql"),
            None
        );
        assert_eq!(
            parse_ready_line("(node:1) [DEP0205] DeprecationWarning"),
            None
        );
        assert_eq!(parse_ready_line(r#"{"event":"other","port":1}"#), None);
        assert_eq!(parse_ready_line(""), None);
    }

    #[test]
    fn env_carries_the_data_dir_intact_and_every_kv_variable() {
        let paths = AppPaths {
            data_dir: PathBuf::from("/tmp/Knowledge Vault äö/data"),
            sidecar_main: PathBuf::from("/app/sidecar/dist/main.js"),
        };
        let ports = Ports {
            host: 4200,
            sidecar: 4301,
            control: 4302,
        };
        let env = SidecarEnv::build(&paths, &ports, "tok", "0.1.0");
        let get = |k: &str| env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        assert_eq!(
            get("KV_DATA_DIR").as_deref(),
            Some("/tmp/Knowledge Vault äö/data")
        );
        assert_eq!(get("KV_PORT").as_deref(), Some("4301"));
        assert_eq!(get("KV_CONTROL_PORT").as_deref(), Some("4302"));
        assert_eq!(get("KV_CONTROL_TOKEN").as_deref(), Some("tok"));
        assert_eq!(
            get("KV_HOST_ORIGIN").as_deref(),
            Some("http://127.0.0.1:4200")
        );
        assert_eq!(get("KV_APP_VERSION").as_deref(), Some("0.1.0"));
        assert_eq!(get("KV_STDIN_STOP").as_deref(), Some("1"));
        assert!(get("KV_PROTECTED").is_none());
    }
}
