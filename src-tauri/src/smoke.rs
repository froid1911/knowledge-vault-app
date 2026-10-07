//! Plan 6: `KV_SMOKE=1` turns a launch into a check — the installed app exits 0 once the engine
//! reported ready and the host page answered on its port (stopping the engine gracefully on the
//! way out), or 1 after 90 s. scripts/smoke-app.mjs and CI drive it.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::sidecar::SidecarState;

const DEADLINE: Duration = Duration::from_secs(90);

/// `GET /` on 127.0.0.1:<port> answers 200.
pub fn host_answers(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(2)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    if stream
        .write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut head = [0u8; 32];
    let n = stream.read(&mut head).unwrap_or(0);
    let line = String::from_utf8_lossy(&head[..n]);
    line.starts_with("HTTP/1.") && line.split_whitespace().nth(1) == Some("200")
}

pub fn watch(app: AppHandle, host_port: u16) {
    let started = Instant::now();
    loop {
        let ready = app
            .state::<Mutex<SidecarState>>()
            .lock()
            .unwrap()
            .ready
            .is_some();
        if ready && host_answers(host_port) {
            println!(
                "[smoke] ok: the engine is ready and the host answered on {host_port} after {:.1} s",
                started.elapsed().as_secs_f64()
            );
            crate::quit(&app);
            return;
        }
        if started.elapsed() > DEADLINE {
            eprintln!(
                "[smoke] failed: engine ready = {ready}, host answering = {} after {} s",
                host_answers(host_port),
                DEADLINE.as_secs()
            );
            crate::sidecar::stop_sidecar_blocking(&app);
            app.exit(1);
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use super::host_answers;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn serve_once(status: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 256];
                let _ = s.read(&mut buf);
                let _ = s.write_all(
                    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes(),
                );
            }
        });
        port
    }

    #[test]
    fn a_page_that_answers_200_is_up_anything_else_is_not() {
        assert!(host_answers(serve_once("200 OK")));
        assert!(!host_answers(serve_once("404 Not Found")));
        let unused = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert!(!host_answers(unused));
    }
}
