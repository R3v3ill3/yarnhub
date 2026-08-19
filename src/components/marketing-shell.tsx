import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";

export function BrandBanner({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="bg-primary py-10 text-white">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 text-center">
        <Link href="/" className="flex items-center gap-4">
          <BrandMark className="h-16 w-16" priority />
          <span className="font-display text-3xl font-bold tracking-[0.18em] sm:text-4xl">
            YARNHUB
          </span>
        </Link>
        {kicker ? (
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/80">
            {kicker}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-xl text-sm text-white/85 sm:text-base">{description}</p>
        ) : null}
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-auto bg-primary py-8 text-white">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-center text-sm text-white/85">
        <BrandLockup href="https://reveille.net.au" inverted subtitle="A Reveille Strategy tool" />
        <p>
          <Link href="https://reveille.net.au" className="underline-offset-4 hover:underline">
            reveille.net.au
          </Link>
          {" · "}
          <Link href="https://tools.reveille.net.au" className="underline-offset-4 hover:underline">
            Campaign tools
          </Link>
        </p>
      </div>
    </footer>
  );
}

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-muted">
      <BrandBanner title={title} description={description} kicker="Reveille Strategy" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        {children}
      </div>
      <MarketingFooter />
    </div>
  );
}
