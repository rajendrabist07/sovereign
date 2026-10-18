"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { useTRPC } from "@/trpc/client";

function messageFor(error: { message: string; data?: { code?: string } | null }) {
  switch (error.data?.code) {
    case "TOO_MANY_REQUESTS":
    case "PRECONDITION_FAILED":
      return error.message;
    case "FORBIDDEN":
      return "You need the member role to run workflows.";
    default:
      return "Couldn't start the run. Please try again.";
  }
}

export function StartRunButton({
  workflowId,
  label = "Run"
}: {
  workflowId: string;
  label?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const start = useMutation(
    trpc.run.start.mutationOptions({
      onMutate: () => setError(null),
      onSuccess: (run) => {
        // Fire and forget: the run page does not wait for these refetches.
        void queryClient.invalidateQueries(trpc.run.pathFilter());
        void queryClient.invalidateQueries(trpc.quota.pathFilter());
        router.push(`/runs/${run.id}`);
      },
      onError: (e) => setError(messageFor(e))
    })
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <Button disabled={start.isPending} onClick={() => start.mutate({ workflowId })}>
        {start.isPending ? "Starting" : label}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-right text-sm text-failed">
          {error}
        </p>
      )}
    </div>
  );
}
