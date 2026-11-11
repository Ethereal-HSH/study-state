import { readCatalog } from "@/server/catalog";
import { readSessions, readAssessments, readErrors } from "@/server/learning";
import { LearningWorkspace } from "@/features/learning/workspace";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessions = readSessions();
  if (!sessions.some((s) => s.id === id)) notFound();
  return (
    <LearningWorkspace
      mode="sessions"
      sessionId={id}
      catalog={readCatalog()}
      sessions={sessions}
      assessments={readAssessments()}
      errors={readErrors()}
      timeZone={process.env.APP_TIMEZONE || "Asia/Shanghai"}
    />
  );
}
