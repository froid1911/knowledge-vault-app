export function WorkflowsSection({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="kv-settings-body">
      <p className="kv-settings-lead">Workflows automate what happens in a vault — queued sources turning into notes, scheduled checks, webhooks. They live on a Workflows drive the engine keeps, and you build and run them in Workflow Studio.</p>
      <button type="button" className="kv-button kv-button-primary" onClick={onOpen}>Open Workflow Studio</button>
    </div>
  );
}
