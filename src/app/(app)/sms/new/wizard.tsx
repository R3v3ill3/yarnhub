"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SmsActionKindPicker } from "@/components/sms-action-kind-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SMS_ACTION_KIND_COPY,
  type SmsActionKind,
} from "@/lib/sms/action-kind";
import { BlastComposeForm } from "../../blasts/compose-form";
import { P2pBoard } from "../../p2p/p2p-board";
import { RelayCreateForm } from "../../relays/relay-create-form";
import { SurveyEditorForm } from "../../surveys/survey-editor-form";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  sms_opt_out: boolean;
};

export function SmsCreateWizard(props: {
  initialKind: SmsActionKind | null;
  orgName: string;
  numbers: NumberRow[];
  lists: Array<{ id: string; name: string }>;
  eligibleCount: number;
  contacts: ContactRow[];
  occupiedRelayNumberIds: string[];
}) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<SmsActionKind | null>(props.initialKind);
  const committed = props.initialKind;

  useEffect(() => {
    if (!committed) return;
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [committed]);

  function onContinue() {
    if (!draft) return;
    if (draft === committed) {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.replace(`/sms/new?kind=${draft}`, { scroll: false });
  }

  const home = SMS_ACTION_KIND_COPY[committed ?? draft ?? "blast"].home;
  const cancelHref = draft || committed ? home : "/inbox";
  const summary = draft ? SMS_ACTION_KIND_COPY[draft] : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold tracking-tight">New SMS action</h1>
        <p className="text-sm text-muted-foreground">
          Choose what to run for {props.orgName}. The editor opens next.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. What do you want to run?</CardTitle>
        </CardHeader>
        <CardContent>
          <SmsActionKindPicker value={draft} onChange={setDraft} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-border bg-muted/40 px-4 py-3">
        <p className="text-sm">
          {summary ? (
            <>
              You&apos;re creating <strong>{summary.noun}</strong>.
            </>
          ) : (
            <span className="text-muted-foreground">Pick a kind to continue.</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={cancelHref}>Cancel</Link>
          </Button>
          <Button type="button" onClick={onContinue} disabled={!draft}>
            <ArrowRight className="h-4 w-4" />
            Continue
          </Button>
        </div>
      </div>

      {committed ? (
        <div ref={editorRef} className="scroll-mt-6 space-y-3">
          <h2 className="font-display text-lg font-bold">
            2. {SMS_ACTION_KIND_COPY[committed].editorTitle}
          </h2>
          {committed === "blast" ? (
            <BlastComposeForm
              key="blast"
              orgName={props.orgName}
              numbers={props.numbers}
              lists={props.lists}
              eligibleCount={props.eligibleCount}
            />
          ) : null}
          {committed === "chat" ? (
            <P2pBoard
              key="chat"
              orgName={props.orgName}
              numbers={props.numbers}
              contacts={props.contacts}
            />
          ) : null}
          {committed === "survey" ? (
            <SurveyEditorForm key="survey" orgName={props.orgName} />
          ) : null}
          {committed === "relay" ? (
            <RelayCreateForm
              key="relay"
              numbers={props.numbers}
              occupiedNumberIds={props.occupiedRelayNumberIds}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
