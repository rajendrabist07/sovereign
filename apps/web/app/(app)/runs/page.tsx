import { RunHistory } from "@/components/run-history";

export const metadata = { title: "Runs | Sovereign" };

export default function RunsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
        <p className="text-muted">Every run, newest first.</p>
      </header>
      <RunHistory />
    </div>
  );
}
