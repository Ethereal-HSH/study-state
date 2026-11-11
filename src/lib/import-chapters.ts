type Chapter = { id: string; name: string };
const numerals = "零一二三四五六七八九";
function chapterNumber(value: string): number | null {
  const normalized = value
    .normalize("NFKC")
    .replaceAll("〇", "零")
    .replaceAll("两", "二");
  if (/^\d+$/.test(normalized)) {
    const n = Number(normalized);
    return n > 0 && n < 1000 ? n : null;
  }
  if (!/^[零一二三四五六七八九十百]+$/.test(normalized)) return null;
  if (!/[十百]/.test(normalized)) {
    const n = Number([...normalized].map((c) => numerals.indexOf(c)).join(""));
    return n > 0 && n < 1000 ? n : null;
  }
  let total = 0,
    digit = 0;
  for (const c of normalized) {
    if (c === "十" || c === "百") {
      total += (digit || 1) * (c === "十" ? 10 : 100);
      digit = 0;
    } else digit = numerals.indexOf(c);
  }
  return total + digit > 0 ? total + digit : null;
}
function chineseNumber(n: number): string {
  if (n < 10) return numerals[n];
  if (n < 100)
    return (
      (n < 20 ? "" : numerals[Math.floor(n / 10)]) +
      "十" +
      (n % 10 ? numerals[n % 10] : "")
    );
  const rest = n % 100;
  return (
    numerals[Math.floor(n / 100)] +
    "百" +
    (rest
      ? (rest < 10 ? "零" : rest < 20 ? "一" : "") + chineseNumber(rest)
      : "")
  );
}
const chapterPattern = /第\s*([0-9０-９零〇一二三四五六七八九十百两]+)\s*章/g;
export function chapterKey(name: string): number | null {
  const m = /^第\s*([0-9０-９零〇一二三四五六七八九十百两]+)\s*章/.exec(
    name.trim(),
  );
  return m ? chapterNumber(m[1]) : null;
}
export function sourceChapter(
  text: string,
): { name: string; key: number; quote: string } | null {
  const found: { key: number; quote: string }[] = [];
  // Only header metadata identifies the current chapter. Examples, prerequisites
  // and next-module plans in the body must not silently choose a destination.
  for (const raw of text.split("\n").slice(0, 30)) {
    const line = raw
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .replaceAll("**", "");
    if (
      /^[一二三四五六七八九十]+[、.．]/.test(line) ||
      /^\d+[.、]\s/.test(line)
    )
      break;
    const label =
      /^(?:(?:主要|本次|本模块)?依据|章节|所属章节|当前章节|学习章节|教材范围|课件范围|学习范围|材料来源)\s*[：:]\s*(.+)$/.exec(
        line,
      );
    if (!label && !/^第[0-9０-９零〇一二三四五六七八九十百两\s]+章/.test(line))
      continue;
    const value = label?.[1] || line;
    if (/计划|预习|下一|后续|将学习|尚未学习|未开始/.test(value)) continue;
    if (
      /章\s*(?:至|到|[～~—–-])\s*[0-9０-９零〇一二三四五六七八九十百两]+\s*章/.test(
        value,
      )
    )
      continue;
    for (const m of value.matchAll(chapterPattern)) {
      const key = chapterNumber(m[1]);
      if (key) found.push({ key, quote: raw.trim() });
    }
  }
  const keys = [...new Set(found.map((x) => x.key))];
  return keys.length === 1
    ? {
        name: `第${chineseNumber(keys[0])}章`,
        key: keys[0],
        quote: found[0].quote,
      }
    : null;
}
export function sourceChapterMatches<T extends Chapter>(
  text: string,
  chapters: T[],
) {
  const hint = sourceChapter(text);
  return {
    hint,
    matches: hint
      ? chapters.filter((c) => chapterKey(c.name) === hint.key)
      : [],
  };
}
