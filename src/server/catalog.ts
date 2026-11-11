import { and, eq, isNull, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  subjects,
  chapters,
  knowledgePoints,
  knowledgeEvents,
} from "./db/schema";
import { getStore, type Store } from "./db/client";
import type { Catalog } from "@/lib/models";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const name = z
  .string()
  .trim()
  .min(1, "请填写名称")
  .max(100, "名称不能超过 100 字");
const note = z.string().trim().max(4000).default("");
const kind = z.enum(["subject", "chapter", "point"]);
const common = { commandId: z.uuid(), entity: kind };
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("create"),
      id: z.uuid(),
      parentId: z.uuid().optional(),
      name,
      description: note,
      initialLevel: z
        .enum(["UNASSESSED", "A", "B", "C", "D"])
        .default("UNASSESSED"),
      importance: z.number().int().min(1).max(5).default(3),
      learningStage: z
        .enum(["NOT_STARTED", "IN_PROGRESS", "COVERED"])
        .default("NOT_STARTED"),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("edit"),
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      name,
      description: note,
      importance: z.number().int().min(1).max(5).default(3),
      learningStage: z
        .enum(["NOT_STARTED", "IN_PROGRESS", "COVERED"])
        .default("NOT_STARTED"),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("archive"),
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      commandId: z.uuid(),
      entity: z.literal("point"),
      action: z.literal("summary"),
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      summary: z.string().trim().max(10000),
      source: z.enum(["MANUAL", "AI_PASTED"]),
    })
    .strict(),
]);
export type Command = z.input<typeof commandSchema>;
export function readCatalog(store: Store = getStore()): Catalog {
  return {
    subjects: store.db
      .select()
      .from(subjects)
      .orderBy(asc(subjects.sortOrder), asc(subjects.createdAt))
      .all(),
    chapters: store.db
      .select()
      .from(chapters)
      .orderBy(asc(chapters.sortOrder), asc(chapters.createdAt))
      .all(),
    points: store.db
      .select()
      .from(knowledgePoints)
      .orderBy(asc(knowledgePoints.sortOrder), asc(knowledgePoints.createdAt))
      .all(),
  };
}
export function pointDetail(id: string, store: Store = getStore()) {
  const point = store.db
    .select()
    .from(knowledgePoints)
    .where(eq(knowledgePoints.id, id))
    .get();
  if (!point) throw new AppError(404, "知识点不存在");
  const chapter = store.db
    .select()
    .from(chapters)
    .where(eq(chapters.id, point.chapterId))
    .get()!;
  const subject = store.db
    .select()
    .from(subjects)
    .where(eq(subjects.id, chapter.subjectId))
    .get()!;
  const events = store.db
    .select()
    .from(knowledgeEvents)
    .where(eq(knowledgeEvents.knowledgePointId, id))
    .orderBy(desc(knowledgeEvents.sequence))
    .all();
  return { point, chapter, subject, events };
}
export function executeCommand(input: unknown, store: Store = getStore()) {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      400,
      parsed.error.issues.map((i) => i.message).join("；"),
    );
  const c = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(c)).digest("hex");
  try {
    return store.raw
      .transaction(() => {
        const receipt = store.raw
          .prepare(
            "SELECT payload_hash, response_json FROM _command_receipts WHERE id=?",
          )
          .get(c.commandId) as
          { payload_hash: string; response_json: string } | undefined;
        if (receipt) {
          if (receipt.payload_hash !== hash)
            throw new AppError(409, "这个提交编号已用于其他内容，请刷新后重试");
          return JSON.parse(receipt.response_json) as {
            id: string;
            message: string;
          };
        }
        const now = new Date().toISOString();
        const pointEvent = (
          id: string,
          type: string,
          before: unknown,
          after: unknown,
          reason: string,
        ) => {
          store.db
            .insert(knowledgeEvents)
            .values({
              id: randomUUID(),
              commandId: c.commandId,
              knowledgePointId: id,
              eventType: type,
              occurredAt: now,
              recordedAt: now,
              actor: "USER",
              beforeJson: before == null ? null : JSON.stringify(before),
              afterJson: JSON.stringify(after),
              reason,
              ruleVersion: "catalog-v1",
            })
            .run();
        };
        const catalogEvent = (
          entity: "subject" | "chapter",
          id: string,
          action: string,
          before: unknown,
          after: unknown,
          reason: string,
        ) => {
          store.raw
            .prepare(
              "INSERT INTO _catalog_events (id, command_id, entity_type, entity_id, action, before_json, after_json, reason, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              randomUUID(),
              c.commandId,
              entity,
              id,
              action,
              before == null ? null : JSON.stringify(before),
              JSON.stringify(after),
              reason,
              now,
            );
        };
        const activeSubject = (id: string) => {
          const row = store.db
            .select()
            .from(subjects)
            .where(eq(subjects.id, id))
            .get();
          if (!row || row.archivedAt)
            throw new AppError(400, "科目不存在或已归档");
          return row;
        };
        const activeChapter = (id: string) => {
          const row = store.db
            .select()
            .from(chapters)
            .where(eq(chapters.id, id))
            .get();
          if (!row || row.archivedAt)
            throw new AppError(400, "章节不存在或已归档");
          activeSubject(row.subjectId);
          return row;
        };
        if (c.action === "create") {
          const base = {
            id: c.id,
            name: c.name,
            description: c.description || null,
            createdAt: now,
            updatedAt: now,
          };
          if (c.entity === "subject") {
            store.db.insert(subjects).values(base).run();
            catalogEvent("subject", c.id, "CREATE", null, base, "创建科目");
          } else if (c.entity === "chapter") {
            if (!c.parentId) throw new AppError(400, "请选择科目");
            activeSubject(c.parentId);
            const row = { ...base, subjectId: c.parentId };
            store.db.insert(chapters).values(row).run();
            catalogEvent("chapter", c.id, "CREATE", null, row, "创建章节");
          } else {
            if (!c.parentId) throw new AppError(400, "请选择章节");
            activeChapter(c.parentId);
            const row = {
              ...base,
              chapterId: c.parentId,
              importance: c.importance,
              learningStage: c.learningStage,
              masteryLevel:
                c.initialLevel === "UNASSESSED"
                  ? ("A" as const)
                  : c.initialLevel,
              masteryBasis:
                c.initialLevel === "UNASSESSED"
                  ? ("UNASSESSED" as const)
                  : ("SELF_REPORTED" as const),
            };
            store.db.insert(knowledgePoints).values(row).run();
            pointEvent(
              c.id,
              "STATE_CHANGED",
              null,
              row,
              c.initialLevel === "UNASSESSED"
                ? "建立知识点，暂未评估"
                : `初始自评为 ${c.initialLevel}，尚无复测证据`,
            );
          }
        } else {
          const table =
            c.entity === "subject"
              ? subjects
              : c.entity === "chapter"
                ? chapters
                : knowledgePoints;
          const before = store.db
            .select()
            .from(table)
            .where(eq(table.id, c.id))
            .get();
          if (!before) throw new AppError(404, "记录不存在");
          if (before.archivedAt)
            throw new AppError(409, "记录已归档，只能查阅历史");
          if (before.version !== c.expectedVersion)
            throw new AppError(409, "记录已在其他窗口更新，请刷新后重新编辑");
          if (c.entity === "point")
            activeChapter(
              (before as typeof knowledgePoints.$inferSelect).chapterId,
            );
          if (c.entity === "chapter")
            activeSubject((before as typeof chapters.$inferSelect).subjectId);
          if (c.action === "edit") {
            const updates = {
              name: c.name,
              description: c.description || null,
              updatedAt: now,
              version: before.version + 1,
            };
            if (c.entity === "point") {
              const full = {
                ...updates,
                importance: c.importance,
                learningStage: c.learningStage,
              };
              store.db
                .update(knowledgePoints)
                .set(full)
                .where(
                  and(
                    eq(knowledgePoints.id, c.id),
                    eq(knowledgePoints.version, c.expectedVersion),
                  ),
                )
                .run();
              pointEvent(
                c.id,
                "RECORD_CORRECTED",
                before,
                { ...before, ...full },
                "修改知识点信息",
              );
            } else {
              store.db
                .update(table)
                .set(updates)
                .where(
                  and(eq(table.id, c.id), eq(table.version, c.expectedVersion)),
                )
                .run();
              catalogEvent(
                c.entity,
                c.id,
                "UPDATE",
                before,
                { ...before, ...updates },
                "修改目录信息",
              );
            }
          } else if (c.action === "summary") {
            const updates = {
              aiSummary: c.summary || null,
              summarySource: c.summary ? c.source : null,
              summaryUpdatedAt: c.summary ? now : null,
              summaryBasedOnVersion: c.summary ? before.version + 1 : null,
              version: before.version + 1,
              updatedAt: now,
            };
            store.db
              .update(knowledgePoints)
              .set(updates)
              .where(eq(knowledgePoints.id, c.id))
              .run();
            pointEvent(
              c.id,
              "SUMMARY_UPDATED",
              before,
              { ...before, ...updates },
              c.summary
                ? "更新学习摘要；未改变掌握等级"
                : "清空学习摘要；原文保留在历史中",
            );
          } else {
            const catalog = readCatalog(store);
            const affectedChapters =
              c.entity === "subject"
                ? catalog.chapters.filter(
                    (x) => x.subjectId === c.id && !x.archivedAt,
                  )
                : c.entity === "chapter"
                  ? catalog.chapters.filter((x) => x.id === c.id)
                  : [];
            const chapterIds = new Set(affectedChapters.map((x) => x.id));
            const affectedPoints = catalog.points.filter(
              (x) =>
                !x.archivedAt &&
                (c.entity === "point"
                  ? x.id === c.id
                  : chapterIds.has(x.chapterId)),
            );
            for (const p of affectedPoints) {
              const after = {
                ...p,
                archivedAt: now,
                updatedAt: now,
                version: p.version + 1,
              };
              store.db
                .update(knowledgePoints)
                .set({
                  archivedAt: now,
                  updatedAt: now,
                  version: p.version + 1,
                })
                .where(eq(knowledgePoints.id, p.id))
                .run();
              const tasks = store.raw
                .prepare(
                  "SELECT * FROM learning_tasks WHERE knowledge_point_id=? AND status='PENDING'",
                )
                .all(p.id) as { id: string }[];
              for (const t of tasks) {
                store.raw
                  .prepare(
                    "UPDATE learning_tasks SET status='CANCELLED', cancelled_at=?, cancel_reason=?, updated_at=?, version=version+1 WHERE id=?",
                  )
                  .run(now, c.reason, now, t.id);
                pointEvent(
                  p.id,
                  "TASK_CHANGED",
                  t,
                  { id: t.id, status: "CANCELLED" },
                  `归档时取消待处理任务：${c.reason}`,
                );
              }
              pointEvent(p.id, "ARCHIVED", p, after, c.reason);
            }
            for (const chapter of affectedChapters) {
              const updates = {
                archivedAt: now,
                updatedAt: now,
                version: chapter.version + 1,
              };
              store.db
                .update(chapters)
                .set(updates)
                .where(eq(chapters.id, chapter.id))
                .run();
              catalogEvent(
                "chapter",
                chapter.id,
                "ARCHIVE",
                chapter,
                { ...chapter, ...updates },
                c.reason,
              );
            }
            if (c.entity === "subject") {
              const updates = {
                archivedAt: now,
                updatedAt: now,
                version: before.version + 1,
              };
              store.db
                .update(subjects)
                .set(updates)
                .where(eq(subjects.id, c.id))
                .run();
              catalogEvent(
                "subject",
                c.id,
                "ARCHIVE",
                before,
                { ...before, ...updates },
                c.reason,
              );
            }
          }
        }
        const response = {
          id: c.id,
          message:
            c.action === "create"
              ? "已创建"
              : c.action === "archive"
                ? "已归档，历史记录保留"
                : "已保存",
        };
        store.raw
          .prepare("INSERT INTO _command_receipts VALUES (?, ?, ?, ?)")
          .run(c.commandId, hash, JSON.stringify(response), now);
        return response;
      })
      .immediate();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const e = error as Error & {
      code?: string;
      cause?: Error & { code?: string };
    };
    const code = e.code || e.cause?.code || "";
    if (code.includes("UNIQUE") || code.includes("PRIMARYKEY"))
      throw new AppError(409, "名称或记录编号已存在，请检查后重试");
    throw error;
  }
}
