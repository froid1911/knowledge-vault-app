//! Downloads from the page (an original source file, a document's export): written to a
//! staging folder first, then the desktop's Save dialog asks where the file goes (starting in
//! Downloads, with the name the page suggested) and the file moves there; cancelling deletes it.
//! The window is told where the file went.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A download in flight: where the webview writes it, and the name the page suggested.
#[derive(Clone)]
pub struct Staged {
    pub path: PathBuf,
    pub name: String,
}

/// Staged downloads by URL — macOS reports no path when a download finishes.
#[derive(Default)]
pub struct Downloads(pub Mutex<HashMap<String, Staged>>);

/// The file name to save under: the page's suggestion, else the URL's last segment, never a path.
pub fn file_name_for(suggested: &Path, url: &url::Url) -> String {
    let from_suggestion = suggested
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string);
    let from_url = url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let name = from_suggestion
        .or(from_url)
        .unwrap_or_else(|| "download".into());
    let clean: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '\0') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim_start_matches('.').to_string();
    if clean.is_empty() {
        "download".into()
    } else {
        clean
    }
}

/// `dir/name`, or `dir/stem (n).ext` for the first n that does not exist yet.
pub fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("an unused name")
}

/// Where the webview writes a download before the user picks its place: `root/downloads/`,
/// under a name no other staged download uses.
pub fn staging_path(root: &Path, name: &str) -> PathBuf {
    let dir = root.join("downloads");
    let _ = std::fs::create_dir_all(&dir);
    unique_destination(&dir, name)
}

/// Moves a finished download to the chosen place: a rename, or a copy and delete when the
/// destination is on another filesystem.
pub fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)?;
    std::fs::remove_file(from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_under_a_unique_name_then_moves_where_the_user_chose() {
        let root = std::env::temp_dir().join(format!("kv-dl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let staging = staging_path(&root, "report.pdf");
        assert!(staging.starts_with(root.join("downloads")));
        std::fs::write(&staging, b"%PDF").unwrap();
        let chosen = root.join("chosen").join("my report.pdf");
        std::fs::create_dir_all(chosen.parent().unwrap()).unwrap();
        move_file(&staging, &chosen).unwrap();
        assert_eq!(std::fs::read(&chosen).unwrap(), b"%PDF");
        assert!(!staging.exists());
        // A second staging of the same name never collides with a file still being saved.
        let a = staging_path(&root, "x.pdf");
        std::fs::write(&a, b"1").unwrap();
        assert_ne!(staging_path(&root, "x.pdf"), a);
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn u(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn names_the_file_from_the_suggestion_then_the_url_and_never_as_a_path() {
        assert_eq!(
            file_name_for(Path::new("/tmp/report.pdf"), &u("blob:http://127.0.0.1/x")),
            "report.pdf"
        );
        assert_eq!(
            file_name_for(Path::new(""), &u("http://127.0.0.1:4201/files/notes.md")),
            "notes.md"
        );
        assert_eq!(
            file_name_for(Path::new(""), &u("blob:http://127.0.0.1/")),
            "download"
        );
        assert_eq!(
            file_name_for(Path::new(".hidden"), &u("http://x/")),
            "hidden"
        );
    }

    #[test]
    fn never_overwrites_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("kv-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_destination(&dir, "a.pdf"), dir.join("a.pdf"));
        std::fs::write(dir.join("a.pdf"), "x").unwrap();
        assert_eq!(unique_destination(&dir, "a.pdf"), dir.join("a (1).pdf"));
        std::fs::write(dir.join("a (1).pdf"), "x").unwrap();
        assert_eq!(unique_destination(&dir, "a.pdf"), dir.join("a (2).pdf"));
        std::fs::write(dir.join("README"), "x").unwrap();
        assert_eq!(unique_destination(&dir, "README"), dir.join("README (1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
