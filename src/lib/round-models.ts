import { z } from "zod";
import type { Point } from "./models";
import { resolveSourceQuote } from "./source-quotes";

export const roundPerformances = {
  INDEPENDENT: "有明确独立作答",
  ASSISTED: "提示后完成",
  CORRECTED: "提示后订正",
  EXPLAINED: "主要为讲解，未独立验证",
  UNTESTED: "本轮未测",
  MIXED: "多种表现，见具体条件",
  UNKNOWN: "证据待核对",
} as const;
const optionalText = z.string().trim().min(1).max(3000).nullable();
export const roundEvaluationSchema = z
  .object({
    performance: z.enum(
      Object.keys(roundPerformances) as [
        keyof typeof roundPerformances,
        ...Array<keyof typeof roundPerformances>,
      ],
    ),
    firstAnswer: optionalText,
    assistance: optionalText,
    correction: optionalText,
    remaining: optionalText,
    sourceLevel: z.enum(["UNASSESSED", "A", "B", "C", "D", "E"]).nullable(),
    sourceLevelQuote: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict();
export type RoundEvaluation = z.infer<typeof roundEvaluationSchema>;
export const roundItemSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    summary: z.string().trim().min(1).max(4000),
    quote: z.string().trim().min(1).max(2000),
    pointIds: z
      .array(z.uuid())
      .max(30)
      .refine((ids) => new Set(ids).size === ids.length, "关联知识点不可重复"),
    evaluation: roundEvaluationSchema,
  })
  .strict();
export const roundOutputSchema = z
  .object({
    overview: z.string().trim().min(1).max(3000),
    items: z.array(roundItemSchema).max(30),
    warnings: z.array(z.string().trim().min(1).max(1000)).max(20),
  })
  .strict();
export type RoundItem = z.infer<typeof roundItemSchema> & {
  id: string;
  quoteVerified?: boolean;
};
export interface RoundBaselinePoint extends Point {
  chapterName: string;
}
export interface StudyRound {
  id: string;
  subjectId: string;
  subjectName: string;
  number: number;
  name: string;
  objective: string;
  startedOn: string;
  createdAt: string;
  baseline: { points: RoundBaselinePoint[]; priorReviewIds: string[] };
}
export interface RoundSource {
  id: string;
  roundId: string;
  text: string;
  fileName: string | null;
  sendToGpt: true;
}
export interface RoundDraft {
  id: string;
  roundId: string;
  status: "RUNNING" | "READY" | "FAILED" | "APPLIED" | "DISCARDED";
  version: number;
  source: RoundSource;
  context: RoundBaselinePoint[];
  overview: string;
  items: RoundItem[];
  warnings: string[];
  error: string | null;
  learningDate: string | null;
  createdAt: string;
  applied: {
    recordIds: string[];
    rows: RoundItem[];
    learningDate: string | null;
    overview?: string;
  } | null;
}
export interface RoundReview extends RoundItem {
  roundId: string;
  roundName: string;
  roundNumber: number;
  subjectId: string;
  subjectName: string;
  importId: string;
  day: string | null;
  createdAt: string;
  points: { id: string; name: string; chapter: string }[];
}
export function verifiedRoundItemIds(
  draft: Pick<RoundDraft, "source" | "applied" | "items">,
) {
  return (draft.applied?.rows || draft.items)
    .filter((x) => resolveSourceQuote(draft.source.text, x.quote) !== null)
    .map((x) => x.id);
}
export function roundReviewText(
  review: Pick<RoundReview, "title" | "summary" | "evaluation">,
) {
  const e = review.evaluation;
  return [
    review.title,
    review.summary,
    `本轮表现：${roundPerformances[e.performance]}`,
    e.firstAnswer && `首次作答：${e.firstAnswer}`,
    e.assistance && `提示条件：${e.assistance}`,
    e.correction && `订正表现：${e.correction}`,
    e.remaining && `尚待验证：${e.remaining}`,
    e.sourceLevel &&
      `原文建议等级：${e.sourceLevel}（仅本轮建议，不改变知识点当前等级）${e.sourceLevelQuote ? `；依据：${e.sourceLevelQuote}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function studyRoundMarkdown(
  round: StudyRound,
  reviews: RoundReview[],
  overviews: string[] = [],
) {
  const rows = reviews.filter((x) => x.roundId === round.id),
    ids = new Set(rows.flatMap((x) => x.pointIds));
  return [
    `# 第${round.number}轮 · ${round.name}`,
    `科目：${round.subjectName}`,
    `主线：${round.objective}`,
    `开始日期：${round.startedOn}`,
    "",
    "## 整体学习主线与进展",
    ...overviews,
    "",
    "## 综合任务与本轮评估",
    ...rows.flatMap((x) => [
      `### ${x.day || "学习日期未登记"} · ${x.title}`,
      roundReviewText(x),
      `关联：${x.points.map((p) => `${p.chapter} / ${p.name}`).join("；") || "整体任务，未指定知识点"}`,
      `原文依据：${x.quote}`,
      "",
    ]),
    "## 本轮开始前的已有情况（冻结快照）",
    "这是创建本轮时保存的状态，不追溯推定为第一轮结束当天；本轮未测不抹去此前表现。",
    ...round.baseline.points
      .filter((p) => ids.has(p.id))
      .flatMap((p) => [
        `### ${p.chapterName} / ${p.name}`,
        `此前等级：${p.masteryBasis === "UNASSESSED" ? "暂未评估" : `${p.masteryLevel}（${p.masteryBasis === "EVIDENCE" ? "复测证据" : "用户自评"}）`}`,
        p.aiSummary || "此前未填写摘要。",
        "",
      ]),
    "## 评估边界",
    "本轮建议等级单独保存，提示后完成不作为独立复测通过，不自动改变当前等级、解决错误或完成任务。",
  ].join("\n\n");
}
