import { listedLevels } from "./import-candidates";
import type { LevelSuggestion, ReportedLevel } from "./import-models";

// Read explicit labelled levels, never derive mastery from performance or a rubric.
export function explicitLevel(text: string): ReportedLevel | null {
  const values = [
    ...text.matchAll(
      /^[\t ]*(?:[-*>]\s*)?(?:\*\*)?(?:(?:建议|评估|掌握|自评)(?:掌握)?)?(?:等级|级别)(?:\*\*)?\s*[：:]\s*(?:\*\*)?(尚未评估|暂未评估|未评估|[A-E])(?![A-Za-z])(?![\t ]*(?:级[\t ]*)?(?:[/／、或及到至~～—–-]|与)[\t ]*[A-E])/gm,
    ),
  ].map((m) => (m[1].endsWith("评估") ? "UNASSESSED" : m[1]));
  return values.length && new Set(values).size === 1
    ? (values[0] as ReportedLevel)
    : null;
}

export function sourceReportedLevel(
  text: string,
  item: { name: string; quote: string },
): LevelSuggestion | null {
  const listed = listedLevels(text).filter(
    (x) =>
      x.name.replace(/[\s\p{P}]/gu, "") ===
      item.name.replace(/[\s\p{P}]/gu, ""),
  );
  if (listed.length === 1)
    return { level: listed[0].level, quote: listed[0].quote };
  if (listed.length > 1) return null;
  const numbered = [
    ...text.matchAll(/^[\t ]*(?:#{1,6}\s+)?\d+[.．、]\s*([^\n]+)$/gm),
  ];
  // Parenthesized formula numbering inside a knowledge point is not a new point.
  const headings = numbered.length
    ? numbered
    : [
        ...text.matchAll(
          /^[\t ]*(?:#{1,6}\s+)?(?:\d+[)）]\s*|[（(]\d+[)）]\s*)([^\n]+)$/gm,
        ),
      ];
  const normalize = (value: string) => value.replace(/[\s\p{P}]/gu, "");
  const blocks = headings.length
    ? headings.map((h, i) => ({
        title: h[1],
        text: text.slice(h.index, headings[i + 1]?.index ?? text.length),
      }))
    : [{ title: "", text }];
  const exact = blocks.filter(
    (b) => normalize(b.title) === normalize(item.name),
  );
  const candidates = exact.length
    ? exact
    : blocks.filter(
        (b) => item.quote.length >= 6 && b.text.includes(item.quote),
      );
  if (candidates.length !== 1) return null;
  const block = candidates[0].text;
  const level = explicitLevel(block);
  if (!level) return null;
  const line = block.split("\n").find((line) => explicitLevel(line) === level);
  // A parent C and a separate sub-skill B must not become one inherited grade.
  if (
    line &&
    /[；;].*建议\s*[A-E](?![A-Za-z])/.test(line) &&
    normalize(candidates[0].title) !== normalize(item.name)
  )
    return null;
  return line ? { level, quote: line.trim() } : null;
}

export function levelConfirmationReason(
  suggestion: LevelSuggestion | null | undefined,
) {
  return suggestion
    ? `本人确认采用上传原文的等级建议：${suggestion.quote}`.slice(0, 1000)
    : "";
}
