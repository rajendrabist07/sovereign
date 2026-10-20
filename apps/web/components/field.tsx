import { useId } from "react";
import { cn } from "@/lib/utils";

export const controlClass = (invalid: boolean) =>
  cn(
    "h-9 w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-muted",
    invalid ? "border-failed" : "border-line"
  );

type ControlProps = { id: string; describedBy?: string; invalid: boolean };

/** Label + control + hint + error, wired together for screen readers. */
export function Field({
  label,
  hint,
  error,
  className,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-failed">
          {error}
        </p>
      )}
    </div>
  );
}
