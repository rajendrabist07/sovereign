"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@sovereign/shared";
import { buttonClasses } from "@/components/button";
import { useTRPC } from "@/trpc/client";

export function NewWorkflowLink() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  if (!me.data || !roleAtLeast(me.data.role, "ADMIN")) return null;
  return (
    <Link href="/workflows/new" className={buttonClasses("primary")}>
      New workflow
    </Link>
  );
}
