import { WorkflowEditor } from "@/components/workflow-editor";

export const metadata = { title: "New workflow | Sovereign" };

export default function NewWorkflowPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New workflow</h1>
        <p className="text-muted">Define the steps a run goes through.</p>
      </header>
      <WorkflowEditor />
    </div>
  );
}
