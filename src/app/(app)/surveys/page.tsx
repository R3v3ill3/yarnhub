import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default async function SurveysPage() {
  const { supabase, org } = await requireOrgMember();
  const { data: surveys } = await supabase
    .from("sms_surveys")
    .select("id, title, status, created_at, opened_at")
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: false });

  return (
    <AppPage>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Surveys</h1>
            <p className="text-muted-foreground">
              Reply-native questions. One live session per phone in {org.name}.
            </p>
          </div>
          <Button asChild>
            <Link href="/surveys/new">New survey</Link>
          </Button>
        </div>
        {!surveys?.length ? (
          <p className="text-sm text-muted-foreground">No surveys yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {surveys.map((survey) => (
              <li key={survey.id}>
                <Link
                  href={`/surveys/${survey.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40"
                >
                  <div>
                    <p className="font-medium">{survey.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(survey.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="secondary">{survey.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
