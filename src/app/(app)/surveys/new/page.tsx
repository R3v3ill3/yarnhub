import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { SurveyEditorForm } from "../survey-editor-form";

export default async function NewSurveyPage() {
  const { org } = await requireOrgMember();
  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/surveys" className="text-sm text-muted-foreground hover:text-foreground">
            ← Surveys
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">New survey</h1>
        </div>
        <SurveyEditorForm orgName={org.name} />
      </div>
    </AppPage>
  );
}
