"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { controlClass, Field } from "@/components/field";
import { STEP_LABEL } from "@/lib/step-labels";
import { cn } from "@/lib/utils";
import {
  HTTP_METHODS,
  MAX_STEPS,
  METHODS_WITH_BODY,
  moveStep,
  newStep,
  validateDraft,
  type Draft,
  type DraftStep,
  type FieldErrors,
  type HttpMethod
} from "@/lib/workflow-draft";
import { useTRPC } from "@/trpc/client";

function StepFields({
  step,
  index,
  total,
  errors,
  onChange,
  onMove,
  onRemove
}: {
  step: DraftStep;
  index: number;
  total: number;
  errors: FieldErrors;
  onChange: (next: DraftStep) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const path = `steps.${index}`;
  const label = `step ${index + 1}`;

  return (
    <li className="space-y-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          Step {index + 1}{" "}
          <span className="font-normal text-muted">{STEP_LABEL[step.type]}</span>
        </h3>
        <div className="flex gap-1">
          <Button
            variant="quiet"
            className="h-8 px-2"
            disabled={index === 0}
            aria-label={`Move ${label} up`}
            onClick={() => onMove(index, index - 1)}
          >
            Up
          </Button>
          <Button
            variant="quiet"
            className="h-8 px-2"
            disabled={index === total - 1}
            aria-label={`Move ${label} down`}
            onClick={() => onMove(index, index + 1)}
          >
            Down
          </Button>
          <Button
            variant="quiet"
            className="h-8 px-2"
            disabled={total === 1}
            aria-label={`Remove ${label}`}
            onClick={() => onRemove(index)}
          >
            Remove
          </Button>
        </div>
      </div>

      <Field label="Name" error={errors[`${path}.name`]}>
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className={controlClass(invalid)}
            value={step.name}
            onChange={(e) => onChange({ ...step, name: e.target.value })}
          />
        )}
      </Field>

      {step.type === "HTTP_REQUEST" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Method">
              {({ id, describedBy, invalid }) => (
                <select
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className={controlClass(invalid)}
                  value={step.method}
                  onChange={(e) =>
                    onChange({ ...step, method: e.target.value as HttpMethod })
                  }
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="URL"
              hint="Must start with https://"
              error={errors[`${path}.url`]}
            >
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  inputMode="url"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={cn(controlClass(invalid), "font-mono text-xs")}
                  value={step.url}
                  onChange={(e) => onChange({ ...step, url: e.target.value })}
                />
              )}
            </Field>
          </div>
          {METHODS_WITH_BODY.includes(step.method) && (
            <Field
              label="Request body"
              hint="Sent as-is, usually JSON."
              error={errors[`${path}.body`]}
            >
              {({ id, describedBy, invalid }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  rows={4}
                  spellCheck={false}
                  className={cn(controlClass(invalid), "h-auto py-2 font-mono text-xs")}
                  value={step.body}
                  onChange={(e) => onChange({ ...step, body: e.target.value })}
                />
              )}
            </Field>
          )}
        </>
      ) : (
        <Field
          label="Seconds to wait"
          hint="Between 1 and 604800 (7 days)."
          error={errors[`${path}.seconds`]}
          className="max-w-48"
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              inputMode="numeric"
              className={cn(controlClass(invalid), "tabular-nums")}
              value={step.seconds}
              onChange={(e) => onChange({ ...step, seconds: e.target.value })}
            />
          )}
        </Field>
      )}
    </li>
  );
}

function saveErrorMessage(error: { data?: { code?: string } | null }) {
  switch (error.data?.code) {
    case "FORBIDDEN":
      return "You need the admin role to change workflows.";
    case "NOT_FOUND":
      return "This workflow no longer exists.";
    default:
      return "Couldn't save the workflow. Please try again.";
  }
}

export function WorkflowForm({
  workflowId,
  initial
}: {
  workflowId?: string;
  initial?: Draft;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>(
    () => initial ?? { name: "", steps: [newStep("HTTP_REQUEST", crypto.randomUUID())] }
  );
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Errors appear after the first submit, then follow every keystroke.
  const validation = attempted ? validateDraft(draft) : null;
  const errors: FieldErrors = validation && !validation.ok ? validation.errors : {};

  const onSaved = () => {
    void queryClient.invalidateQueries(trpc.workflow.pathFilter());
    router.push("/workflows");
  };
  const onError = (error: { data?: { code?: string } | null }) =>
    setServerError(saveErrorMessage(error));

  const create = useMutation(trpc.workflow.create.mutationOptions({ onSuccess: onSaved, onError }));
  const update = useMutation(trpc.workflow.update.mutationOptions({ onSuccess: onSaved, onError }));
  const saving = create.isPending || update.isPending;

  const setStep = (index: number, next: DraftStep) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? next : s)) }));
  const addStep = (type: DraftStep["type"]) =>
    setDraft((d) => ({ ...d, steps: [...d.steps, newStep(type, crypto.randomUUID())] }));
  const move = (from: number, to: number) =>
    setDraft((d) => ({ ...d, steps: moveStep(d.steps, from, to) }));
  const remove = (index: number) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    setServerError(null);
    const result = validateDraft(draft);
    if (!result.ok) return;
    if (workflowId) update.mutate({ id: workflowId, ...result.input });
    else create.mutate(result.input);
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-8">
      <Field label="Workflow name" error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className={controlClass(invalid)}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        )}
      </Field>

      <section aria-labelledby="steps-heading" className="space-y-4">
        <div>
          <h2 id="steps-heading" className="font-medium">
            Steps
          </h2>
          <p className="text-sm text-muted">
            Steps run in order. If one fails, the run stops there.
          </p>
        </div>
        {errors.steps && (
          <p role="alert" className="text-sm text-failed">
            {errors.steps}
          </p>
        )}
        <ol className="divide-y divide-line border-y border-line">
          {draft.steps.map((step, index) => (
            <StepFields
              key={step.key}
              step={step}
              index={index}
              total={draft.steps.length}
              errors={errors}
              onChange={(next) => setStep(index, next)}
              onMove={move}
              onRemove={remove}
            />
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            disabled={draft.steps.length >= MAX_STEPS}
            onClick={() => addStep("HTTP_REQUEST")}
          >
            Add HTTP request
          </Button>
          <Button
            variant="quiet"
            disabled={draft.steps.length >= MAX_STEPS}
            onClick={() => addStep("WAIT")}
          >
            Add wait
          </Button>
        </div>
      </section>

      {serverError && (
        <p role="alert" className="text-sm text-failed">
          {serverError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving" : workflowId ? "Save changes" : "Create workflow"}
        </Button>
        <Link href="/workflows" className="text-sm text-muted hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}
