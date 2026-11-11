import { readCatalog } from "@/server/catalog";
import {
  readStudyRounds,
  readRoundReviews,
  readRoundDrafts,
  readRoundDraft,
} from "@/server/study-rounds";
import { RoundWorkspace } from "@/features/rounds/round-workspace";
import { localDay } from "@/lib/dates";
export const dynamic = "force-dynamic";
export default async function Rounds({
  searchParams,
}: {
  searchParams: Promise<{ roundId?: string; draftId?: string }>;
}) {
  const query = await searchParams;
  return (
    <RoundWorkspace
      catalog={readCatalog()}
      rounds={readStudyRounds()}
      reviews={readRoundReviews()}
      history={readRoundDrafts()}
      initialRoundId={query.roundId || null}
      initialDraft={query.draftId ? readRoundDraft(query.draftId) : null}
      today={localDay(
        new Date().toISOString(),
        process.env.APP_TIMEZONE || "Asia/Shanghai",
      )}
      timeZone={process.env.APP_TIMEZONE || "Asia/Shanghai"}
    />
  );
}
