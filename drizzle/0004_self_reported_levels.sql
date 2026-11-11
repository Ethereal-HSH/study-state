-- @requires-foreign-keys-off
-- Rebuild only the point table to permit self-reported E, retaining every row.
-- The runner backs up first and checks all foreign keys before committing.
CREATE TABLE knowledge_points_new (
  id TEXT PRIMARY KEY NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  description TEXT,
  importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  sort_order INTEGER NOT NULL DEFAULT 0,
  mastery_level TEXT NOT NULL DEFAULT 'A' CHECK(mastery_level IN ('A','B','C','D','E')),
  mastery_basis TEXT NOT NULL DEFAULT 'UNASSESSED'
    CHECK(mastery_basis IN ('UNASSESSED','SELF_REPORTED','EVIDENCE')),
  learning_stage TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK(learning_stage IN ('NOT_STARTED','IN_PROGRESS','COVERED')),
  suspected_forgetting INTEGER NOT NULL DEFAULT 0 CHECK(suspected_forgetting IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  ai_summary TEXT,
  summary_source TEXT CHECK(summary_source IN ('MANUAL','AI_PASTED')),
  summary_updated_at TEXT,
  summary_based_on_version INTEGER CHECK(summary_based_on_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK(mastery_basis <> 'UNASSESSED' OR mastery_level = 'A'),
  CHECK(summary_based_on_version IS NULL OR summary_based_on_version <= version),
  CHECK((ai_summary IS NULL AND summary_source IS NULL AND summary_updated_at IS NULL AND summary_based_on_version IS NULL)
     OR (ai_summary IS NOT NULL AND summary_source IS NOT NULL AND summary_updated_at IS NOT NULL AND summary_based_on_version IS NOT NULL))
) STRICT;
INSERT INTO knowledge_points_new SELECT * FROM knowledge_points;
DROP TABLE knowledge_points;
ALTER TABLE knowledge_points_new RENAME TO knowledge_points;
CREATE INDEX points_chapter ON knowledge_points(chapter_id, sort_order);
CREATE UNIQUE INDEX points_active_name ON knowledge_points(chapter_id, name) WHERE archived_at IS NULL;
