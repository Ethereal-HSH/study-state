-- Design v0.1, SQLite. Reference DDL, not a deployed migration.
-- IDs: application-generated UUID. Timestamps: normalized UTC ISO-8601.
-- Enable foreign keys on EVERY application connection before transactions.
PRAGMA foreign_keys = ON;

CREATE TABLE subjects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;
CREATE UNIQUE INDEX subjects_active_name ON subjects(name) WHERE archived_at IS NULL;

CREATE TABLE chapters (
  id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;
CREATE INDEX chapters_subject ON chapters(subject_id, sort_order);
CREATE UNIQUE INDEX chapters_active_name ON chapters(subject_id, name) WHERE archived_at IS NULL;

CREATE TABLE knowledge_points (
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
  CHECK(mastery_level <> 'E' OR mastery_basis = 'EVIDENCE'),
  CHECK(summary_based_on_version IS NULL OR summary_based_on_version <= version),
  CHECK((ai_summary IS NULL AND summary_source IS NULL AND summary_updated_at IS NULL AND summary_based_on_version IS NULL)
     OR (ai_summary IS NOT NULL AND summary_source IS NOT NULL AND summary_updated_at IS NOT NULL AND summary_based_on_version IS NOT NULL))
) STRICT;
CREATE INDEX points_chapter ON knowledge_points(chapter_id, sort_order);
CREATE UNIQUE INDEX points_active_name ON knowledge_points(chapter_id, name) WHERE archived_at IS NULL;

CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
  content TEXT,
  raw_note TEXT,
  ai_summary TEXT,
  summary_source TEXT CHECK(summary_source IN ('MANUAL','AI_PASTED')),
  summary_updated_at TEXT,
  summary_based_on_version INTEGER CHECK(summary_based_on_version >= 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  CHECK(ended_at > started_at),
  CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0)),
  CHECK(summary_based_on_version IS NULL OR summary_based_on_version <= version),
  CHECK((ai_summary IS NULL AND summary_source IS NULL AND summary_updated_at IS NULL AND summary_based_on_version IS NULL)
     OR (ai_summary IS NOT NULL AND summary_source IS NOT NULL AND summary_updated_at IS NOT NULL AND summary_based_on_version IS NOT NULL))
) STRICT;
CREATE INDEX sessions_date ON study_sessions(started_at);
CREATE INDEX sessions_subject ON study_sessions(subject_id, started_at);

