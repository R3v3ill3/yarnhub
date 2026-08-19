import { loadSettingsPayload } from "./actions";
import { SettingsForms } from "./settings-forms";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";

export default async function SettingsPage() {
  const payload = await loadSettingsPayload();
  return (
    <AppPage>
      <div className="space-y-6">
      <PageHeader
        title="Connect SMS"
        description={`Guided BYO Mobile Message setup for ${payload.org.name}.`}
      />
      <SettingsForms {...payload} />
      </div>
    </AppPage>
  );
}
