import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  alt = "Reveille Strategy",
  priority = false,
}: {
  className?: string;
  alt?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/tools-logo.png"
      alt={alt}
      width={120}
      height={120}
      className={cn("h-10 w-10 object-contain", className)}
      priority={priority}
    />
  );
}

export function BrandLockup({
  href = "/",
  inverted = false,
  subtitle = "Reveille Strategy",
}: {
  href?: string;
  inverted?: boolean;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3",
        inverted ? "text-white" : "text-foreground",
      )}
    >
      <BrandMark className="h-11 w-11" priority={inverted} />
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-bold tracking-[0.2em]">
          YARNHUB
        </span>
        <span
          className={cn(
            "mt-1 max-w-[11rem] truncate text-[11px] font-medium tracking-wide",
            inverted ? "text-white/80" : "text-muted-foreground",
          )}
        >
          {subtitle}
        </span>
      </span>
    </Link>
  );
}
