import { RunTimeline } from "@/components/run-timeline";

export const metadata = { title: "Run | Sovereign" };

export default async function RunPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RunTimeline runId={id} />;
}
