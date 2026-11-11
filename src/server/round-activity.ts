import { type Store } from "./db/client";

// A dated confirmed learning task is activity, not a formal test pass. A task
// explicitly untested this round must not erase earlier evidence or count as practice.
export function roundActivityFor(pointId: string, store: Store) {
  return store.raw
    .prepare(
      "SELECT r.id,r.learning_date day,json_extract(r.evaluation_json,'$.performance') performance FROM round_review_records r JOIN round_review_points p ON p.record_id=r.id WHERE p.knowledge_point_id=? AND r.learning_date IS NOT NULL AND json_extract(r.evaluation_json,'$.performance')<>'UNTESTED' ORDER BY r.learning_date DESC,r.created_at DESC",
    )
    .all(pointId) as { id: string; day: string; performance: string }[];
}
