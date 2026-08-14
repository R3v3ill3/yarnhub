import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgMembership } from "@/lib/auth/require-org-member";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (isSupabaseConfigured()) {
    const membership = await getOrgMembership();
    if (membership?.user) {
      redirect(membership.org ? "/inbox" : "/onboarding");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="w-full max-w-lg space-y-6 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Yarnhub
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          SMS tools for your organisation
        </h1>
        <p className="text-muted-foreground text-lg leading-relaxed">
          Connect your own Mobile Message account, register a dedicated number,
          and run conversations from a shared inbox.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/signup">Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
