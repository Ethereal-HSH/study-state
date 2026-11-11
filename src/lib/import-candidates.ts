import type { LevelSuggestion } from "./import-models";

// Candidates require human association when the source title differs from the point.
export function listedLevels(
  text: string,
): (LevelSuggestion & { name: string })[] {
  let inLevels = false;
  const result: (LevelSuggestion & { name: string })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\*\*/g, "");
    if (/^(?:#{1,6}\s*)?[一二三四五六七八九十]+[、.．]/.test(line))
      inLevels = /(?:建议|评估|掌握|自评)等级/.test(line);
    if (
      /^(?:#{1,6}\s*)?(?:建议|评估|掌握|自评)等级(?:与[^：:]*)?[：:]?$/.test(
        line,
      )
    )
      inLevels = true;
    if (!inLevels) continue;
    const m = line.match(
      /^\d+[.．、)）]\s*(.{2,100}?)[：:]\s*(暂未评估|尚未评估|未评估|[A-E])(?![A-Za-z])(.*)$/,
    );
    if (
      !m ||
      /[/／、或及到至~～—–-]\s*[A-E]|(?:建议|等级|主要为)\s*[A-E]/.test(m[3])
    )
      continue;
    result.push({
      name: m[1],
      level: m[2].endsWith("评估")
        ? "UNASSESSED"
        : (m[2] as LevelSuggestion["level"]),
      quote: raw.trim(),
    });
  }
  return result;
}
