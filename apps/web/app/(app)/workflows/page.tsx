import { WorkflowList } from "@/components/workflow-list";

export const metadata = { title: "Workflows | Sovereign" };

export default function WorkflowsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-muted">Automations your team can run.</p>
      </header>
      <WorkflowList />
    </div>
  );
}
