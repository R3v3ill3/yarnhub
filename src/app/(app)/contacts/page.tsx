import { requireOrgMember } from "@/lib/auth/require-org-member";
import { Badge } from "@/components/ui/alert";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { ContactForms } from "./contact-forms";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";

export default async function ContactsPage() {
  const { supabase, org } = await requireOrgMember();
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, phone_e164, sms_opt_out, created_at")
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: false });
  const { data: lists } = await supabase
    .from("contact_lists")
    .select("id, name, created_at")
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: false });

  return (
    <AppPage>
      <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description={`People you can message from ${org.name}.`}
      />
      <ContactForms lists={lists ?? []} />
      {lists?.length ? (
        <ul className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {lists.map((list) => (
            <li key={list.id} className="rounded-full border border-border px-3 py-1">
              {list.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="overflow-x-auto rounded-lg border-2 border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">SMS</th>
            </tr>
          </thead>
          <tbody>
            {(contacts ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-2">
                  {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-4 py-2 font-mono">{toDisplay(c.phone_e164)}</td>
                <td className="px-4 py-2">
                  {c.sms_opt_out ? (
                    <Badge variant="destructive">Opted out</Badge>
                  ) : (
                    <Badge variant="secondary">Can send</Badge>
                  )}
                </td>
              </tr>
            ))}
            {!contacts?.length ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={3}>
                  No contacts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      </div>
    </AppPage>
  );
}
