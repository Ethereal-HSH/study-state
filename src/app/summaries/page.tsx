import { SummaryWorkspace } from "@/features/summaries/summary-workspace";
import { readCatalog } from "@/server/catalog";
import { buildSummary } from "@/server/summaries";
import { localDay } from "@/lib/dates";
import { addDays } from "@/lib/review-policy";
export const dynamic = "force-dynamic";
export default function Summaries() {
  const zone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  const today = localDay(new Date().toISOString(), zone);
  return (
    <SummaryWorkspace
      catalog={readCatalog()}
      initialReport={buildSummary({
        from: addDays(today, -6),
        to: today,
        subjectId: null,
        chapterId: null,
      })}
    />
  );
}
