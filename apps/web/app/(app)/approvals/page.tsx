import { ApprovalList } from "@/components/approval-list";

export const metadata = { title: "Approvals | Sovereign" };

export default function ApprovalsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-muted">Runs paused until a person decides.</p>
      </header>
      <ApprovalList />
    </div>
  );
}
