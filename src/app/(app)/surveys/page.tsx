import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TestRoster } from "./test-roster";

export default async function SurveysPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: surveys }, { data: contacts }, { data: roster }] = await Promise.all([
    supabase
      .from("sms_surveys")
      .select("id, title, status, created_at, opened_at, is_test, archived_at")
      .eq("organisation_id", org.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, phone_e164")
      .eq("organisation_id", org.id)
      .order("last_name", { ascending: true }),
    supabase
      .from("sms_test_recipients")
      .select("contact_id, contacts ( first_name, last_name, phone_e164 )")
      .eq("organisation_id", org.id),
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          title="Surveys"
          description={`Reply-native questions. One live session per phone in ${org.name}.`}
          actions={
            <Button asChild>
              <Link href="/surveys/new">New survey</Link>
            </Button>
          }
        />
        {!surveys?.length ? (
          <p className="text-sm text-muted-foreground">No surveys yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border-2 border-border">
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
                  <Badge variant="secondary">
                    {survey.is_test ? "test · " : ""}
                    {survey.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <TestRoster
          contacts={contacts ?? []}
          roster={(roster ?? []).map((row) => {
            const contact = row.contacts as
              | { first_name: string | null; last_name: string | null; phone_e164: string }
              | { first_name: string | null; last_name: string | null; phone_e164: string }[]
              | null;
            const person = Array.isArray(contact) ? contact[0] : contact;
            return {
              contactId: row.contact_id as string,
              name: [person?.first_name, person?.last_name].filter(Boolean).join(" "),
              phone: person?.phone_e164 ?? "",
            };
          })}
        />
      </div>
    </AppPage>
  );
}
