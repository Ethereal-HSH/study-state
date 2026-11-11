-- Add concurrency and request/audit infrastructure without changing learning facts.
ALTER TABLE subjects ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1);
ALTER TABLE chapters ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1);
CREATE TABLE _command_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE _catalog_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('subject','chapter')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','ARCHIVE')),
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER catalog_events_no_update BEFORE UPDATE ON _catalog_events BEGIN SELECT RAISE(ABORT, 'catalog events are append-only'); END;
CREATE TRIGGER catalog_events_no_delete BEFORE DELETE ON _catalog_events BEGIN SELECT RAISE(ABORT, 'catalog events are append-only'); END;
