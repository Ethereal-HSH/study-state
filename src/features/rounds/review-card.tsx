import Link from "next/link";
import { bases, levels } from "@/lib/models";
import {
  roundPerformances,
  type RoundReview,
  type StudyRound,
} from "@/lib/round-models";

export function RoundReviewCard({
  review,
  round,
  previous = [],
}: {
  review: RoundReview;
  round?: StudyRound;
  previous?: RoundReview[];
}) {
  const e = review.evaluation;
  const prior = previous.filter(
    (x) =>
      round?.baseline.priorReviewIds.includes(x.id) &&
      x.pointIds.some((id) => review.pointIds.includes(id)),
  );
  return (
    <article className="round-review-card">
      <div className="section-title between">
        <h3>{review.title}</h3>
        <span className="tag">{roundPerformances[e.performance]}</span>
      </div>
      <p className="field-help">
        第{review.roundNumber}轮 · {review.day || "学习日期未登记"}
      </p>
      <p className="round-prose">{review.summary}</p>
      <div className="round-links">
        {review.points.length ? (
          review.points.map((p) => (
            <Link href={`/knowledge/${p.id}`} key={p.id}>
              {p.chapter} / {p.name}
            </Link>
          ))
        ) : (
          <span>整体任务，尚未指定知识点</span>
        )}
      </div>
      <details>
        <summary>查看本轮作答与此前情况</summary>
        <div className="round-compare">
          <section>
            <h4>本轮表现</h4>
            {[
              ["首次作答", e.firstAnswer],
              ["提示条件", e.assistance],
              ["订正表现", e.correction],
              ["仍待验证", e.remaining],
            ].map(([label, value]) => (
              <p key={label}>
                <strong>{label}：</strong>
                {value || "原文未提供，待核对"}
              </p>
            ))}
            {e.sourceLevel && (
              <p>
                <strong>本轮原文建议：</strong>
                {e.sourceLevel}；{e.sourceLevelQuote}
                （保留原文口径，不改当前等级）
              </p>
            )}
          </section>
          <section>
            <h4>本轮开始前的情况</h4>
            <p className="field-help">
              创建本轮时保存的快照，包含此前积累；不推定为第一轮结束当天。
            </p>
            {review.pointIds
              .map((id) => round?.baseline.points.find((p) => p.id === id))
              .filter((p) => !!p)
              .map((p) => (
                <details key={p.id}>
                  <summary>
                    {p.name} ·{" "}
                    {p.masteryBasis === "UNASSESSED"
                      ? bases.UNASSESSED
                      : `${p.masteryLevel} · ${levels[p.masteryLevel]}（${bases[p.masteryBasis]}）`}
                  </summary>
                  <p className="round-prose">
                    {p.aiSummary || "此前未填写摘要。"}
                  </p>
                </details>
              ))}
            {!review.pointIds.length && (
              <p>未指定知识点；整体任务保留在本轮，未强行与旧知识点对照。</p>
            )}
            {review.pointIds.some(
              (id) => !round?.baseline.points.some((p) => p.id === id),
            ) && <p>部分知识点在本轮开始后才加入目录，暂无开始时快照。</p>}
            {prior.length > 0 && (
              <details>
                <summary>此前轮次的相关任务（{prior.length}）</summary>
                {prior.map((x) => (
                  <p key={x.id}>
                    第{x.roundNumber}轮 · {x.title}：{x.summary}
                    （相关任务，不等于同题复测）
                  </p>
                ))}
              </details>
            )}
          </section>
        </div>
        <p className="round-prose">
          <strong>原文依据：</strong>
          {review.quote}
        </p>
        <Link
          href={`/rounds?roundId=${review.roundId}&draftId=${review.importId}`}
        >
          查看整份原文与确认稿
        </Link>
      </details>
    </article>
  );
}
