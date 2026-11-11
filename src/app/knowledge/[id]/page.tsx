import { pointDetail, readCatalog, AppError } from "@/server/catalog";
import { PointView } from "@/features/knowledge/point-view";
import { notFound } from "next/navigation";
import { LearningWorkspace } from "@/features/learning/workspace";
import { readSessions, readAssessments, readErrors } from "@/server/learning";
import { ReviewWorkspace } from "@/features/reviews/review-workspace";
import { reviewWorkspaceData } from "@/server/review-data";
import { readStudyRounds, readRoundReviews } from "@/server/study-rounds";
import { RoundReviewCard } from "@/features/rounds/review-card";
export const dynamic = "force-dynamic";
export default async function PointPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const detail = pointDetail(id);
    const catalog = readCatalog();
    const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
    const rounds = readStudyRounds(),
      roundReviews = readRoundReviews(),
      pointReviews = roundReviews.filter((x) => x.pointIds.includes(id));
    return (
      <PointView
        {...detail}
        catalog={catalog}
        timeZone={timeZone}
        learningContent={
          <>
            {pointReviews.length > 0 && (
              <section className="card round-panel">
                <h2>分轮评估与此前情况</h2>
                <p>
                  本轮任务可跨多个章节；此处只显示与当前知识点有关的综合任务，原有笔记和等级保留。
                </p>
                {pointReviews.map((x) => (
                  <RoundReviewCard
                    key={x.id}
                    review={x}
                    round={rounds.find((r) => r.id === x.roundId)}
                    previous={roundReviews}
                  />
                ))}
              </section>
            )}
            {!detail.point.archivedAt && (
              <ReviewWorkspace
                {...reviewWorkspaceData()}
                mode="point"
                pointId={id}
              />
            )}
            <LearningWorkspace
              mode="point"
              point={detail.point}
              catalog={catalog}
              sessions={readSessions()}
              assessments={readAssessments()}
              errors={readErrors()}
              timeZone={timeZone}
            />
          </>
        }
      />
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
