// Match literal source text, allowing only whitespace layout differences.
// Return the original span; never manufacture a citation by paraphrasing,
// joining separated passages, replacing symbols, or fuzzy topic matching.
export function resolveSourceQuote(
  source: string,
  candidate: string,
): string | null {
  if (!candidate.trim() || candidate.length > 2000) return null;
  if (source.includes(candidate)) return candidate;
  const needle = candidate.replace(/\s/gu, "");
  if (!needle) return null;
  const characters: string[] = [],
    positions: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (/\s/u.test(source[i])) continue;
    characters.push(source[i]);
    positions.push(i);
  }
  const index = characters.join("").indexOf(needle);
  if (index < 0) return null;
  const original = source.slice(
    positions[index],
    positions[index + needle.length - 1] + 1,
  );
  return original.length <= 2000 ? original : null;
}
