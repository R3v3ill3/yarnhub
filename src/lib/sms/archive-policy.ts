export type SmsArchiveKind = "blast" | "survey" | "relay" | "chat";

/**
 * Archive is filing, not a send status. Paused still counts as live:
 * a paused survey still intercepts replies, a paused relay still holds
 * the number, and a paused blast still has queued recipients.
 */
export function archiveBlockReason(kind: SmsArchiveKind, status: string): string | null {
  if (kind === "blast" && (status === "queued" || status === "sending" || status === "paused")) {
    return "Cancel the blast before archiving it. A paused blast still has people waiting.";
  }
  if (kind === "survey" && (status === "open" || status === "paused" || status === "draft")) {
    return "Close the survey before archiving it.";
  }
  if (kind === "relay" && (status === "active" || status === "paused")) {
    return "End the relay before archiving it.";
  }
  if (kind === "chat" && (status === "queued" || status === "sending" || status === "paused")) {
    return "This chat send is still in progress.";
  }
  return null;
}
