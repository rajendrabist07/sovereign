import { Button } from "@/components/button";

export function ListSkeleton() {
  return (
    <div className="divide-y divide-line border-y border-line" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-line motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function ListError({
  title,
  message,
  onRetry
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="space-y-3 border-y border-line py-4">
      <p>{title}</p>
      <p className="text-sm text-muted">{message}</p>
      <Button variant="quiet" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function ListEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-y border-line py-6">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted">{hint}</p>
    </div>
  );
}
