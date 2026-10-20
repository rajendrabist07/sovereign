import { WorkflowEditor } from "@/components/workflow-editor";

export const metadata = { title: "Edit workflow | Sovereign" };

export default async function EditWorkflowPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Edit workflow</h1>
        <p className="text-muted">
          Changes apply to new runs. Runs already started keep the steps they began with.
        </p>
      </header>
      <WorkflowEditor workflowId={id} />
    </div>
  );
}
