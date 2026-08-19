"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "./sign-out";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
