import { NewWorkflowLink } from "@/components/new-workflow-link";
import { WorkflowList } from "@/components/workflow-list";

export const metadata = { title: "Workflows | Sovereign" };

export default function WorkflowsPage() {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-muted">Automations your team can run.</p>
        </div>
        <NewWorkflowLink />
      </header>
      <WorkflowList />
    </div>
  );
}
