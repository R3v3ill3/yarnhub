"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { addListMember, removeListMember } from "../../actions";

export function ListMemberForms(props: {
  listId: string;
  available: Array<{ id: string; first_name: string | null; last_name: string | null; phone_e164: string }>;
  members: Array<{ id: string; first_name: string | null; last_name: string | null }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAdd(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("listId", props.listId);
    const result = await addListMember(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onRemove(contactId: string) {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("listId", props.listId);
    formData.set("contactId", contactId);
    const result = await removeListMember(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <form action={onAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2 sm:flex-1">
          <Label htmlFor="contactId">Add someone</Label>
          <select
            id="contactId"
            name="contactId"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              Choose a contact
            </option>
            {props.available.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {[contact.first_name, contact.last_name].filter(Boolean).join(" ")} ·{" "}
                {toDisplay(contact.phone_e164)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={pending || props.available.length === 0}>
          Add to list
        </Button>
      </form>
      {props.members.length ? (
        <div className="flex flex-wrap gap-2">
          {props.members.map((member) => (
            <Button
              key={member.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onRemove(member.id)}
            >
              Remove {[member.first_name, member.last_name].filter(Boolean).join(" ")}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
