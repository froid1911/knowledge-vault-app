use crate::config::{AppPaths, LocalProtection, Ports};
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

/// Everything a respawn needs — recorded at spawn so the Terminated handler can start the engine again.
#[derive(Clone)]
pub struct SpawnParams {
    pub paths: AppPaths,
    pub ports: Ports,
    pub token: String,
    pub app_version: String,
}

#[derive(Default)]
pub struct SidecarState {
    pub ready: Option<ReadyInfo>,
    pub child: Option<CommandChild>,
    /// True from spawn until the Terminated event — the only reliable "is it alive".
    pub running: bool,
    pub exit_code: Option<i32>,
    pub spawn: Option<SpawnParams>,
    /// The engine printed a restart line (the protection switch): its exit is a respawn, not a stop.
    pub restart_requested: bool,
    /// The shell is stopping the engine (window closed, app quitting): no exit is ever respawned.
    pub stopping: bool,
}

/// What an exit means: a requested restart is respawned — unless the shell is stopping the engine
/// (the window closed between the restart line and the exit); anything else is reported as exited.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitAction {
    Respawn,
    Exited,
}

pub fn exit_action(restart_requested: bool, stopping: bool) -> ExitAction {
    if restart_requested && !stopping {
        ExitAction::Respawn
    } else {
        ExitAction::Exited
    }
}

/// What the host sees: `starting` (spawned, no readiness line yet), `ready`, or `exited` (with the code).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub state: &'static str,
    pub ready: Option<ReadyInfo>,
    pub code: Option<i32>,
}

pub fn status_of(ready: Option<ReadyInfo>, running: bool, code: Option<i32>) -> SidecarStatus {
    let state = if ready.is_some() {
        "ready"
    } else if running {
        "starting"
    } else {
        "exited"
    };
    SidecarStatus { state, ready, code }
}

fn snapshot(app: &AppHandle) -> SidecarStatus {
    let st = app.state::<Mutex<SidecarState>>();
    let st = st.lock().unwrap();
    status_of(st.ready.clone(), st.running, st.exit_code)
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit("sidecar:status", snapshot(app));
}

pub struct SidecarEnv;
impl SidecarEnv {
    pub fn build(
        paths: &AppPaths,
        ports: &Ports,
        token: &str,
        app_version: &str,
        protection: &LocalProtection,
    ) -> Vec<(String, String)> {
        let mut env = vec![
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
        ];
        // Spec §4.4: protected only with an administrator (the sidecar refuses KV_PROTECTED without one).
        if protection.protected
            && let Some(admin) = protection
                .admin_address
                .as_deref()
                .filter(|a| !a.is_empty())
        {
            env.push(("KV_PROTECTED".into(), "1".into()));
            env.push(("KV_ADMIN_ADDRESS".into(), admin.to_string()));
        }
        env
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

/// `{"event":"restart",…}` — the engine wants to be started again (the protection switch changed its environment).
pub fn parse_restart_line(line: &str) -> bool {
    let t = line.trim();
    if !t.starts_with('{') {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(t)
        .ok()
        .and_then(|v| {
            v.get("event")
                .and_then(|e| e.as_str())
                .map(|e| e == "restart")
        })
        .unwrap_or(false)
}

/// Spawn `node <sidecar_main>` with the env (cwd = sidecar/); relay readiness and exit as `sidecar:status` events.
/// The protection section is read from config.json at every spawn, so a respawn picks up the switch.
pub fn spawn_sidecar(
    app: &AppHandle,
    paths: &AppPaths,
    ports: Ports,
    token: String,
    app_version: &str,
) -> tauri::Result<()> {
    let protection = LocalProtection::load(&paths.data_dir.join("config.json"));
    let env = SidecarEnv::build(paths, &ports, &token, app_version, &protection);
    // cwd = sidecar/ (dist/main.js → ..): the sidecar resolves its own modules from there.
    // The engine's environment is scrubbed by the sidecar itself (environment.ts), whoever spawns it.
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
        let mut st = state.lock().unwrap();
        st.child = Some(child);
        st.running = true;
        st.exit_code = None;
        st.ready = None;
        st.restart_requested = false;
        st.spawn = Some(SpawnParams {
            paths: paths.clone(),
            ports,
            token: token.clone(),
            app_version: app_version.to_string(),
        });
    }
    emit_status(app);
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
                        emit_status(&handle);
                    } else if parse_restart_line(&line) {
                        handle
                            .state::<Mutex<SidecarState>>()
                            .lock()
                            .unwrap()
                            .restart_requested = true;
                        println!("[shell] the engine asked to be restarted");
                    } else {
                        print!("[sidecar] {line}");
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes))
                }
                CommandEvent::Terminated(payload) => {
                    let (action, params) = {
                        let state = handle.state::<Mutex<SidecarState>>();
                        let mut st = state.lock().unwrap();
                        st.ready = None;
                        st.child = None;
                        st.running = false;
                        st.exit_code = payload.code;
                        let action = exit_action(st.restart_requested, st.stopping);
                        st.restart_requested = false;
                        (action, st.spawn.clone())
                    };
                    match (action, params) {
                        (ExitAction::Respawn, Some(p)) => {
                            println!("[shell] restarting the engine");
                            if let Err(e) =
                                spawn_sidecar(&handle, &p.paths, p.ports, p.token, &p.app_version)
                            {
                                eprintln!("[shell] could not restart the engine: {e}");
                                emit_status(&handle);
                            }
                        }
                        _ => emit_status(&handle),
                    }
                }
                _ => {}
            }
        }
    });
    Ok(())
}

