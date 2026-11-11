import { bases, levels, type Level } from "@/lib/models";
export function LevelBadge({
  level,
  unassessed = false,
}: {
  level: Level;
  unassessed?: boolean;
}) {
  return (
    <span className={`level-badge level-${unassessed ? "unassessed" : level}`}>
      {!unassessed && <b>{level}</b>}
      <span>{unassessed ? bases.UNASSESSED : levels[level]}</span>
    </span>
  );
}
