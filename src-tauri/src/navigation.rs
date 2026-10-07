//! Spec §5.8: the window shows the app and nothing else. A full-page navigation to
//! any other origin — an OAuth redirect to OpenRouter or Renown, a documentation
//! link the host's interceptor did not catch — is refused and handed to the system
//! browser instead, so the app is never replaced by a web page it cannot return from.

/// Origins the webview may navigate to: the app's own host (Vite in dev, the bundled
/// app in production) and Tauri's internal scheme.
/// An installed app serves on 127.0.0.1 only: `localhost` may resolve to ::1, where another
/// program could listen on the same port — so it is internal only in development.
pub fn is_internal(url: &url::Url, host_port: u16, packaged: bool) -> bool {
    match url.scheme() {
        // about:blank is what the webview needs; a data: navigation would replace the app.
        "tauri" | "about" => true,
        // A blob the app's own page created (an original file to view or download) is the app's
        // content: allowed when its origin is the app's. Anyone else's blob is not.
        "blob" => url::Url::parse(url.path())
            .map(|inner| is_internal(&inner, host_port, packaged) && inner.scheme() != "blob")
            .unwrap_or(false),
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            let port = url.port_or_known_default();
            (host == "tauri.localhost")
                || ((host == "127.0.0.1" || (host == "localhost" && !packaged))
                    && port == Some(host_port))
        }
        _ => false,
    }
}

/// The URLs the system browser (or mail client) may receive. Anything else — file:, custom
/// schemes a note might carry — is refused silently: the OS handler for it is not ours to invoke.
pub fn external_target(url: &url::Url) -> Option<&str> {
    match url.scheme() {
        "http" | "https" | "mailto" => Some(url.as_str()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn only_web_and_mail_urls_go_to_the_system_opener() {
        assert_eq!(
            external_target(&u("https://www.renown.id/")),
            Some("https://www.renown.id/")
        );
        assert_eq!(
            external_target(&u("mailto:team@example.com")),
            Some("mailto:team@example.com")
        );
        assert_eq!(external_target(&u("file:///etc/passwd")), None);
        assert_eq!(external_target(&u("vscode://file/x")), None);
        assert!(!is_internal(&u("data:text/html,<h1>x</h1>"), 4200, false));
    }

    #[test]
    fn the_apps_own_blobs_are_internal_so_originals_view_and_download() {
        // The vault app shows and downloads an original through a blob it created itself.
        assert!(is_internal(
            &u("blob:http://127.0.0.1:46420/fd27-3356"),
            46420,
            true
        ));
        assert!(is_internal(
            &u("blob:http://127.0.0.1:4200/abc"),
            4200,
            false
        ));
        // Anyone else's blob, or one from the engine's origin, is not the app.
        assert!(!is_internal(
            &u("blob:https://evil.example/abc"),
            46420,
            true
        ));
        assert!(!is_internal(
            &u("blob:http://127.0.0.1:4201/abc"),
            46420,
            true
        ));
        assert!(!is_internal(&u("blob:null/abc"), 46420, true));
    }

    #[test]
    fn the_app_and_tauri_are_internal_everything_else_is_not() {
        assert!(is_internal(
            &u("http://127.0.0.1:4200/vault/x"),
            4200,
            false
        ));
        assert!(is_internal(&u("http://localhost:4200/"), 4200, false));
        assert!(is_internal(&u("tauri://localhost/index.html"), 4200, false));
        assert!(is_internal(&u("http://tauri.localhost/"), 4200, false));
        assert!(!is_internal(
            &u("https://openrouter.ai/auth?callback_url=x"),
            4200,
            false
        ));
        assert!(!is_internal(&u("https://www.renown.id/"), 4200, false));
        assert!(!is_internal(
            &u("http://127.0.0.1:4201/graphql"),
            4200,
            false
        )); // the engine answers fetches, never a navigation
        assert!(!is_internal(&u("file:///etc/passwd"), 4200, false));
        // an installed app: 127.0.0.1 only
        assert!(is_internal(&u("http://127.0.0.1:46420/"), 46420, true));
        assert!(!is_internal(&u("http://localhost:46420/"), 46420, true));
    }
}
