import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// P0/P1 ORM mappings. The reviewed SQL migrations also create the six reserved
// learning-evidence tables. Add their mappings when implementing P2/P3; never push.
const identity = () => ({
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
});
export const subjects = sqliteTable("subjects", identity(), (t) => [
  uniqueIndex("subjects_active_name")
    .on(t.name)
    .where(sql`${t.archivedAt} IS NULL`),
]);
export const chapters = sqliteTable(
  "chapters",
  {
    ...identity(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
  },
  (t) => [
    index("chapters_subject").on(t.subjectId, t.sortOrder),
    uniqueIndex("chapters_active_name")
      .on(t.subjectId, t.name)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);
export const knowledgePoints = sqliteTable(
  "knowledge_points",
  {
    ...identity(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id),
    importance: integer("importance").notNull().default(3),
    masteryLevel: text("mastery_level", { enum: ["A", "B", "C", "D", "E"] })
      .notNull()
      .default("A"),
    masteryBasis: text("mastery_basis", {
      enum: ["UNASSESSED", "SELF_REPORTED", "EVIDENCE"],
    })
      .notNull()
      .default("UNASSESSED"),
    learningStage: text("learning_stage", {
      enum: ["NOT_STARTED", "IN_PROGRESS", "COVERED"],
    })
      .notNull()
      .default("NOT_STARTED"),
    suspectedForgetting: integer("suspected_forgetting", { mode: "boolean" })
      .notNull()
      .default(false),
    aiSummary: text("ai_summary"),
    summarySource: text("summary_source"),
    summaryUpdatedAt: text("summary_updated_at"),
    summaryBasedOnVersion: integer("summary_based_on_version"),
  },
  (t) => [
    index("points_chapter").on(t.chapterId, t.sortOrder),
    uniqueIndex("points_active_name")
      .on(t.chapterId, t.name)
      .where(sql`${t.archivedAt} IS NULL`),
    check("points_level", sql`${t.masteryLevel} IN ('A','B','C','D','E')`),
  ],
);
export const knowledgeEvents = sqliteTable("knowledge_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  commandId: text("command_id").notNull(),
  knowledgePointId: text("knowledge_point_id")
    .notNull()
    .references(() => knowledgePoints.id),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  actor: text("actor").notNull(),
  sessionId: text("session_id"),
  assessmentId: text("assessment_id"),
  errorRecordId: text("error_record_id"),
  taskId: text("task_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull(),
  ruleVersion: text("rule_version"),
});
