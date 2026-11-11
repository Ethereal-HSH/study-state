import { readCatalog } from "@/server/catalog";
import { readSessions, readAssessments, readErrors } from "@/server/learning";
import { LearningWorkspace } from "@/features/learning/workspace";
export const dynamic = "force-dynamic";
export default function NewSessionPage() {
  return (
    <LearningWorkspace
      mode="sessions"
      initialOpen
      catalog={readCatalog()}
      sessions={readSessions()}
      assessments={readAssessments()}
      errors={readErrors()}
      timeZone={process.env.APP_TIMEZONE || "Asia/Shanghai"}
    />
  );
}
