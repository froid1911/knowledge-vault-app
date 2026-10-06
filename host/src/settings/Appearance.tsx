import { useTheme } from "@powerhousedao/reactor-browser";

const OPTIONS = [
  { value: "dark", label: "Dark", hint: "The default — the vault's own theme." },
  { value: "light", label: "Light", hint: "" },
  { value: "system", label: "System", hint: "Follows the operating system." },
] as const;

/** Dark / Light / System — written where reactor-browser reads it, so the vault app follows at once. */
export function AppearanceSection() {
  const { theme, isSystem, setTheme } = useTheme();
  const current = isSystem ? "system" : theme;
  return (
    <div className="kv-settings-body">
      <p className="kv-settings-lead">The app and the vaults share one theme.</p>
      <fieldset className="kv-choice-group">
        <legend className="kv-visually-hidden">Theme</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="kv-choice" data-selected={current === o.value}>
            <input type="radio" name="theme" value={o.value} checked={current === o.value} onChange={() => setTheme(o.value)} />
            <span className="kv-choice-label">{o.label}</span>
            {o.hint && <span className="kv-choice-hint">{o.hint}</span>}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
