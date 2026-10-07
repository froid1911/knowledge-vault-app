import { useEffect, useRef } from "react";

/**
 * Signing in is a step on the way somewhere: when a sign-in completes on Settings › Identity
 * (signed out → signed in), go back to the landing, where Connect remote vault now works.
 * The first status read (already signed in at launch), a sign-out and a sign-in while
 * elsewhere leave the user where they are.
 */
export function useReturnHomeAfterSignIn(authenticated: boolean | undefined, onIdentityPage: boolean, goHome: () => void): void {
  const previous = useRef(authenticated);
  useEffect(() => {
    const before = previous.current;
    previous.current = authenticated;
    if (onIdentityPage && before === false && authenticated === true) goHome();
  }, [authenticated, onIdentityPage, goHome]);
}
