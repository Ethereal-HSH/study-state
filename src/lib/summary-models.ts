import { z } from "zod";
import { bases, levels, stages, type Point } from "./models";
import { results, resolutions } from "./learning-models";

export interface SummaryFilter {
  from: string | null;
  to: string | null;
  subjectId: string | null;
  chapterId: string | null;
}
export interface SummarySource {
  module: string | null;
  chapter: string | null;
  supplementPointIds: string[];
}
export interface StudySummary {
  filter: SummaryFilter;
  scope: string;
  timeZone: string;
  today: string;
  generatedAt: string;
  snapshotToken: string;
  stats: {
    minutes: number;
    sessions: number;
    importedRecords: number;
    reviewRecords: number;
    unmeasuredRecords: number;
    sharedSessions: number;
    recordedPoints: number;
    assessments: number;
    pass: number;
    independentPass: number;
    partial: number;
    fail: number;
    unassessedTests: number;
    newErrors: number;
    completedTasks: number;
    gradeChanges: number;
  };
  current: {
    points: number;
    archived: number;
    selfReported: number;
    evidence: number;
    distribution: Record<"UNASSESSED" | keyof typeof levels, number>;
    stages: Record<keyof typeof stages, number>;
    openErrors: number;
    pendingTasks: number;
    overdueTasks: number;
  };
  points: {
    id: string;
    name: string;
    chapter: string;
    subject: string;
    level: Point["masteryLevel"];
    basis: Point["masteryBasis"];
    stage: Point["learningStage"];
    archived: boolean;
    summary: string | null;
  }[];
  sessions: {
    id: string;
    day: string;
    minutes: number;
    content: string | null;
    pointIds: string[];
    pointNames: string[];
    shared: boolean;
    source?: SummarySource;
  }[];
  importedRecords: {
    id: string;
    day: string | null;
    pointIds: string[];
    pointNames: string[];
    content: string;
    source?: SummarySource;
  }[];
  assessments: {
    id: string;
    pointId: string;
    pointName: string;
    day: string;
    question: string;
    result: keyof typeof results;
    independentPass: boolean;
    independent: number | null;
    hintCount: number | null;
    answerViewed: number | null;
  }[];
  reviewRecords: {
    id: string;
    roundId: string;
    roundNumber: number;
    roundName: string;
    importId: string;
    day: string | null;
    title: string;
    pointIds: string[];
    pointNames: string[];
    content: string;
    shared: boolean;
  }[];
  errors: {
    id: string;
    pointId: string;
    pointName: string;
    day: string;
    question: string;
    status: keyof typeof resolutions;
    inPeriod: boolean;
  }[];
  tasks: {
    id: string;
    pointId: string;
    pointName: string;
    kind: string;
    dueOn: string;
    completedOn: string | null;
    status: string;
  }[];
  changes: {
    id: string;
    pointId: string;
    pointName: string;
    day: string;
    before: string;
    after: string;
    reason: string;
  }[];
  notes: string[];
}
const text = z.string().trim().min(1).max(2000);
export const summaryObservationSchema = z
  .object({
    text,
    evidenceIds: z.array(z.string().min(1).max(80)).min(1).max(10),
  })
  .strict();
export const summaryOutputSchema = z
  .object({
    overview: text,
    observations: z.array(summaryObservationSchema).max(160),
    recommendations: z
      .array(
        z
          .object({
            text,
            pointIds: z.array(z.uuid()).max(10),
          })
          .strict(),
      )
      .max(8),
    warnings: z.array(text).max(6),
  })
  .strict();
export type SummaryNarrative = z.infer<typeof summaryOutputSchema>;

export function summarySchemaFor(report: StudySummary) {
  const refs = [
    ...report.points.map((x) => `point:${x.id}`),
    ...summaryRecords(report).map((x) => x.ref),
    ...report.errors.map((x) => `error:${x.id}`),
    ...report.tasks.map((x) => `task:${x.id}`),
    ...report.changes.map((x) => `change:${x.id}`),
  ];
  // Use the actual scope as model output choices, in addition to validating
  // references afterwards. This avoids asking the model to copy arbitrary IDs.
  return summaryOutputSchema.extend({
    observations: z
      .array(
        summaryObservationSchema.extend({
          evidenceIds: z
            .array(z.enum(refs as [string, ...string[]]))
            .min(1)
            .max(10),
        }),
      )
      .max(160),
    recommendations: z
      .array(
        summaryOutputSchema.shape.recommendations.element.extend({
          pointIds: z
            .array(
              z.enum(report.points.map((x) => x.id) as [string, ...string[]]),
            )
            .max(10),
        }),
      )
      .max(8),
  });
}

export function summaryRecordTitle(row: {
  pointIds: string[];
  pointNames: string[];
  source?: SummarySource;
}) {
  const { source } = row;
  const supplement = source?.supplementPointIds.length;
  const name =
    supplement === row.pointIds.length
      ? row.pointNames.join("、")
      : source?.module || row.pointNames.join("、");
  return `${name}${supplement ? `（${source?.chapter}学习中的跨章节补充）` : ""}`;
}

