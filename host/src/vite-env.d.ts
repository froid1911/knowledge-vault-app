/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SIDECAR_PORT?: string;
  readonly VITE_CONTROL_PORT?: string;
  readonly VITE_CONTROL_TOKEN?: string;
}
declare module "*.css";
