import * as React from "react";
import { cn } from "@/lib/utils";

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "relative w-full rounded-md border-2 px-4 py-3 text-sm",
        variant === "destructive"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & {
  variant?: "default" | "secondary" | "outline" | "destructive";
}) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variant === "default" &&
          "border-transparent bg-primary text-primary-foreground",
        variant === "secondary" &&
          "border-transparent bg-secondary text-secondary-foreground",
        variant === "outline" && "border-border text-foreground",
        variant === "destructive" &&
          "border-transparent bg-destructive text-destructive-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="separator"
      className={cn("h-px w-full bg-border", className)}
      {...props}
    />
  );
}

export { Alert, Badge, Separator };
