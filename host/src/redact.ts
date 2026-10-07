/**
 * What the app shows or copies from the engine's log must not carry credentials or the
 * user's home folder. A keyword (token, key, password…) takes the rest of the line with it;
 * a token without one — a JWT, a callback's code or signature — is caught by its shape.
 */
export function redact(line: string, home?: string): string {
  let out = line;
  if (home) out = out.split(home).join("~");
  out = out.replace(/\/(?:home|Users)\/[^/\s]+/g, "~");
  out = out.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[…]");
  out = out.replace(/\bsk-[\w-]+/gi, "[…]");
  out = out.replace(/([?&](?:code|sig|signature|state|access_token|id_token|token)=)[^&\s]*/gi, "$1[…]");
  out = out.replace(/(token|secret|key|authorization|bearer|password|passwd|cookie)\b[^\n]*/gi, "$1 […]");
  return out;
}
