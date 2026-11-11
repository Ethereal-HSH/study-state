-- Source uploads and reviewed proposals are separate from learning evidence.
CREATE TABLE _ai_imports (
  id TEXT PRIMARY KEY NOT NULL,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','READY','FAILED','APPLIED','DISCARDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  worker_pid INTEGER NOT NULL,
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  applied_json TEXT CHECK(applied_json IS NULL OR json_valid(applied_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
) STRICT;
CREATE INDEX ai_imports_recent ON _ai_imports(created_at DESC);
CREATE TRIGGER ai_imports_source_immutable BEFORE UPDATE ON _ai_imports
WHEN NEW.id <> OLD.id OR NEW.input_hash <> OLD.input_hash OR NEW.input_json <> OLD.input_json
  OR NEW.context_json <> OLD.context_json OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'import source and context are immutable'); END;
CREATE TRIGGER ai_imports_no_delete BEFORE DELETE ON _ai_imports
BEGIN SELECT RAISE(ABORT, 'import history is retained'); END;
