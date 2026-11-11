CREATE TABLE study_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  number INTEGER NOT NULL CHECK(number >= 2),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  objective TEXT NOT NULL,
  started_on TEXT NOT NULL,
  baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),
  created_at TEXT NOT NULL,
  UNIQUE(subject_id, number)
) STRICT;
CREATE TRIGGER study_rounds_immutable BEFORE UPDATE ON study_rounds
BEGIN SELECT RAISE(ABORT, 'round baseline is immutable'); END;
CREATE TRIGGER study_rounds_no_delete BEFORE DELETE ON study_rounds
BEGIN SELECT RAISE(ABORT, 'round history is retained'); END;

CREATE TABLE _round_imports (
  id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL REFERENCES study_rounds(id),
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','READY','FAILED','APPLIED','DISCARDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  worker_pid INTEGER NOT NULL,
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  applied_json TEXT CHECK(applied_json IS NULL OR json_valid(applied_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER round_imports_source_immutable BEFORE UPDATE ON _round_imports
WHEN NEW.id <> OLD.id OR NEW.round_id <> OLD.round_id OR NEW.input_hash <> OLD.input_hash
  OR NEW.input_json <> OLD.input_json OR NEW.context_json <> OLD.context_json OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'round source and context are immutable'); END;
CREATE TRIGGER round_imports_no_delete BEFORE DELETE ON _round_imports
BEGIN SELECT RAISE(ABORT, 'round import history is retained'); END;

CREATE TABLE round_review_records (
  id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL REFERENCES study_rounds(id),
  import_id TEXT NOT NULL REFERENCES _round_imports(id),
  item_id TEXT NOT NULL,
  learning_date TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  quote TEXT NOT NULL,
  evaluation_json TEXT NOT NULL CHECK(json_valid(evaluation_json)),
  created_at TEXT NOT NULL,
  UNIQUE(import_id, item_id)
) STRICT;
CREATE INDEX round_records_recent ON round_review_records(round_id, learning_date, created_at);
CREATE TABLE round_review_points (
  record_id TEXT NOT NULL REFERENCES round_review_records(id),
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id),
  PRIMARY KEY(record_id, knowledge_point_id)
) STRICT;
CREATE INDEX round_points_lookup ON round_review_points(knowledge_point_id, record_id);
CREATE TRIGGER round_records_no_update BEFORE UPDATE ON round_review_records
BEGIN SELECT RAISE(ABORT, 'round evaluations are append-only'); END;
CREATE TRIGGER round_records_no_delete BEFORE DELETE ON round_review_records
BEGIN SELECT RAISE(ABORT, 'round evaluations are append-only'); END;
CREATE TRIGGER round_points_no_update BEFORE UPDATE ON round_review_points
BEGIN SELECT RAISE(ABORT, 'round evaluation links are immutable'); END;
CREATE TRIGGER round_points_no_delete BEFORE DELETE ON round_review_points
BEGIN SELECT RAISE(ABORT, 'round evaluation links are immutable'); END;
