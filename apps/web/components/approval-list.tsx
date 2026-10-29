"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast, type ApprovalDecision } from "@sovereign/shared";
import { Button } from "@/components/button";
import { ListEmpty, ListError, ListSkeleton } from "@/components/list-states";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Pending = RouterOutputs["approval"]["listPending"][number];

function ApprovalItem({ approval, canDecide }: { approval: Pending; canDecide: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const decide = useMutation(
    trpc.approval.decide.mutationOptions({
      onSuccess: async (result) => {
        if (result.alreadyDecided) {
          setNotice("Someone else already decided this request.");
        }
        await queryClient.invalidateQueries(trpc.approval.listPending.queryFilter());
      }
    })
  );

  const submit = (decision: ApprovalDecision) => {
    setNotice(null);
    decide.mutate({
      approvalId: approval.id,
      decision,
      note: note.trim() || undefined
    });
  };

  const label = `${approval.workflowName}: ${approval.stepName}`;

  return (
    <li className="space-y-3 py-4">
      <div>
        <p className="font-medium">{approval.workflowName}</p>
        <p className="text-sm text-muted">
          {approval.stepName} · requested {formatRelative(approval.requestedAt)} ·{" "}
          <Link
            href={`/runs/${approval.runId}`}
            className="underline underline-offset-4 hover:text-ink"
          >
            View run
          </Link>
        </p>
      </div>

      {approval.instructions && (
        <p className="whitespace-pre-line text-sm">{approval.instructions}</p>
      )}

      {canDecide ? (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-sm text-muted">
            Note (optional)
          </label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => submit("APPROVED")}
              disabled={decide.isPending}
              aria-label={`Approve ${label}`}
            >
              Approve
            </Button>
            <Button
              variant="quiet"
              onClick={() => submit("REJECTED")}
              disabled={decide.isPending}
              aria-label={`Reject ${label}`}
            >
              Reject
            </Button>
            <span className="text-sm text-muted">Rejecting stops the run.</span>
          </div>
          {decide.isError && (
            <p role="alert" className="text-sm text-failed">
              Couldn&rsquo;t save the decision. Please try again.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">An admin needs to decide this request.</p>
      )}

      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
    </li>
  );
}

export function ApprovalList() {
  const trpc = useTRPC();
  const pending = useQuery({
    ...trpc.approval.listPending.queryOptions(),
    refetchInterval: 10_000
  });
  const me = useQuery(trpc.me.queryOptions());
  const canDecide = me.data ? roleAtLeast(me.data.role, "ADMIN") : false;

  if (pending.isPending) return <ListSkeleton />;
  if (pending.isError) {
    return (
      <ListError
        title="Couldn't load approvals."
        message="Something went wrong while loading. Try again."
        onRetry={() => pending.refetch()}
      />
    );
  }
  if (pending.data.length === 0) {
    return (
      <ListEmpty
        title="Nothing is waiting for approval"
        hint="Runs that reach an approval step show up here."
      />
    );
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {pending.data.map((approval) => (
        <ApprovalItem key={approval.id} approval={approval} canDecide={canDecide} />
      ))}
    </ul>
  );
}
