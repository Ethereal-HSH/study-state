import { bases, levels, stages } from "@/lib/models";
import Link from "next/link";
import { taskKinds, taskStatuses } from "@/lib/review-models";
import {
  results,
  taskTypes,
  resolutions,
  causeStatuses,
  errorTypes,
} from "@/lib/learning-models";
const fields: Record<string, string> = {
  name: "名称",
  description: "说明",
  importance: "重要性",
  masteryLevel: "掌握等级",
  masteryBasis: "状态依据",
  adjustmentMode: "调整方式",
  learningStage: "学习进度",
  suspectedForgetting: "疑似遗忘",
  aiSummary: "学习摘要",
  summarySource: "摘要来源",
  archivedAt: "归档状态",
  durationMinutes: "学习分钟",
  content: "学习内容",
  question: "测试内容",
  response: "实际作答",
  result: "测试结果",
  independent: "独立完成",
  hintCount: "提示次数",
  answerViewed: "查看答案",
  taskType: "任务类型",
  isNew: "新题",
  canExplain: "能否解释",
  errorType: "错误类型",
  causeStatus: "错因依据",
  cause: "错因",
  correction: "订正",
  resolutionStatus: "错误解决状态",
  voided: "作废",
  reason: "原因",
  outcome: "针对本错误的复测结果",
  kind: "安排类型",
  dueOn: "计划日期",
  status: "任务状态",
  completedAt: "完成时间",
  completedAssessmentId: "完成依据（测试 ID）",
  completedSessionId: "完成依据（日志 ID）",
  cancelReason: "取消原因",
  quote: "原文摘录",
  learningDate: "学习日期",
};
function display(key: string, value: unknown, basis?: unknown): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (key === "masteryLevel")
    return basis === "UNASSESSED"
      ? bases.UNASSESSED
      : `${value} · ${levels[value as keyof typeof levels] || ""}`;
  if (key === "kind")
    return taskKinds[value as keyof typeof taskKinds] || String(value);
  if (key === "status")
    return taskStatuses[value as keyof typeof taskStatuses] || String(value);
  if (key === "masteryBasis")
    return bases[value as keyof typeof bases] || String(value);
  if (key === "adjustmentMode")
    return value === "SELF_REPORTED" ? "手动自评" : "复测确认";
  if (key === "learningStage")
    return stages[value as keyof typeof stages] || String(value);
  if (key === "suspectedForgetting") return value ? "是" : "否";
  if (key === "summarySource")
    return value === "AI_PASTED" ? "AI 文本（本人确认）" : "本人整理";
  if (key === "archivedAt") return "已归档";
  if (
    ["independent", "answerViewed", "isNew", "canExplain", "voided"].includes(
      key,
    )
  )
    return value ? "是" : "否";
  if (key === "result" || key === "outcome")
    return results[value as keyof typeof results] || String(value);
  if (key === "taskType")
    return taskTypes[value as keyof typeof taskTypes] || String(value);
  if (key === "resolutionStatus")
    return resolutions[value as keyof typeof resolutions] || String(value);
  if (key === "causeStatus")
    return causeStatuses[value as keyof typeof causeStatuses] || String(value);
  if (key === "errorType")
    return errorTypes[value as keyof typeof errorTypes] || String(value);
  return String(value);
}
export function EventChanges({
  beforeJson,
  afterJson,
}: {
  beforeJson: string | null;
  afterJson: string | null;
}) {
  const rawBefore: Record<string, unknown> = beforeJson
    ? JSON.parse(beforeJson)
    : {};
  const rawAfter: Record<string, unknown> = afterJson
    ? JSON.parse(afterJson)
    : {};
  const normalize = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
        value,
      ]),
    );
  const before = normalize(rawBefore),
    after = normalize(rawAfter);
  const changed = Object.keys(fields).filter(
    (key) =>
      Object.hasOwn(after, key) &&
      (before[key] !== after[key] ||
        (key === "masteryLevel" &&
          (before.masteryBasis === "UNASSESSED") !==
            (after.masteryBasis === "UNASSESSED"))),
  );
  return (
    <dl className="event-changes">
      {typeof after.importId === "string" &&
        /^[0-9a-f-]{36}$/i.test(after.importId) && (
          <div>
            <dt>录入来源</dt>
            <dd>
              <Link href={`/imports?id=${after.importId}`}>
                查看原文与整理历史
              </Link>
            </dd>
          </div>
        )}
      {changed.length ? (
        changed.map((key) => (
          <div key={key}>
            <dt>{fields[key]}</dt>
            <dd>
              {beforeJson && (
                <span className="previous-value">
                  {key === "archivedAt" && !before[key]
                    ? "未归档"
                    : display(key, before[key], before.masteryBasis)}
                  <span aria-hidden="true"> → </span>
                </span>
              )}
              <span>{display(key, after[key], after.masteryBasis)}</span>
            </dd>
          </div>
        ))
      ) : (
        <p>内容已确认并保存，状态值未发生变化。</p>
      )}
    </dl>
  );
}
