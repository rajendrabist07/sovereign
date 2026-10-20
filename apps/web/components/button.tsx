import { cn } from "@/lib/utils";

type Variant = "primary" | "quiet";

/** Exported so links can look like buttons without being buttons. */
export function buttonClasses(variant: Variant = "primary", className?: string) {
  return cn(
    "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    variant === "primary"
      ? "bg-brand text-on-brand hover:opacity-90"
      : "border border-line bg-surface text-ink hover:bg-paper",
    className
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}
