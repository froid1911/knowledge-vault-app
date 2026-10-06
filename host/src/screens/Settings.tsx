import type { SidecarInfo } from "../sidecar.js";
import { deleteVault, fetchSettings, fetchStatus, fetchVaults, renameVault, saveSettings, type AppSettings, type DriveRef, type EngineStatus, type SettingsPatch, type VaultSummary } from "../vaults.js";
import { AppBar } from "../shell/AppBar.js";
import { SETTINGS_SECTIONS, type SettingsSection } from "../shell/router.js";
import { AboutSection } from "../settings/About.js";
import { AppearanceSection } from "../settings/Appearance.js";
import { DiagnosticsSection } from "../settings/Diagnostics.js";
import { IdentitySection } from "../settings/Identity.js";
import { ModelsSection } from "../settings/Models.js";
import { VaultsSection } from "../settings/Vaults.js";
import { WorkflowsSection } from "../settings/Workflows.js";

export type SettingsApi = {
  fetchVaults: (info: SidecarInfo) => Promise<VaultSummary[]>;
  renameVault: (info: SidecarInfo, id: string, name: string) => Promise<DriveRef>;
  deleteVault: (info: SidecarInfo, id: string) => Promise<void>;
  fetchSettings: (info: SidecarInfo) => Promise<AppSettings>;
  saveSettings: (info: SidecarInfo, patch: SettingsPatch) => Promise<AppSettings>;
  fetchStatus: (info: SidecarInfo) => Promise<EngineStatus>;
};
export const realSettingsApi: SettingsApi = { fetchVaults, renameVault, deleteVault, fetchSettings, saveSettings, fetchStatus };

const LABELS: Record<SettingsSection, string> = {
  vaults: "Vaults",
  appearance: "Appearance",
  models: "Models",
  workflows: "Workflows",
  diagnostics: "Diagnostics",
  about: "About",
  identity: "Identity",
};

type Props = {
  info: SidecarInfo;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onBack: () => void;
  onOpenWorkflows: () => void;
  api?: SettingsApi;
};

/** Settings as a full page: the sections list is where a sidebar belongs — here the sections are peers. */
export function Settings({ info, section, onSection, onBack, onOpenWorkflows, api = realSettingsApi }: Props) {
  return (
    <div className="kv-vault-screen">
      <AppBar title="Settings" onBack={onBack} />
      <div className="kv-settings">
        <nav className="kv-settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s} type="button" className="kv-settings-link" aria-current={s === section ? "page" : undefined} onClick={() => onSection(s)}>
              {LABELS[s]}
            </button>
          ))}
        </nav>
        <section className="kv-settings-panel" aria-labelledby="settings-section-heading">
          <h2 id="settings-section-heading" className="kv-settings-heading">{LABELS[section]}</h2>
          {section === "vaults" && <VaultsSection info={info} api={api} />}
          {section === "appearance" && <AppearanceSection />}
          {section === "models" && <ModelsSection info={info} api={api} />}
          {section === "workflows" && <WorkflowsSection onOpen={onOpenWorkflows} />}
          {section === "diagnostics" && <DiagnosticsSection info={info} api={api} />}
          {section === "about" && <AboutSection info={info} api={api} />}
          {section === "identity" && <IdentitySection />}
        </section>
      </div>
    </div>
  );
}
