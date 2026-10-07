//! The engine's output: the last lines for Diagnostics and a "gave up" status, and a rotating file.
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The last `capacity` lines of the engine's output.
pub struct LogTail {
    capacity: usize,
    lines: VecDeque<String>,
}
impl LogTail {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            lines: VecDeque::with_capacity(capacity),
        }
    }
    pub fn push(&mut self, line: &str) {
        if self.lines.len() == self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(line.trim_end().to_string());
    }
    pub fn lines(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }
}

/// The engine's output is the user's: readable by them only.
fn open_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// `<path>` is the live file; past `max_bytes` it becomes `<path>.1`, `.1` becomes `.2`, … up to `keep`.
pub struct RotatingLog {
    path: PathBuf,
    max_bytes: u64,
    keep: u32,
    file: File,
    written: u64,
}
impl RotatingLog {
    pub fn open(path: &Path, max_bytes: u64, keep: u32) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = open_private(path)?;
        let written = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            path: path.to_path_buf(),
            max_bytes,
            keep,
            file,
            written,
        })
    }
    pub fn write_line(&mut self, line: &str) {
        // The file went away under us (a delete-all removes logs/): start a new one.
        if !self.path.exists() {
            if let Some(dir) = self.path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(file) = open_private(&self.path) {
                self.file = file;
                self.written = 0;
            }
        }
        if self.written >= self.max_bytes {
            let _ = self.rotate();
        }
        if writeln!(self.file, "{line}").is_ok() {
            self.written += line.len() as u64 + 1;
        }
    }
    fn rotate(&mut self) -> std::io::Result<()> {
        let _ = std::fs::remove_file(self.numbered(self.keep));
        for n in (1..self.keep).rev() {
            let from = self.numbered(n);
            if from.exists() {
                std::fs::rename(&from, self.numbered(n + 1))?;
            }
        }
        std::fs::rename(&self.path, self.numbered(1))?;
        self.file = open_private(&self.path)?;
        self.written = 0;
        Ok(())
    }
    fn numbered(&self, n: u32) -> PathBuf {
        PathBuf::from(format!("{}.{n}", self.path.display()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn starts_a_new_file_when_the_log_was_deleted_under_it() {
        let dir = std::env::temp_dir().join(format!("kv-log-gone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sidecar.log");
        let mut log = RotatingLog::open(&path, 1_000_000, 3).unwrap();
        log.write_line("before");
        std::fs::remove_dir_all(&dir).unwrap();
        log.write_line("after");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let mut t = LogTail::new(3);
        for l in ["a", "b", "c", "d"] {
            t.push(l);
        }
        assert_eq!(t.lines(), vec!["b", "c", "d"]);
    }
    #[test]
    fn rotates_at_the_size_limit_and_keeps_the_newest_files() {
        let dir = std::env::temp_dir().join(format!("kv-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sidecar.log");
        let mut log = RotatingLog::open(&path, 64, 2).unwrap();
        for i in 0..20 {
            log.write_line(&format!("line {i} xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
        }
        assert!(path.exists());
        assert!(dir.join("sidecar.log.1").exists());
        assert!(!dir.join("sidecar.log.3").exists()); // keep = 2 → .1 and .2 at most
        assert!(std::fs::metadata(&path).unwrap().len() <= 64 + 40);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
