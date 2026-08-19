import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardList,
  Inbox,
  Megaphone,
  MessagesSquare,
  Radio,
  Users,
} from "lucide-react";
import { getOrgMembership } from "@/lib/auth/require-org-member";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { BrandMark } from "@/components/brand";
import { MarketingFooter } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const tools = [
  {
    title: "Inbox",
    description: "Shared 1:1 threads on your dedicated numbers, with live replies.",
    icon: Inbox,
  },
  {
    title: "Blasts",
    description: "Queued bulk SMS with quiet hours, opt-outs, and delivery tracking.",
    icon: Megaphone,
  },
  {
    title: "P2P chat",
    description: "Pick people from a list, send a personalised opener, then continue 1:1.",
    icon: MessagesSquare,
  },
  {
    title: "Surveys",
    description: "Reply-native sessions. One live survey per organisation and phone.",
    icon: ClipboardList,
  },
  {
    title: "Relays",
    description: "Attributed forwarding through a dedicated number — never CLI spoofing.",
    icon: Radio,
  },
  {
    title: "Contacts & team",
    description: "Lists, invites, roles, and reporting for the organisers who send.",
    icon: Users,
  },
];

export default async function HomePage() {
  if (isSupabaseConfigured()) {
    const membership = await getOrgMembership();
    if (membership?.user) {
      redirect(membership.org ? "/inbox" : "/onboarding");
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="bg-primary py-12 text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 text-center">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
            <BrandMark className="h-24 w-24" priority />
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/80">
                Reveille Strategy
              </p>
              <h1 className="font-display text-4xl font-bold tracking-[0.12em] sm:text-5xl">
                YARNHUB
              </h1>
            </div>
          </div>
          <p className="max-w-2xl text-lg text-white/90">
            SMS organising tools for unions and campaigns. Connect your Mobile
            Message account, register a dedicated number, and run the conversation.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="rounded-full bg-white text-primary hover:bg-white/90"
            >
              <Link href="/signup">Create an account</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-12 px-4 py-16">
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Megaphone className="h-8 w-8" />
            <h2 className="font-display text-3xl font-bold">Campaign SMS, built to organise</h2>
          </div>
          <p className="mx-auto max-w-3xl text-lg text-muted-foreground">
            The same visual language as Reveille’s campaign tools — focused on
            blasts, inbox, peer-to-peer, surveys, and relays.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Card
                key={tool.title}
                className="border-2 transition-all duration-200 hover:border-primary/25 hover:shadow-lg"
              >
                <CardHeader>
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="transition-colors group-hover:text-primary">
                    {tool.title}
                  </CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full font-semibold">
                    <Link href="/signup">Get started</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
