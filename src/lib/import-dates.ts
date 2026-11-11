import { validDay } from "./review-policy";
export type DateCandidate = {
  day: string;
  kind: "学习日期" | "记录日期" | "对话日期";
  quote: string;
};
export function sourceDateCandidates(text: string): DateCandidate[] {
  const result: DateCandidate[] = [];
  for (const raw of text.split("\n")) {
    const line = raw
      .trim()
      .replace(/\*\*/g, "")
      .replace(/^[-#>]\s*/, "");
    const label = line.match(
      /^((?:实际)?学习(?:日期|时间)|记录日期|日期|对话(?:节点|时间))[：:]\s*(.*)$/,
    );
    if (!label) continue;
    const kind = label[1].includes("学习")
      ? "学习日期"
      : label[1].includes("对话")
        ? "对话日期"
        : "记录日期";
    const matches = [
      ...label[2].matchAll(
        /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?!\d)(?:日)?/g,
      ),
    ];
    for (const m of matches) {
      const day = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      if (
        validDay(day) &&
        !result.some((x) => x.day === day && x.kind === kind)
      )
        result.push({ day, kind, quote: raw.trim() });
    }
  }
  return result;
}
export function sourceLearningDate(text: string): string | null {
  const dates = sourceDateCandidates(text).filter((x) => x.kind === "学习日期");
  const days = [...new Set(dates.map((x) => x.day))];
  // A shortened range is still multi-day; never silently choose its first day.
  if (
    dates.some((x) => /日?\s*(?:至|到|—|～|~)\s*\d{1,2}(?:月|日)/.test(x.quote))
  )
    return null;
  return days.length === 1 ? days[0] : null;
}
