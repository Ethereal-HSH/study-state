import type { Level } from "./models";
import type { TaskKind } from "./review-models";
export const reviewRuleVersion = "review-v1";
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function addDays(day: string, days: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
}
export function reviewAdvice(input: {
  level: Level;
  today: string;
  anchorDay: string | null;
  forgetting: boolean;
  test: {
    result: string;
    independent: number | null;
    hint_count: number | null;
    answer_viewed: number | null;
  } | null;
  useTest: boolean;
}): { kind: TaskKind; dueOn: string | null; reason: string } {
  const kind =
    input.level === "A"
      ? "LEARN"
      : input.level === "E"
        ? "SPOT_CHECK"
        : "REVIEW";
  if (input.forgetting)
    return {
      kind: "REVIEW",
      dueOn: input.today,
      reason: "已标记疑似遗忘，建议今天复测。",
    };
  let interval: number;
  let reason: string;
  const t = input.useTest ? input.test : null;
  if (
    t &&
    (["FAIL", "PARTIAL"].includes(t.result) ||
      (t.result === "PASS" &&
        (t.independent === 0 ||
          (t.hint_count ?? 0) > 0 ||
          t.answer_viewed === 1)))
  ) {
    interval = 1;
    reason = "最近测试未完全通过或依赖提示/答案，建议活动后 1 天复测。";
  } else if (
    t &&
    (t.result === "UNASSESSED" ||
      t.independent === null ||
      t.hint_count === null ||
      t.answer_viewed === null)
  ) {
    return {
      kind,
      dueOn: null,
      reason:
        "最近测试结果或独立性证据尚不完整，请手动选日期；已有安排保持不变。",
    };
  } else if (input.level === "A" || !input.anchorDay) {
    return {
      kind,
      dueOn: null,
      reason:
        input.level === "A"
          ? "先安排下一次学习，请选择适合自己的日期。"
          : "尚无有效学习或测试日期，请手动安排。",
    };
  } else {
    interval = { B: 2, C: 5, D: 14, E: 30 }[input.level];
    reason = `当前 ${input.level} 级，建议活动后 ${interval} 天${input.level === "E" ? "抽查" : "复测"}。`;
  }
  const proposed = addDays(input.anchorDay || input.today, interval);
  return {
    kind: interval === 1 ? "REVIEW" : kind,
    dueOn: proposed < input.today ? input.today : proposed,
    reason:
      reason +
      (proposed < input.today ? " 依据较早记录推导，日期已调整为今天。" : ""),
  };
}