CREATE TABLE study_session_points (
  session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE RESTRICT,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
  activity_type TEXT NOT NULL CHECK(activity_type IN ('LEARN','REVIEW','TEST')),
  note TEXT,
  PRIMARY KEY(session_id, knowledge_point_id, activity_type)
) STRICT;
CREATE INDEX session_points_point ON study_session_points(knowledge_point_id, session_id);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
  session_id TEXT REFERENCES study_sessions(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  question_ref TEXT,
  question_description TEXT NOT NULL CHECK(length(trim(question_description)) > 0),
  response_excerpt TEXT,
  result TEXT NOT NULL CHECK(result IN ('PASS','PARTIAL','FAIL','UNASSESSED')),
  independent INTEGER CHECK(independent IN (0,1)),
  hint_count INTEGER CHECK(hint_count >= 0),
  answer_viewed INTEGER CHECK(answer_viewed IN (0,1)),
  task_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(task_type IN ('CONCEPT','TYPICAL','VARIANT','TRANSFER','UNKNOWN')),
  difficulty TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(difficulty IN ('EASY','STANDARD','HARD','UNKNOWN')),
  is_new_question INTEGER CHECK(is_new_question IN (0,1)),
  can_explain INTEGER CHECK(can_explain IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  UNIQUE(id, knowledge_point_id),
  CHECK(independent IS NOT 1 OR ((hint_count IS NULL OR hint_count = 0) AND (answer_viewed IS NULL OR answer_viewed = 0))),
  CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
) STRICT;
CREATE INDEX assessments_point_time ON assessments(knowledge_point_id, occurred_at);
CREATE INDEX assessments_session ON assessments(session_id);

CREATE TABLE error_records (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
  assessment_id TEXT,
  occurred_at TEXT NOT NULL,
  question_description TEXT NOT NULL CHECK(length(trim(question_description)) > 0),
  error_type TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(error_type IN ('CONCEPT','CONDITION','METHOD','MODELING','CALCULATION','READING','MEMORY','TRANSFER','UNKNOWN')),
  cause_status TEXT NOT NULL DEFAULT 'PENDING_EVIDENCE'
    CHECK(cause_status IN ('PENDING_EVIDENCE','HYPOTHESIS','CONFIRMED')),
  cause TEXT,
  correction TEXT,
  pattern_key TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(resolution_status IN ('OPEN','AWAITING_RETEST','RESOLVED')),
  resolved_at TEXT,
  resolved_assessment_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  UNIQUE(id, knowledge_point_id),
  FOREIGN KEY(assessment_id, knowledge_point_id) REFERENCES assessments(id, knowledge_point_id) ON DELETE RESTRICT,
  FOREIGN KEY(id, resolved_assessment_id, knowledge_point_id)
    REFERENCES error_retests(error_record_id, assessment_id, knowledge_point_id) ON DELETE RESTRICT,
  CHECK((resolution_status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_assessment_id IS NOT NULL)
     OR (resolution_status <> 'RESOLVED' AND resolved_at IS NULL AND resolved_assessment_id IS NULL)),
  CHECK(cause_status = 'PENDING_EVIDENCE' OR (cause IS NOT NULL AND length(trim(cause)) > 0)),
  CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
) STRICT;
CREATE INDEX errors_point_time ON error_records(knowledge_point_id, occurred_at);
CREATE INDEX errors_resolution ON error_records(resolution_status) WHERE voided_at IS NULL;
CREATE INDEX errors_pattern ON error_records(knowledge_point_id, pattern_key, occurred_at);

CREATE TABLE error_retests (
  error_record_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('PASS','PARTIAL','FAIL','UNASSESSED')),
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(error_record_id, assessment_id),
  UNIQUE(error_record_id, assessment_id, knowledge_point_id),
  FOREIGN KEY(error_record_id, knowledge_point_id) REFERENCES error_records(id, knowledge_point_id) ON DELETE RESTRICT,
  FOREIGN KEY(assessment_id, knowledge_point_id) REFERENCES assessments(id, knowledge_point_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX retests_assessment ON error_retests(assessment_id);

CREATE TABLE learning_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('LEARN','REVIEW','SPOT_CHECK')),
  due_on TEXT NOT NULL CHECK(due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','CANCELLED')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  source TEXT NOT NULL CHECK(source IN ('MANUAL','RULE_CONFIRMED')),
  rule_version TEXT,
  completed_at TEXT,
  completed_assessment_id TEXT,
  completed_session_id TEXT REFERENCES study_sessions(id) ON DELETE RESTRICT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, knowledge_point_id),
  FOREIGN KEY(completed_assessment_id, knowledge_point_id) REFERENCES assessments(id, knowledge_point_id) ON DELETE RESTRICT,
  CHECK(source <> 'RULE_CONFIRMED' OR rule_version IS NOT NULL),
  CHECK(
    (status = 'PENDING' AND completed_at IS NULL AND completed_assessment_id IS NULL AND completed_session_id IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL AND cancel_reason IS NULL
      AND ((kind = 'LEARN' AND completed_session_id IS NOT NULL AND completed_assessment_id IS NULL)
        OR (kind IN ('REVIEW','SPOT_CHECK') AND completed_assessment_id IS NOT NULL AND completed_session_id IS NULL)))
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND length(trim(cancel_reason)) > 0
      AND completed_at IS NULL AND completed_assessment_id IS NULL AND completed_session_id IS NULL)
  )
) STRICT;
CREATE UNIQUE INDEX tasks_one_pending_per_point ON learning_tasks(knowledge_point_id) WHERE status = 'PENDING';
CREATE INDEX tasks_due ON learning_tasks(status, due_on);

CREATE TABLE knowledge_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('LEARN','REVIEW','TEST','STATE_CHANGED','TASK_CHANGED','ERROR_CHANGED','SUMMARY_UPDATED','RECORD_CORRECTED','ARCHIVED','NOTE')),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK(actor IN ('USER','SYSTEM','IMPORT')),
  session_id TEXT REFERENCES study_sessions(id) ON DELETE RESTRICT,
  assessment_id TEXT,
  error_record_id TEXT,
  task_id TEXT,
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  rule_version TEXT,
  FOREIGN KEY(assessment_id, knowledge_point_id) REFERENCES assessments(id, knowledge_point_id) ON DELETE RESTRICT,
  FOREIGN KEY(error_record_id, knowledge_point_id) REFERENCES error_records(id, knowledge_point_id) ON DELETE RESTRICT,
  FOREIGN KEY(task_id, knowledge_point_id) REFERENCES learning_tasks(id, knowledge_point_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX events_point_time ON knowledge_events(knowledge_point_id, occurred_at, sequence);
CREATE INDEX events_command ON knowledge_events(command_id);

CREATE TRIGGER knowledge_events_no_update BEFORE UPDATE ON knowledge_events
BEGIN SELECT RAISE(ABORT, 'knowledge_events are append-only'); END;
CREATE TRIGGER knowledge_events_no_delete BEFORE DELETE ON knowledge_events
BEGIN SELECT RAISE(ABORT, 'knowledge_events are append-only'); END;

-- Additional transactional service checks are intentionally documented in the design.
-- Do not infer mastery from result=PASS alone. NULL evidence is unknown, not success.
-- Audit JSON is supplemental; structured relational columns remain authoritative.
