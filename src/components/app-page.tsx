import type { ReactNode } from "react";

export function AppPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</div>
  );
}