export function summaryRecords(report: StudySummary) {
  return [
    ...report.sessions.map((x) => ({
      ref: `session:${x.id}`,
      day: x.day as string | null,
      title: summaryRecordTitle(x),
      pointIds: x.pointIds,
    })),
    ...report.importedRecords.map((x) => ({
      ref: `import:${x.id}`,
      day: x.day,
      title: summaryRecordTitle(x),
      pointIds: x.pointIds,
    })),
    ...report.assessments.map((x) => ({
      ref: `assessment:${x.id}`,
      day: x.day as string | null,
      title: `${x.pointName} · 复测`,
      pointIds: [x.pointId],
    })),
    ...report.reviewRecords.map((x) => ({
      ref: `round-review:${x.id}`,
      day: x.day,
      title: `第${x.roundNumber}轮 · ${x.title}`,
      pointIds: x.pointIds,
    })),
  ];
}

// A cross-day comparison or a point-only observation cannot replace the daily
// account of an actual learning record. This checks references, not semantics.
export function summaryCoverage(value: SummaryNarrative, report: StudySummary) {
  const records = summaryRecords(report);
  const days = new Map(records.map((x) => [x.ref, x.day]));
  const covered = new Set(
    value.observations.flatMap((x) =>
      x.evidenceIds.every((id) => days.has(id)) &&
      new Set(x.evidenceIds.map((id) => days.get(id))).size === 1
        ? x.evidenceIds
        : [],
    ),
  );
  const entries = records.map((x) => ({ ...x, covered: covered.has(x.ref) }));
  return {
    total: entries.length,
    covered: entries.filter((x) => x.covered).length,
    missing: entries.filter((x) => !x.covered),
    entries,
  };
}

export function summaryDays(report: StudySummary) {
  return [
    ...new Set(
      [
        ...report.sessions,
        ...report.importedRecords,
        ...report.assessments,
        ...report.reviewRecords,
      ].map((x) => x.day),
    ),
  ].sort((a, b) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)));
}

