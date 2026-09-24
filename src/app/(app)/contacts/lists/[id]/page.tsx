import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { ListMemberForms } from "./list-member-forms";

export default async function ContactListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: list } = await supabase
    .from("contact_lists")
    .select("id, name")
    .eq("id", id)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!list) notFound();

  const [{ data: members }, { data: contacts }] = await Promise.all([
    supabase
      .from("contact_list_members")
      .select("contact_id, contacts ( id, first_name, last_name, phone_e164, sms_opt_out )")
      .eq("list_id", id)
      .eq("organisation_id", org.id),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, phone_e164")
      .eq("organisation_id", org.id)
      .order("last_name", { ascending: true }),
  ]);

  const people = (members ?? [])
    .map((row) => {
      const contact = row.contacts as
        | {
            id: string;
            first_name: string | null;
            last_name: string | null;
            phone_e164: string;
            sms_opt_out: boolean;
          }
        | {
            id: string;
            first_name: string | null;
            last_name: string | null;
            phone_e164: string;
            sms_opt_out: boolean;
          }[]
        | null;
      return Array.isArray(contact) ? contact[0] : contact;
    })
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  const memberIds = new Set(people.map((person) => person.id));
  const available = (contacts ?? []).filter((contact) => !memberIds.has(contact.id));

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/contacts" className="text-sm text-muted-foreground hover:text-foreground">
            ← Contacts
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{list.name}</h1>
          <p className="text-sm text-muted-foreground">
            {people.length} {people.length === 1 ? "person" : "people"} in this list.
          </p>
        </div>
        <ListMemberForms listId={list.id} available={available} members={people} />
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
              {people.map((person) => (
                <tr key={person.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {[person.first_name, person.last_name].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-4 py-2 font-mono">{toDisplay(person.phone_e164)}</td>
                  <td className="px-4 py-2">{person.sms_opt_out ? "Opted out" : "Can send"}</td>
                </tr>
              ))}
              {!people.length ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={3}>
                    This list is empty.
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
