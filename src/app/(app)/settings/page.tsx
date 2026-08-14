import { loadSettingsPayload } from "./actions";
import { SettingsForms } from "./settings-forms";

export default async function SettingsPage() {
  const payload = await loadSettingsPayload();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect SMS</h1>
        <p className="text-muted-foreground">
          Guided BYO Mobile Message setup for {payload.org.name}.
        </p>
      </div>
      <SettingsForms {...payload} />
    </div>
  );
}