export function summaryMarkdown(report: StudySummary) {
  const { stats: s, current: c } = report;
  const daily = summaryDays(report).flatMap((day) => [
    `### ${day || "学习日期未登记"}`,
    "",
    ...report.sessions
      .filter((x) => x.day === day)
      .map(
        (x) =>
          `- 学习日志 · ${x.minutes} 分钟 · ${x.pointNames.join("、")}：${x.content || "未填写学习内容"}${x.shared ? "（跨范围日志，时间未拆分）" : ""}`,
      ),
    ...report.importedRecords
      .filter((x) => x.day === day)
      .map(
        (x) =>
          `- 原文录入（本人确认） · ${summaryRecordTitle(x)} · 用时未登记：\n${x.content}\n  原文与确认历史：/imports?id=${x.id}`,
      ),
    ...report.assessments
      .filter((x) => x.day === day)
      .map(
        (x) =>
          `- 复测 · ${x.pointName} · ${results[x.result]}${x.independentPass ? "（明确独立通过）" : "（独立通过未确认）"}：${x.question}`,
      ),
    ...report.reviewRecords
      .filter((x) => x.day === day)
      .map(
        (x) =>
          `- 第${x.roundNumber}轮综合评估 · ${x.title}${x.shared ? "（跨章节任务，保留完整上下文）" : ""}：\n${x.content}\n  原文与本轮对照：/rounds?roundId=${x.roundId}&draftId=${x.importId}`,
      ),
    "",
  ]);
  const lines = [
    "# 学习总结",
    "",
    `范围：${report.scope}`,
    `日期：${report.filter.from || "不限起始"} 至 ${report.filter.to || "不限结束"}（${report.timeZone}）`,
    `生成时间：${report.generatedAt}`,
    "",
    "## 所选时段的实际记录",
    "",
    `- 有效学习日志 ${s.sessions} 条，已登记用时 ${s.minutes} 分钟；另有已确认内容记录 ${s.importedRecords} 条，未登记用时 ${s.unmeasuredRecords} 条。有记录的知识点 ${s.recordedPoints} 个。`,
    `- 复测 ${s.assessments} 次：通过 ${s.pass}、部分完成 ${s.partial}、未通过 ${s.fail}、尚未判定 ${s.unassessedTests}；其中明确独立通过 ${s.independentPass} 次。`,
    `- 新增错误 ${s.newErrors} 条；完成任务 ${s.completedTasks} 项；等级或评估状态调整 ${s.gradeChanges} 次。`,
    `- 另有综合评估 ${s.reviewRecords} 条，按整体任务计数；每项可关联多个章节，不计作正式独立复测通过。`,
    "",
    "## 当前状态（截至生成时，不代表期末状态）",
    "",
    `- 目录知识点 ${c.points} 个，其中归档 ${c.archived} 个。`,
    `- 暂未评估 ${c.distribution.UNASSESSED} 个；${Object.keys(levels)
      .map((k) => `${k} ${c.distribution[k as keyof typeof levels]} 个`)
      .join("、")}。`,
    `- 用户自评 ${c.selfReported} 个；复测证据确认 ${c.evidence} 个。`,
    `- 当前待处理错误 ${c.openErrors} 条；待办 ${c.pendingTasks} 项，其中逾期 ${c.overdueTasks} 项。`,
    "",
    "## 按学习日期整理",
    "",
    ...daily,
    ...(!report.sessions.length &&
    !report.importedRecords.length &&
    !report.reviewRecords.length
      ? ["本范围暂无有效学习日志，不能仅凭目录或自评认定已完成学习。"]
      : []),
    "",
    ...(!report.assessments.length
      ? [
          "本范围未单独登记结构化复测；学习原文中的作答表现需另行核对，不能据此认定从未独立作答，也不能确认整章掌握。",
        ]
      : []),
    "",
    "## 当前知识点状态",
    "",
    ...report.points.map(
      (x) =>
        `- ${x.subject} / ${x.chapter} / ${x.name}${x.archived ? "（归档）" : ""}：${x.basis === "UNASSESSED" ? bases.UNASSESSED : `${x.level} · ${levels[x.level]}（${bases[x.basis]}）`}；${stages[x.stage]}${x.summary ? `\n  当前摘要（非本期完成证明）：${x.summary}` : ""}`,
    ),
    "",
    "## 错误与后续安排",
    "",
    ...report.errors.map(
      (x) =>
        `- ${x.pointName}：${x.question}；当前${resolutions[x.status]}${x.inPeriod ? "；本期记录" : "；较早记录"}`,
    ),
    ...report.tasks
      .filter((x) => x.status === "PENDING")
      .map((x) => `- 待办 ${x.dueOn} · ${x.pointName}`),
    "",
    "## 等级与评估状态变化",
    "",
    ...report.changes.map(
      (x) =>
        `- ${x.day} · ${x.pointName}：${x.before} → ${x.after}；${x.reason}`,
    ),
    "",
    "## 统计说明",
    "",
    ...report.notes.map((x) => `- ${x}`),
  ];
  return lines.join("\n");
}
export function narrativeMarkdown(
  value: SummaryNarrative,
  report?: StudySummary,
) {
  const referenceDays = new Map<string, string | null>();
  if (report) {
    for (const [prefix, rows] of [
      ["session", report.sessions],
      ["import", report.importedRecords],
      ["assessment", report.assessments],
      ["round-review", report.reviewRecords],
      ["error", report.errors],
      ["change", report.changes],
    ] as const)
      for (const row of rows) referenceDays.set(`${prefix}:${row.id}`, row.day);
  }
  const groups = new Map<string, string[]>();
  for (const x of value.observations) {
    const dates = x.evidenceIds.map((id) => referenceDays.get(id));
    const key =
      report &&
      dates.every((day) => day !== undefined) &&
      new Set(dates).size === 1
        ? dates[0] || "学习日期未登记"
        : "整体观察与当前状态";
    groups.set(key, [
      ...(groups.get(key) || []),
      `- ${x.text}\n  依据：${x.evidenceIds.join("、")}`,
    ]);
  }
  const order = (key: string) =>
    key === "整体观察与当前状态" ? 2 : key === "学习日期未登记" ? 1 : 0;
  const observations = [...groups.keys()]
    .sort((a, b) => order(a) - order(b) || b.localeCompare(a))
    .flatMap((key) => [`### ${key}`, "", ...groups.get(key)!, ""]);
  return [
    "## GPT 总结草稿（请核对）",
    "",
    value.overview,
    "",
    ...observations,
    "",
    "### 后续建议（尚未执行）",
    "",
    ...value.recommendations.map((x) => `- ${x.text}`),
    "",
    ...value.warnings.map((x) => `- 注意：${x}`),
    "",
    ...(report ? coverageMarkdown(value, report) : []),
  ].join("\n");
}

function coverageMarkdown(value: SummaryNarrative, report: StudySummary) {
  const coverage = summaryCoverage(value, report);
  const cell = (text: string) =>
    text.replaceAll("|", "\\|").replace(/\s+/g, " ");
  return [
    "### 记录覆盖核对",
    "",
    `按日期整理的观察已引用 ${coverage.covered}/${coverage.total} 条学习或复测记录。这里只核对引用是否覆盖，仍需检查各专题的实际内容与判断。`,
    ...(coverage.missing.length
      ? [
          "草稿仍有未展开的记录，不能视为完整总结；以下已列出，原始内容保留在事实汇总中。",
        ]
      : []),
    "",
    "| 学习日期 | 学习内容 / 专题 | 草稿引用 |",
    "| --- | --- | --- |",
    ...coverage.entries.map(
      (x) =>
        `| ${x.day || "未登记"} | ${cell(x.title)} | ${x.covered ? "已引用，内容待核对" : "未展开"} |`,
    ),
    ...(!coverage.total
      ? ["本范围没有学习或复测记录，只能说明当前状态与证据局限。"]
      : []),
    "",
  ];
}