const STOP_POLLS: u32 = 75;
const STOP_POLL_MS: u64 = 200;

/// Keep waiting for a graceful exit while the child is alive and the 15 s grace period (75 × 200 ms) has not run out.
pub fn keep_waiting(running: bool, polls: u32) -> bool {
    running && polls < STOP_POLLS
}

/// Graceful stop: a `stop` line is the sidecar's stop request (its stdin EOF is the other); wait for the
/// child to terminate, then kill whatever is left. Keyed on the child's life, not on readiness — a sidecar
/// still booting (first-run initdb, the moment a kill hurts most) gets the same grace period.
pub fn stop_sidecar(app: &AppHandle) {
    let child = {
        let state = app.state::<Mutex<SidecarState>>();
        let mut st = state.lock().unwrap();
        st.stopping = true; // an exit from here on is a stop, never a respawn
        st.child.take()
    };
    if let Some(mut child) = child {
        let _ = child.write(b"stop\n");
        let mut polls = 0;
        while keep_waiting(
            app.state::<Mutex<SidecarState>>().lock().unwrap().running,
            polls,
        ) {
            std::thread::sleep(std::time::Duration::from_millis(STOP_POLL_MS));
            polls += 1;
        }
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn sidecar_info(state: tauri::State<'_, Mutex<SidecarState>>) -> SidecarStatus {
    let st = state.lock().unwrap();
    status_of(st.ready.clone(), st.running, st.exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LocalProtection;
    use std::path::PathBuf;

    fn ready() -> ReadyInfo {
        ReadyInfo {
            port: 4201,
            control_port: 4202,
            control_token: "t".into(),
        }
    }

    #[test]
    fn status_is_starting_then_ready_then_exited_with_the_code() {
        assert_eq!(status_of(None, true, None).state, "starting");
        let s = status_of(Some(ready()), true, None);
        assert_eq!(s.state, "ready");
        assert_eq!(s.ready.map(|r| r.port), Some(4201));
        let s = status_of(None, false, Some(1));
        assert_eq!(s.state, "exited");
        assert_eq!(s.code, Some(1));
        // A sidecar adopted from the dev loop was never spawned here: ready, not running — still "ready".
        assert_eq!(status_of(Some(ready()), false, None).state, "ready");
    }

    #[test]
    fn stop_waits_only_while_the_child_lives_and_within_the_grace_period() {
        assert!(keep_waiting(true, 0));
        assert!(keep_waiting(true, 74));
        assert!(!keep_waiting(true, 75));
        assert!(!keep_waiting(false, 0));
    }

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
        let env = SidecarEnv::build(&paths, &ports, "tok", "0.1.0", &LocalProtection::default());
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
        assert!(get("KV_ADMIN_ADDRESS").is_none());
    }

    #[test]
    fn env_carries_protection_only_with_an_administrator() {
        let paths = AppPaths {
            data_dir: PathBuf::from("/data"),
            sidecar_main: PathBuf::from("/app/sidecar/dist/main.js"),
        };
        let ports = Ports {
            host: 4200,
            sidecar: 4201,
            control: 4202,
        };
        let protected = LocalProtection {
            protected: true,
            admin_address: Some("0xabc".into()),
        };
        let env = SidecarEnv::build(&paths, &ports, "tok", "0.1.0", &protected);
        let get = |k: &str| env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        assert_eq!(get("KV_PROTECTED").as_deref(), Some("1"));
        assert_eq!(get("KV_ADMIN_ADDRESS").as_deref(), Some("0xabc"));
        let half = LocalProtection {
            protected: true,
            admin_address: None,
        };
        let env = SidecarEnv::build(&paths, &ports, "tok", "0.1.0", &half);
        assert!(
            env.iter()
                .all(|(k, _)| k != "KV_PROTECTED" && k != "KV_ADMIN_ADDRESS")
        );
    }

    #[test]
    fn a_restart_line_means_respawn_and_anything_else_means_exited() {
        assert!(parse_restart_line(
            r#"{"event":"restart","reason":"protection"}"#
        ));
        assert!(!parse_restart_line(
            r#"{"event":"ready","port":4201,"controlPort":4202}"#
        ));
        assert!(!parse_restart_line("[sidecar] restarting the converter"));
        assert_eq!(exit_action(true, false), ExitAction::Respawn);
        assert_eq!(exit_action(false, false), ExitAction::Exited);
        // Closing the window while the engine restarts for the switch: the exit is a stop, never a respawn.
        assert_eq!(exit_action(true, true), ExitAction::Exited);
        assert_eq!(exit_action(false, true), ExitAction::Exited);
    }
}
