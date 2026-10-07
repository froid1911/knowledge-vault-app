/** Set before a delete-all: whichever reload comes first (the shell's or Settings') lands on the front door. */
export const GO_HOME_KEY = "kv.go-home";

export function requestGoHome(): void {
  try {
    window.sessionStorage.setItem(GO_HOME_KEY, "1");
  } catch {
    // no session storage: Settings' own reload still goes home
  }
}

/** Once at boot, before the first route is read. */
export function goHomeIfAsked(): void {
  try {
    if (window.sessionStorage.getItem(GO_HOME_KEY)) {
      window.sessionStorage.removeItem(GO_HOME_KEY);
      window.location.hash = "#/";
    }
  } catch {
    // no session storage
  }
}
