"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/workflows", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/approvals", label: "Approvals" }
] as const;

export function MainNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block rounded-md px-3 py-2 text-sm",
              active ? "bg-paper font-medium text-ink" : "text-muted hover:text-ink"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
