import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { getStore, type Store } from "./db/client";
import { AppError, pointDetail, readCatalog } from "./catalog";
import { localDay, parseLocal } from "@/lib/dates";
import { roundActivityFor } from "./round-activity";
import {
  validDay,
  addDays,
  reviewAdvice,
  reviewRuleVersion,
} from "@/lib/review-policy";
import type { TaskRow, ReviewSuggestion, TaskKind } from "@/lib/review-models";
import type { AssessmentRow } from "@/lib/learning-models";
const id = z.uuid();
const reason = z.string().trim().min(1, "请填写原因").max(1000);
const day = z.string().refine(validDay, "日期无效，请填写真实日历日期");
const version = z.number().int().positive();
export const taskCompletionSchema = z
  .object({
    id,
    expectedVersion: version,
    next: z
      .object({
        id,
        mode: z.enum(["RULE", "MANUAL"]),
        dueOn: day.optional(),
        reason: reason.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      commandId: id,
      action: z.literal("create"),
      id,
      pointId: id,
      expectedPointVersion: version,
      kind: z.enum(["LEARN", "REVIEW", "SPOT_CHECK"]),
      dueOn: day,
      reason,
    })
    .strict(),
  z
    .object({
      commandId: id,
      action: z.literal("confirm"),
      id,
      pointId: id,
      token: z.string().length(64),
    })
    .strict(),
  z
    .object({
      commandId: id,
      action: z.literal("reschedule"),
      id,
      expectedVersion: version,
      dueOn: day,
      reason,
    })
    .strict(),
  z
    .object({
      commandId: id,
      action: z.literal("cancel"),
      id,
      expectedVersion: version,
      reason,
    })
    .strict(),
  z
    .object({
      commandId: id,
      action: z.literal("reopen"),
      id,
      expectedVersion: version,
      reason,
    })
    .strict(),
  z
    .object({
      commandId: id,
      action: z.literal("complete"),
      ...taskCompletionSchema.shape,
      recordId: id,
    })
    .strict(),
]);
export function readTasks(
  store: Store = getStore(),
  clock = new Date(),
): TaskRow[] {
  const today = localDay(
    clock.toISOString(),
    process.env.APP_TIMEZONE || "Asia/Shanghai",
  );
  return store.raw
    .prepare(
      `SELECT t.*, p.name AS point_name,p.archived_at,p.importance,p.mastery_level,p.suspected_forgetting,c.subject_id,s.name AS subject_name,
    (SELECT count(*) FROM error_records e WHERE e.knowledge_point_id=p.id AND e.voided_at IS NULL AND e.resolution_status<>'RESOLVED') AS open_errors,
    (SELECT count(*) FROM error_records e WHERE e.knowledge_point_id=p.id AND e.voided_at IS NULL AND e.occurred_at>=?) AS recent_errors
    FROM learning_tasks t JOIN knowledge_points p ON p.id=t.knowledge_point_id JOIN chapters c ON c.id=p.chapter_id JOIN subjects s ON s.id=c.subject_id
    ORDER BY t.due_on ASC, recent_errors DESC, open_errors DESC,p.suspected_forgetting DESC,p.importance DESC,t.created_at,t.id`,
    )
    .all(
      parseLocal(
        addDays(today, -13) + "T00:00",
        process.env.APP_TIMEZONE || "Asia/Shanghai",
      ),
    ) as TaskRow[];
}
function activePoint(pid: string, store: Store, expected?: number) {
  const d = pointDetail(pid, store);
  if (d.point.archivedAt || d.chapter.archivedAt || d.subject.archivedAt)
    throw new AppError(409, "知识点已归档，不能更改任务");
  if (expected !== undefined && d.point.version !== expected)
    throw new AppError(409, "知识点已更新，请刷新后再安排");
  return d;
}
export function suggestionFor(
  pid: string,
  store: Store = getStore(),
  clock = new Date(),
): ReviewSuggestion {
  const d = activePoint(pid, store);
  const zone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  const today = localDay(clock.toISOString(), zone);
  const test = store.raw
    .prepare(
      "SELECT * FROM assessments WHERE knowledge_point_id=? AND voided_at IS NULL ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1",
    )
    .get(pid) as AssessmentRow | undefined;
  const study = store.raw
    .prepare(
      "SELECT max(s.ended_at) AS at FROM study_sessions s JOIN study_session_points x ON s.id=x.session_id WHERE x.knowledge_point_id=? AND s.voided_at IS NULL AND x.activity_type IN ('LEARN','REVIEW')",
    )
    .get(pid) as { at: string | null };
  const anchor =
    [test?.occurred_at, study.at].filter(Boolean).sort().at(-1) || null;
  const roundStudy = roundActivityFor(pid, store),
    roundDay = roundStudy[0]?.day;
  const anchorDay =
    [anchor ? localDay(anchor, zone) : null, roundDay]
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  const advice = reviewAdvice({
    level: d.point.masteryLevel,
    today,
    anchorDay,
    forgetting: d.point.suspectedForgetting,
    test: test || null,
    useTest: Boolean(
      test &&
      (!study.at || test.occurred_at >= study.at) &&
      (!roundDay || localDay(test.occurred_at, zone) > roundDay),
    ),
  });
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        pointVersion: d.point.version,
        test,
        study,
        roundStudy,
        advice,
        today,
        rule: reviewRuleVersion,
      }),
    )
    .digest("hex");
  return {
    pointId: pid,
    pointVersion: d.point.version,
    pointName: d.point.name,
    subjectId: d.subject.id,
    ...advice,
    token,
  };
}
export function readSuggestions(store: Store = getStore(), clock = new Date()) {
  const occupied = new Set(
    readTasks(store, clock)
      .filter((t) => t.status === "PENDING")
      .map((t) => t.knowledge_point_id),
  );
  return readCatalog(store)
    .points.filter((p) => !p.archivedAt && !occupied.has(p.id))
    .map((p) => suggestionFor(p.id, store, clock));
}
function taskEvent(
  store: Store,
  commandId: string,
  before: TaskRow | null,
  after: TaskRow,
  why: string,
  now: string,
) {
  store.raw
    .prepare(
      "INSERT INTO knowledge_events(id,command_id,knowledge_point_id,event_type,occurred_at,recorded_at,actor,task_id,before_json,after_json,reason,rule_version) VALUES(?,?,?,'TASK_CHANGED',?,?,'USER',?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      commandId,
      after.knowledge_point_id,
      now,
      now,
      after.id,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      why,
      after.rule_version,
    );
  store.raw
    .prepare(
      "UPDATE knowledge_points SET version=version+1,updated_at=? WHERE id=?",
    )
    .run(now, after.knowledge_point_id);
}
function getTask(id: string, store: Store, expected?: number) {
  const t = readTasks(store).find((t) => t.id === id);
  if (!t) throw new AppError(404, "任务不存在");
  activePoint(t.knowledge_point_id, store);
  if (expected !== undefined && t.version !== expected)
    throw new AppError(409, "任务已被修改，请刷新后重试");
  return t;
}
function insertTask(
  store: Store,
  commandId: string,
  data: {
    id: string;
    pointId: string;
    kind: TaskKind;
    dueOn: string;
    reason: string;
    source: string;
    ruleVersion?: string;
  },
  clock: Date,
) {
  const now = clock.toISOString();
  const today = localDay(now, process.env.APP_TIMEZONE || "Asia/Shanghai");
  activePoint(data.pointId, store);
  if (data.dueOn < today)
    throw new AppError(400, "新任务不能安排在过去；请选择今天或未来日期");
  if (
    store.raw
      .prepare(
        "SELECT id FROM learning_tasks WHERE knowledge_point_id=? AND status='PENDING'",
      )
      .get(data.pointId)
  )
    throw new AppError(409, "此知识点已有待处理任务，请先改期、完成或取消");
  store.raw
    .prepare(
      "INSERT INTO learning_tasks(id,knowledge_point_id,kind,due_on,reason,source,rule_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      data.id,
      data.pointId,
      data.kind,
      data.dueOn,
      data.reason,
      data.source,
      data.ruleVersion || null,
      now,
      now,
    );
  const t = getTask(data.id, store);
  taskEvent(store, commandId, null, t, "安排任务：" + data.reason, now);
}
// Called inside the learning command's IMMEDIATE transaction. Record and task succeed or roll back together.
export function completeTaskFromRecord(
  store: Store,
  commandId: string,
  data: z.infer<typeof taskCompletionSchema>,
  record: { id: string; entity: "session" | "assessment" },
  clock: Date,
) {
  const t = getTask(data.id, store, data.expectedVersion);
  if (t.status !== "PENDING") throw new AppError(409, "仅待处理任务可以完成");
  const now = clock.toISOString();
  let occurred: string;
  if (t.kind === "LEARN") {
    if (record.entity !== "session")
      throw new AppError(400, "学习任务需关联实际学习日志");
    const s = store.raw
      .prepare("SELECT ended_at,voided_at FROM study_sessions WHERE id=?")
      .get(record.id) as
      { ended_at: string; voided_at: string | null } | undefined;
    const link = store.raw
      .prepare(
        "SELECT 1 FROM study_session_points WHERE session_id=? AND knowledge_point_id=? AND activity_type='LEARN'",
      )
      .get(record.id, t.knowledge_point_id);
    if (!s || s.voided_at || !link)
      throw new AppError(400, "日志无效或没有此知识点的学习活动");
    occurred = s.ended_at;
  } else {
    if (record.entity !== "assessment")
      throw new AppError(400, "复习/抽查任务需关联实际复测；仅阅读不能完成");
    const a = store.raw
      .prepare("SELECT * FROM assessments WHERE id=?")
      .get(record.id) as AssessmentRow | undefined;
    if (!a || a.voided_at || a.knowledge_point_id !== t.knowledge_point_id)
      throw new AppError(400, "测试无效或属于其他知识点");
    occurred = a.occurred_at;
  }
  // Forms record minute precision; compare against the creation minute, not its seconds.
  if (occurred < t.created_at.slice(0, 16) + ":00.000Z")
    throw new AppError(400, "任务只能关联安排之后发生的学习或复测");
  if (Date.parse(occurred) > clock.getTime() + 60000)
    throw new AppError(400, "任务不能引用尚未发生的记录");
  if (
    store.raw
      .prepare(
        `SELECT id FROM learning_tasks WHERE ${record.entity === "session" ? "completed_session_id" : "completed_assessment_id"}=? AND knowledge_point_id=? AND status='COMPLETED'`,
      )
      .get(record.id, t.knowledge_point_id)
  )
    throw new AppError(409, "此记录已用于完成该知识点的另一任务");
  store.raw
    .prepare(
      "UPDATE learning_tasks SET status='COMPLETED',completed_at=?,completed_assessment_id=?,completed_session_id=?,version=version+1,updated_at=? WHERE id=?",
    )
    .run(
      now,
      record.entity === "assessment" ? record.id : null,
      record.entity === "session" ? record.id : null,
      now,
      t.id,
    );
  taskEvent(
    store,
    commandId,
    t,
    getTask(t.id, store),
    "完成一次任务活动，保留实际表现；等级需另行确认",
    now,
  );
  if (data.next) {
    const n = data.next;
    const advice = suggestionFor(t.knowledge_point_id, store, clock);
    if (n.mode === "RULE") {
      if (!advice.dueOn)
        throw new AppError(
          400,
          advice.reason + " 请改为手动安排，或取消下一次安排。",
        );
      insertTask(
        store,
        commandId,
        {
          id: n.id,
          pointId: t.knowledge_point_id,
          kind: advice.kind,
          dueOn: advice.dueOn,
          reason: advice.reason,
          source: "RULE_CONFIRMED",
          ruleVersion: reviewRuleVersion,
        },
        clock,
      );
    } else {
      if (!n.dueOn || !n.reason)
        throw new AppError(400, "手动安排需要日期和原因");
      insertTask(
        store,
        commandId,
        {
          id: n.id,
          pointId: t.knowledge_point_id,
          kind: advice.kind,
          dueOn: n.dueOn,
          reason: n.reason,
          source: "MANUAL",
        },
        clock,
      );
    }
  }
}
export function executeTask(
  input: unknown,
  store: Store = getStore(),
  clock = new Date(),
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      400,
      parsed.error.issues.map((i) => i.message).join("；"),
    );
  const c = parsed.data;
  const hash = createHash("sha256")
    .update("tasks:" + JSON.stringify(c))
    .digest("hex");
  const now = clock.toISOString();
  try {
    return store.raw
      .transaction(() => {
        const receipt = store.raw
          .prepare("SELECT * FROM _command_receipts WHERE id=?")
          .get(c.commandId) as
          { payload_hash: string; response_json: string } | undefined;
        if (receipt) {
          if (receipt.payload_hash !== hash)
            throw new AppError(409, "提交编号已用于其他内容，请重新打开表单");
          return JSON.parse(receipt.response_json) as {
            id: string;
            message: string;
          };
        }
        if (c.action === "create") {
          activePoint(c.pointId, store, c.expectedPointVersion);
          insertTask(store, c.commandId, { ...c, source: "MANUAL" }, clock);
        } else if (c.action === "confirm") {
          const advice = suggestionFor(c.pointId, store, clock);
          if (advice.token !== c.token)
            throw new AppError(409, "建议依据或日期已变化，请刷新后重新确认");
          if (!advice.dueOn) throw new AppError(400, advice.reason);
          insertTask(
            store,
            c.commandId,
            {
              ...c,
              kind: advice.kind,
              dueOn: advice.dueOn,
              reason: advice.reason,
              source: "RULE_CONFIRMED",
              ruleVersion: reviewRuleVersion,
            },
            clock,
          );
        } else if (c.action === "complete") {
          const t = getTask(c.id, store, c.expectedVersion);
          completeTaskFromRecord(
            store,
            c.commandId,
            c,
            {
              id: c.recordId,
              entity: t.kind === "LEARN" ? "session" : "assessment",
            },
            clock,
          );
        } else {
          const t = getTask(c.id, store, c.expectedVersion);
          if (c.action === "reopen") {
            if (t.status !== "COMPLETED")
              throw new AppError(409, "只能撤销已完成任务");
            if (
              store.raw
                .prepare(
                  "SELECT id FROM learning_tasks WHERE knowledge_point_id=? AND status='PENDING'",
                )
                .get(t.knowledge_point_id)
            )
              throw new AppError(409, "已有下一任务，请先取消它，再撤销完成");
            store.raw
              .prepare(
                "UPDATE learning_tasks SET status='PENDING',completed_at=NULL,completed_assessment_id=NULL,completed_session_id=NULL,version=version+1,updated_at=? WHERE id=?",
              )
              .run(now, t.id);
          } else {
            if (t.status !== "PENDING")
              throw new AppError(409, "只能更改待处理任务");
            if (c.action === "reschedule") {
              if (
                c.dueOn <
                localDay(now, process.env.APP_TIMEZONE || "Asia/Shanghai")
              )
                throw new AppError(400, "改期请选择今天或未来日期");
              store.raw
                .prepare(
                  "UPDATE learning_tasks SET due_on=?,reason=?,version=version+1,updated_at=? WHERE id=?",
                )
                .run(c.dueOn, c.reason, now, t.id);
            } else
              store.raw
                .prepare(
                  "UPDATE learning_tasks SET status='CANCELLED',cancelled_at=?,cancel_reason=?,version=version+1,updated_at=? WHERE id=?",
                )
                .run(now, c.reason, now, t.id);
          }
          taskEvent(store, c.commandId, t, getTask(t.id, store), c.reason, now);
        }
        const response = {
          id: c.id,
          message:
            c.action === "complete"
              ? "任务已完成，实际结果与依据已保留"
              : c.action === "reopen"
                ? "已撤销完成，原记录仍保留"
                : "任务安排已保存",
        };
        store.raw
          .prepare("INSERT INTO _command_receipts VALUES(?,?,?,?)")
          .run(c.commandId, hash, JSON.stringify(response), now);
        return response;
      })
      .immediate();
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (((e as { code?: string }).code || "").includes("CONSTRAINT"))
      throw new AppError(
        409,
        "任务编号或关联冲突，请刷新后检查；未保存任何部分",
      );
    throw e;
  }
}
