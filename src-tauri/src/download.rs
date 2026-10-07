//! Downloads from the page (an original source file, a document's export): saved into the
//! user's Downloads folder under the name the page suggested, never over an existing file,
//! and reported back to the window so it can say where the file went.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Destinations by download URL — macOS reports no path when a download finishes.
#[derive(Default)]
pub struct Downloads(pub Mutex<HashMap<String, PathBuf>>);

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

#[cfg(test)]
mod tests {
    use super::*;

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
