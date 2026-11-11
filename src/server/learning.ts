import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { getStore, type Store } from "./db/client";
import { knowledgePoints, knowledgeEvents } from "./db/schema";
import { AppError, pointDetail } from "./catalog";
import { localDay, parseLocal } from "@/lib/dates";
import { addDays } from "@/lib/review-policy";
import { roundActivityFor } from "./round-activity";
import { taskCompletionSchema, completeTaskFromRecord } from "./tasks";
import type {
  SessionRow,
  AssessmentRow,
  ErrorRow,
} from "@/lib/learning-models";

const short = z.string().trim().max(4000).default("");
const reason = z.string().trim().min(1, "请填写原因").max(1000);
const id = z.uuid();
const base = { commandId: id };
const tri = z.boolean().nullable().default(null);
const errorInput = z
  .object({
    type: z
      .enum([
        "UNKNOWN",
        "CONCEPT",
        "CONDITION",
        "METHOD",
        "MODELING",
        "CALCULATION",
        "READING",
        "MEMORY",
        "TRANSFER",
      ])
      .default("UNKNOWN"),
    causeStatus: z
      .enum(["PENDING_EVIDENCE", "HYPOTHESIS", "CONFIRMED"])
      .default("PENDING_EVIDENCE"),
    cause: short,
    correction: short,
    patternKey: z.string().trim().max(100).default(""),
  })
  .strict();
const stateInput = {
  targetLevel: z.enum(["A", "B", "C", "D", "E"]),
  reason,
  evidenceIds: z.array(id).max(20).default([]),
};
const stateSchema = z
  .object({
    ...stateInput,
    targetLevel: z.enum(["UNASSESSED", "A", "B", "C", "D", "E"]),
    mode: z.enum(["SELF_REPORTED", "EVIDENCE"]).default("EVIDENCE"),
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("session"),
      id,
      subjectId: id,
      startedLocal: z.string(),
      endedLocal: z.string(),
      durationMinutes: z.number().int().min(1).max(1440),
      content: short,
      rawNote: short,
      task: taskCompletionSchema.optional(),
      points: z
        .array(
          z
            .object({
              id,
              expectedVersion: z.number().int().positive(),
              activity: z.enum(["LEARN", "REVIEW", "TEST"]),
            })
            .strict(),
        )
        .min(1, "至少关联一个知识点")
        .max(50),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("assessment"),
      id,
      pointId: id,
      expectedVersion: z.number().int().positive(),
      sessionId: id.nullable().default(null),
      occurredLocal: z.string(),
      question: z.string().trim().min(1, "请填写题目或测试内容").max(4000),
      questionRef: short,
      response: short,
      result: z.enum(["PASS", "PARTIAL", "FAIL", "UNASSESSED"]),
      independent: tri,
      hintCount: z.number().int().min(0).max(1000).nullable().default(null),
      answerViewed: tri,
      taskType: z
        .enum(["UNKNOWN", "CONCEPT", "TYPICAL", "VARIANT", "TRANSFER"])
        .default("UNKNOWN"),
      difficulty: z
        .enum(["UNKNOWN", "EASY", "STANDARD", "HARD"])
        .default("UNKNOWN"),
      isNew: tri,
      canExplain: tri,
      note: short,
      error: errorInput.optional(),
      retests: z
        .array(
          z
            .object({
              errorId: id,
              expectedVersion: z.number().int().positive(),
              outcome: z.enum(["PASS", "PARTIAL", "FAIL", "UNASSESSED"]),
              resolve: z.boolean().default(false),
            })
            .strict(),
        )
        .max(30)
        .default([]),
      state: z.object(stateInput).strict().optional(),
      forgetting: z.boolean().optional(),
      task: taskCompletionSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("state"),
      pointId: id,
      expectedVersion: z.number().int().positive(),
      ...stateSchema.shape,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("error-correction"),
      id,
      expectedVersion: z.number().int().positive(),
      ...errorInput.shape,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("void"),
      entity: z.enum(["session", "assessment", "error"]),
      id,
      reason,
    })
    .strict(),
]);
export function readSessions(store: Store = getStore()): SessionRow[] {
  const rows = store.raw
    .prepare(
      "SELECT s.*,u.name AS subject_name FROM study_sessions s JOIN subjects u ON u.id=s.subject_id ORDER BY s.started_at DESC",
    )
    .all() as SessionRow[];
  return rows.map((s) => ({
    ...s,
    points: store.raw
      .prepare(
        "SELECT p.id,p.name,x.activity_type FROM study_session_points x JOIN knowledge_points p ON p.id=x.knowledge_point_id WHERE x.session_id=?",
      )
      .all(s.id) as SessionRow["points"],
  }));
}
export function readAssessments(
  pointId?: string,
  store: Store = getStore(),
): AssessmentRow[] {
  return store.raw
    .prepare(
      `SELECT a.*,p.name AS point_name FROM assessments a JOIN knowledge_points p ON p.id=a.knowledge_point_id ${pointId ? "WHERE a.knowledge_point_id=?" : ""} ORDER BY a.occurred_at DESC,a.created_at DESC`,
    )
    .all(...(pointId ? [pointId] : [])) as AssessmentRow[];
}
export function readErrors(
  pointId?: string,
  store: Store = getStore(),
): ErrorRow[] {
  return store.raw
    .prepare(
      `SELECT e.*,p.name AS point_name,p.archived_at,
 (SELECT count(*) FROM error_records x WHERE x.knowledge_point_id=e.knowledge_point_id AND x.pattern_key=e.pattern_key AND x.voided_at IS NULL) AS repeated_count,
 (SELECT max(a.occurred_at) FROM error_retests r JOIN assessments a ON a.id=r.assessment_id WHERE r.error_record_id=e.id AND a.voided_at IS NULL) AS last_retested_at
 FROM error_records e JOIN knowledge_points p ON p.id=e.knowledge_point_id ${pointId ? "WHERE e.knowledge_point_id=?" : ""} ORDER BY e.occurred_at DESC,e.created_at DESC`,
    )
    .all(...(pointId ? [pointId] : [])) as ErrorRow[];
}
export function executeLearning(
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
    .update("learning:" + JSON.stringify(c))
    .digest("hex");
  const now = clock.toISOString();
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  const occurred = (local: string) => {
    let at: string;
    try {
      at = parseLocal(local, timeZone);
    } catch (e) {
      throw new AppError(400, (e as Error).message);
    }
    if (Date.parse(at) > clock.getTime() + 60000)
      throw new AppError(400, "不能记录尚未发生的学习或测试");
    return at;
  };
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
        const getPoint = (pid: string, version?: number) => {
          const detail = pointDetail(pid, store);
          if (
            detail.point.archivedAt ||
            detail.chapter.archivedAt ||
            detail.subject.archivedAt
          )
            throw new AppError(409, "知识点已归档，不能新增或更改学习记录");
          if (version !== undefined && detail.point.version !== version)
            throw new AppError(409, "知识点已更新，请刷新后重新提交");
          return detail;
        };
        const event = (
          pid: string,
          type: string,
          before: unknown,
          after: unknown,
          why: string,
          refs: {
            sessionId?: string;
            assessmentId?: string;
            errorRecordId?: string;
            ruleVersion?: string;
          } = {},
          at = now,
        ) => {
          store.db
            .insert(knowledgeEvents)
            .values({
              id: randomUUID(),
              commandId: c.commandId,
              knowledgePointId: pid,
              eventType: type,
              occurredAt: at,
              recordedAt: now,
              actor: "USER",
              beforeJson: before == null ? null : JSON.stringify(before),
              afterJson: JSON.stringify(after),
              reason: why,
              ruleVersion: "mastery-v1",
              ...refs,
            })
            .run();
        };
        const touch = (pid: string) => {
          store.raw
            .prepare(
              "UPDATE knowledge_points SET version=version+1,updated_at=? WHERE id=?",
            )
            .run(now, pid);
        };
        const getError = (eid: string, version?: number) => {
          const e = readErrors(undefined, store).find((x) => x.id === eid);
          if (!e || e.voided_at)
            throw new AppError(400, "错误记录不存在或已作废");
          if (version !== undefined && e.version !== version)
            throw new AppError(409, "错误记录已更新，请刷新后重试");
          return e;
        };
        const independent = (a: AssessmentRow) =>
          a.result === "PASS" &&
          a.independent === 1 &&
          a.hint_count === 0 &&
          a.answer_viewed === 0;
        const updateState = (
          pid: string,
          state: z.infer<typeof stateSchema>,
        ) => {
          const p = getPoint(pid).point;
          const unassessed = state.targetLevel === "UNASSESSED";
          if (unassessed && state.mode !== "SELF_REPORTED")
            throw new AppError(
              400,
              "暂未评估请使用手动自评方式，不作为复测确认",
            );
          const targetLevel =
            state.targetLevel === "UNASSESSED" ? "A" : state.targetLevel;
          const order = "ABCDE";
          const delta =
            order.indexOf(targetLevel) - order.indexOf(p.masteryLevel);
          if (state.mode === "SELF_REPORTED" && state.evidenceIds.length)
            throw new AppError(400, "手动自评不关联复测证据，请改用复测确认");
          const all = readAssessments(pid, store).filter((a) => !a.voided_at);
          const evidence = state.evidenceIds.map((eid) => {
            const a = all.find((x) => x.id === eid);
            if (!a) throw new AppError(400, "等级依据必须是该知识点的有效测试");
            return a;
          });
          if (new Set(state.evidenceIds).size !== state.evidenceIds.length)
            throw new AppError(400, "复测证据不能重复选择");
          if (state.mode === "EVIDENCE" && delta < 0 && !evidence.length)
            throw new AppError(400, "降低等级需要关联测试证据并说明原因");
          if (
            state.mode === "EVIDENCE" &&
            delta >= 0 &&
            ["C", "D", "E"].includes(state.targetLevel)
          ) {
            const latest = all[0];
            const qualified = evidence.filter(
              (a) => independent(a) && a.id === latest?.id,
            );
            if (
              state.targetLevel === "C" &&
              !qualified.some((a) => a.task_type === "TYPICAL")
            )
              throw new AppError(
                400,
                "C 级需要最近一次典型题独立通过，确认无提示、未看答案",
              );
            if (
              state.targetLevel === "D" &&
              !qualified.some(
                (a) =>
                  ["VARIANT", "TRANSFER"].includes(a.task_type) &&
                  a.is_new_question === 1 &&
                  a.can_explain === 1,
              )
            )
              throw new AppError(
                400,
                "D 级需要最近一次新变式或迁移题独立通过，并能解释思路",
              );
            if (state.targetLevel === "E") {
              const good = evidence
                .filter(
                  (a) =>
                    independent(a) &&
                    ["VARIANT", "TRANSFER"].includes(a.task_type) &&
                    a.is_new_question === 1 &&
                    a.can_explain === 1,
                )
                .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
              if (p.masteryLevel !== "D" && p.masteryLevel !== "E")
                throw new AppError(400, "需先达到 D 级再确认稳定掌握");
              if (good.length < 2 || good.at(-1)?.id !== latest?.id)
                throw new AppError(
                  400,
                  "E 级需要包含最近测试的两次新变式或迁移题证据",
                );
              const last = good.at(-1)!;
              const first = good[0];
              if (
                localDay(first.occurred_at, timeZone) ===
                localDay(last.occurred_at, timeZone)
              )
                throw new AppError(400, "E 级需要不同日期的延迟复测");
              const priorTests = all
                .filter(
                  (a) => a.id !== last.id && a.occurred_at <= last.occurred_at,
                )
                .map((a) => a.occurred_at);
              const priorStudy = (
                store.raw
                  .prepare(
                    "SELECT s.ended_at FROM study_sessions s JOIN study_session_points x ON x.session_id=s.id WHERE x.knowledge_point_id=? AND x.activity_type IN ('LEARN','REVIEW') AND s.voided_at IS NULL AND s.ended_at<=?",
                  )
                  .all(pid, last.occurred_at) as { ended_at: string }[]
              ).map((x) => x.ended_at);
              // Round records have dates, not exact times. Use the next day's
              // start as a conservative bound; never invent a study timestamp.
              const roundStudy = roundActivityFor(pid, store)
                .filter((x) => x.day <= localDay(last.occurred_at, timeZone))
                .map((x) => parseLocal(addDays(x.day, 1) + "T00:00", timeZone));
              const previous = [...priorTests, ...priorStudy, ...roundStudy]
                .sort()
                .at(-1);
              if (
                !previous ||
                Date.parse(last.occurred_at) - Date.parse(previous) <
                  7 * 86400000
              )
                throw new AppError(
                  400,
                  "最近测试距离此前学习、复习或测试不足 7 个完整日",
                );
              if (
                all.some(
                  (a) =>
                    ["FAIL", "PARTIAL"].includes(a.result) &&
                    a.occurred_at >= first.occurred_at &&
                    a.occurred_at <= last.occurred_at,
                )
              )
                throw new AppError(
                  400,
                  "两次证据之间仍有未通过或部分完成的测试",
                );
              if (
                readErrors(pid, store).some(
                  (e) => !e.voided_at && e.resolution_status !== "RESOLVED",
                )
              )
                throw new AppError(400, "仍有未解决错误，暂不能确认 E 级");
            }
          }
          if (state.mode === "EVIDENCE" && !evidence.length)
            throw new AppError(400, "复测确认需要关联有效测试证据");
          const basis = unassessed ? "UNASSESSED" : state.mode;
          store.db
            .update(knowledgePoints)
            .set({
              masteryLevel: targetLevel,
              masteryBasis: basis,
              updatedAt: now,
            })
            .where(eq(knowledgePoints.id, pid))
            .run();
          event(
            pid,
            "STATE_CHANGED",
            p,
            {
              ...p,
              masteryLevel: targetLevel,
              masteryBasis: basis,
              adjustmentMode: state.mode,
              evidenceIds: state.evidenceIds,
            },
            state.reason,
            { assessmentId: evidence.at(-1)?.id, ruleVersion: "mastery-v2" },
          );
        };
        let responseId = "id" in c ? c.id : c.pointId;
        if (c.action === "session") {
          if (new Set(c.points.map((p) => p.id)).size !== c.points.length)
            throw new AppError(400, "同一学习日志中知识点不能重复");
          const start = occurred(c.startedLocal),
            end = occurred(c.endedLocal);
          if (
            end <= start ||
            localDay(start, timeZone) !== localDay(end, timeZone)
          )
            throw new AppError(
              400,
              "结束时间应晚于开始时间；跨日学习请拆成两条",
            );
          if (
            c.durationMinutes >
            Math.floor((Date.parse(end) - Date.parse(start)) / 60000)
          )
            throw new AppError(400, "实际学习分钟不能超过起止时间跨度");
          for (const item of c.points) {
            const d = getPoint(item.id, item.expectedVersion);
            if (d.subject.id !== c.subjectId)
              throw new AppError(400, "学习日志的科目与知识点不一致");
          }
          store.raw
            .prepare(
              "INSERT INTO study_sessions(id,subject_id,started_at,ended_at,duration_minutes,content,raw_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              c.id,
              c.subjectId,
              start,
              end,
              c.durationMinutes,
              c.content || null,
              c.rawNote || null,
              now,
              now,
            );
          for (const item of c.points) {
            store.raw
              .prepare(
                "INSERT INTO study_session_points(session_id,knowledge_point_id,activity_type) VALUES(?,?,?)",
              )
              .run(c.id, item.id, item.activity);
            const p = getPoint(item.id).point;
            if (item.activity === "LEARN" && p.learningStage === "NOT_STARTED")
              store.raw
                .prepare(
                  "UPDATE knowledge_points SET learning_stage='IN_PROGRESS' WHERE id=?",
                )
                .run(item.id);
            event(
              item.id,
              item.activity === "TEST" ? "NOTE" : item.activity,
              { learningStage: p.learningStage },
              {
                durationMinutes: c.durationMinutes,
                content: c.content,
                activity: item.activity,
                learningStage:
                  item.activity === "LEARN" && p.learningStage === "NOT_STARTED"
                    ? "IN_PROGRESS"
                    : p.learningStage,
              },
              item.activity === "TEST"
                ? "记录测试活动；结果另行登记"
                : `记录${item.activity === "LEARN" ? "学习" : "复习"}活动`,
              { sessionId: c.id },
              end,
            );
            touch(item.id);
          }
          if (c.task)
            completeTaskFromRecord(
              store,
              c.commandId,
              c.task,
              { id: c.id, entity: "session" },
              clock,
            );
        } else if (c.action === "assessment") {
          const p = getPoint(c.pointId, c.expectedVersion).point;
          const at = occurred(c.occurredLocal);
          if (
            c.independent === true &&
            ((c.hintCount ?? 0) > 0 || c.answerViewed === true)
          )
            throw new AppError(
              400,
              "独立完成与提示/查看答案相冲突，请检查实际情况",
            );
          if (c.sessionId) {
            const session = readSessions(store).find(
              (s) => s.id === c.sessionId && !s.voided_at,
            );
            if (!session || !session.points.some((x) => x.id === c.pointId))
              throw new AppError(400, "关联日志无效或没有包含此知识点");
            if (at < session.started_at || at > session.ended_at)
              throw new AppError(400, "关联测试应发生在所选日志的起止时间内");
          }
          store.raw
            .prepare(
              "INSERT INTO assessments(id,knowledge_point_id,session_id,occurred_at,question_ref,question_description,response_excerpt,result,independent,hint_count,answer_viewed,task_type,difficulty,is_new_question,can_explain,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              c.id,
              c.pointId,
              c.sessionId,
              at,
              c.questionRef || null,
              c.question,
              c.response || null,
              c.result,
              c.independent === null ? null : Number(c.independent),
              c.hintCount,
              c.answerViewed === null ? null : Number(c.answerViewed),
              c.taskType,
              c.difficulty,
              c.isNew === null ? null : Number(c.isNew),
              c.canExplain === null ? null : Number(c.canExplain),
              c.note || null,
              now,
            );
          event(
            c.pointId,
            "TEST",
            null,
            {
              question: c.question,
              result: c.result,
              independent: c.independent,
              hintCount: c.hintCount,
              answerViewed: c.answerViewed,
              taskType: c.taskType,
              isNew: c.isNew,
              canExplain: c.canExplain,
              response: c.response,
            },
            "手动记录复测表现",
            { assessmentId: c.id },
            at,
          );
          if (c.error) {
            if (c.error.causeStatus !== "PENDING_EVIDENCE" && !c.error.cause)
              throw new AppError(400, "推测或确认错因时请填写依据");
            const eid = randomUUID();
            store.raw
              .prepare(
                "INSERT INTO error_records(id,knowledge_point_id,assessment_id,occurred_at,question_description,error_type,cause_status,cause,correction,pattern_key,resolution_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                eid,
                c.pointId,
                c.id,
                at,
                c.question,
                c.error.type,
                c.error.causeStatus,
                c.error.cause || null,
                c.error.correction || null,
                c.error.patternKey || null,
                c.error.correction ? "AWAITING_RETEST" : "OPEN",
                now,
                now,
              );
            event(
              c.pointId,
              "ERROR_CHANGED",
              null,
              c.error,
              "保存本次错误；解决状态需另行复测",
              { assessmentId: c.id, errorRecordId: eid },
              at,
            );
          }
          if (
            new Set(c.retests.map((x) => x.errorId)).size !== c.retests.length
          )
            throw new AppError(400, "同一错误不能重复关联");
          const a = readAssessments(c.pointId, store).find(
            (x) => x.id === c.id,
          )!;
          for (const retest of c.retests) {
            const e = getError(retest.errorId, retest.expectedVersion);
            if (
              e.knowledge_point_id !== c.pointId ||
              e.assessment_id === c.id ||
              e.occurred_at >= at
            )
              throw new AppError(
                400,
                "复测必须是该知识点在原错误之后的另一条测试",
              );
            if (e.resolution_status === "RESOLVED")
              throw new AppError(400, "该错误已经解决；再次出现请新建错误");
            if (
              retest.resolve &&
              (!independent(a) || retest.outcome !== "PASS")
            )
              throw new AppError(400, "只有本错误独立复测通过，才能确认解决");
            store.raw
              .prepare(
                "INSERT INTO error_retests(error_record_id,assessment_id,knowledge_point_id,outcome,created_at) VALUES(?,?,?,?,?)",
              )
              .run(e.id, c.id, c.pointId, retest.outcome, now);
            store.raw
              .prepare(
                "UPDATE error_records SET resolution_status=?,resolved_at=?,resolved_assessment_id=?,updated_at=?,version=version+1 WHERE id=?",
              )
              .run(
                retest.resolve ? "RESOLVED" : "AWAITING_RETEST",
                retest.resolve ? at : null,
                retest.resolve ? c.id : null,
                now,
                e.id,
              );
            event(
              c.pointId,
              "ERROR_CHANGED",
              e,
              {
                resolutionStatus: retest.resolve
                  ? "RESOLVED"
                  : "AWAITING_RETEST",
                outcome: retest.outcome,
              },
              retest.resolve
                ? "用户确认本错误独立复测通过"
                : "记录本错误的复测结果",
              { errorRecordId: e.id, assessmentId: c.id },
              at,
            );
          }
          if (c.state)
            updateState(c.pointId, {
              ...c.state,
              mode: "EVIDENCE",
              evidenceIds: [...new Set([...c.state.evidenceIds, c.id])],
            });
          if (c.forgetting !== undefined) {
            store.raw
              .prepare(
                "UPDATE knowledge_points SET suspected_forgetting=? WHERE id=?",
              )
              .run(Number(c.forgetting), c.pointId);
            event(
              c.pointId,
              "STATE_CHANGED",
              { suspectedForgetting: p.suspectedForgetting },
              { suspectedForgetting: c.forgetting },
              "用户确认遗忘风险标记",
              { assessmentId: c.id },
            );
          }
          if (c.task)
            completeTaskFromRecord(
              store,
              c.commandId,
              c.task,
              { id: c.id, entity: "assessment" },
              clock,
            );
          touch(c.pointId);
        } else if (c.action === "state") {
          getPoint(c.pointId, c.expectedVersion);
          updateState(c.pointId, c);
          touch(c.pointId);
        } else if (c.action === "error-correction") {
          const e = getError(c.id, c.expectedVersion);
          getPoint(e.knowledge_point_id);
          if (e.resolution_status === "RESOLVED")
            throw new AppError(409, "已解决错误只保留历史，新的问题请新建记录");
          if (c.causeStatus !== "PENDING_EVIDENCE" && !c.cause)
            throw new AppError(400, "请填写错因依据");
          store.raw
            .prepare(
              "UPDATE error_records SET error_type=?,cause_status=?,cause=?,correction=?,pattern_key=?,resolution_status=?,version=version+1,updated_at=? WHERE id=?",
            )
            .run(
              c.type,
              c.causeStatus,
              c.cause || null,
              c.correction || null,
              c.patternKey || null,
              c.correction ? "AWAITING_RETEST" : "OPEN",
              now,
              c.id,
            );
          event(
            e.knowledge_point_id,
            "ERROR_CHANGED",
            e,
            {
              errorType: c.type,
              causeStatus: c.causeStatus,
              cause: c.cause,
              correction: c.correction,
              resolutionStatus: c.correction ? "AWAITING_RETEST" : "OPEN",
            },
            "保存订正；尚未证明错误已解决",
            { errorRecordId: e.id },
          );
          touch(e.knowledge_point_id);
        } else {
          const table =
            c.entity === "session"
              ? "study_sessions"
              : c.entity === "assessment"
                ? "assessments"
                : "error_records";
          const before = store.raw
            .prepare(`SELECT * FROM ${table} WHERE id=?`)
            .get(c.id) as Record<string, unknown> | undefined;
          if (!before) throw new AppError(404, "记录不存在");
          if (before.voided_at) throw new AppError(409, "记录已作废");
          const points =
            c.entity === "session"
              ? (
                  store.raw
                    .prepare(
                      "SELECT DISTINCT knowledge_point_id FROM study_session_points WHERE session_id=?",
                    )
                    .all(c.id) as { knowledge_point_id: string }[]
                ).map((x) => x.knowledge_point_id)
              : [String(before.knowledge_point_id)];
          for (const pid of points) getPoint(pid);
          if (
            c.entity === "session" &&
            store.raw
              .prepare(
                "SELECT id FROM assessments WHERE session_id=? AND voided_at IS NULL",
              )
              .get(c.id)
          )
            throw new AppError(
              409,
              "此日志包含有效测试，请先处理测试，再作废日志",
            );
          if (
            c.entity === "session" &&
            store.raw
              .prepare(
                "SELECT id FROM learning_tasks WHERE completed_session_id=?",
              )
              .get(c.id)
          )
            throw new AppError(409, "此日志被完成任务引用，需先修正任务");
          if (
            c.entity === "error" &&
            store.raw
              .prepare(
                "SELECT assessment_id FROM error_retests WHERE error_record_id=?",
              )
              .get(c.id)
          )
            throw new AppError(
              409,
              "此错误已有复测记录，请保留历史，新增说明或另建错误",
            );
          if (c.entity === "assessment") {
            if (
              store.raw
                .prepare(
                  "SELECT id FROM learning_tasks WHERE completed_assessment_id=?",
                )
                .get(c.id)
            )
              throw new AppError(409, "此测试被完成任务引用，需先修正任务");
            const pid = points[0];
            const current = getPoint(pid).point;
            const stateEvents = store.db
              .select()
              .from(knowledgeEvents)
              .where(eq(knowledgeEvents.knowledgePointId, pid))
              .orderBy(desc(knowledgeEvents.sequence))
              .all()
              .filter((e) => e.eventType === "STATE_CHANGED" && e.afterJson);
            const latestState = stateEvents.find(
              (e) => JSON.parse(e.afterJson!).masteryLevel,
            );
            if (latestState) {
              const after = JSON.parse(latestState.afterJson!);
              const old = latestState.beforeJson
                ? JSON.parse(latestState.beforeJson)
                : {};
              if (
                current.masteryBasis === "EVIDENCE" &&
                after.evidenceIds?.includes(c.id) &&
                "ABCDE".indexOf(after.masteryLevel) >=
                  "ABCDE".indexOf(old.masteryLevel || "A")
              )
                throw new AppError(
                  409,
                  "此测试支撑当前等级。请先在“调整等级”中改为手动自评，或改用其他有效证据，再作废。",
                );
            }
            for (const e of readErrors(pid, store).filter(
              (e) => !e.voided_at && e.resolved_assessment_id === c.id,
            )) {
              store.raw
                .prepare(
                  "UPDATE error_records SET resolution_status='AWAITING_RETEST',resolved_at=NULL,resolved_assessment_id=NULL,version=version+1,updated_at=? WHERE id=?",
                )
                .run(now, e.id);
              event(
                pid,
                "ERROR_CHANGED",
                e,
                { resolutionStatus: "AWAITING_RETEST" },
                "解决依据已作废，恢复等待复测",
                { errorRecordId: e.id, assessmentId: c.id },
              );
            }
            const ownErrors = readErrors(pid, store).filter(
              (e) => !e.voided_at && e.assessment_id === c.id,
            );
            for (const e of ownErrors) {
              if (
                store.raw
                  .prepare(
                    "SELECT assessment_id FROM error_retests WHERE error_record_id=?",
                  )
                  .get(e.id)
              )
                throw new AppError(
                  409,
                  "此测试产生的错误已有后续复测，不能单独作废；请保留并补充说明",
                );
              store.raw
                .prepare(
                  "UPDATE error_records SET voided_at=?,void_reason=?,updated_at=?,version=version+1 WHERE id=?",
                )
                .run(now, c.reason, now, e.id);
              event(
                pid,
                "RECORD_CORRECTED",
                e,
                { voided: true },
                "原测试作废，连同产生的错误一起作废",
                { errorRecordId: e.id, assessmentId: c.id },
              );
            }
          }
          store.raw
            .prepare(
              `UPDATE ${table} SET voided_at=?,void_reason=? ${c.entity === "assessment" ? "" : ",updated_at=?,version=version+1"} WHERE id=?`,
            )
            .run(
              ...(c.entity === "assessment"
                ? [now, c.reason, c.id]
                : [now, c.reason, now, c.id]),
            );
          for (const pid of points) {
            event(
              pid,
              "RECORD_CORRECTED",
              before,
              { voided: true, reason: c.reason },
              c.reason,
              c.entity === "session"
                ? { sessionId: c.id }
                : c.entity === "assessment"
                  ? { assessmentId: c.id }
                  : { errorRecordId: c.id },
            );
            touch(pid);
          }
        }
        const response = {
          id: responseId,
          message:
            c.action === "void"
              ? "已作废，原记录与原因保留"
              : c.action === "state"
                ? c.targetLevel === "UNASSESSED"
                  ? "已标记暂未评估，原学习进度和复测历史保留"
                  : c.mode === "SELF_REPORTED"
                    ? "已保存手动自评，等级未经过复测确认"
                    : "已根据复测证据确认等级"
                : (c.action === "session" || c.action === "assessment") &&
                    c.task
                  ? "实际记录、任务完成及所选后续安排已保存"
                  : "已保存学习记录",
        };
        store.raw
          .prepare("INSERT INTO _command_receipts VALUES(?,?,?,?)")
          .run(c.commandId, hash, JSON.stringify(response), now);
        return response;
      })
      .immediate();
  } catch (e) {
    if (e instanceof AppError) throw e;
    const error = e as Error & { code?: string; cause?: { code?: string } };
    if ((error.code || error.cause?.code || "").includes("CONSTRAINT"))
      throw new AppError(
        409,
        "记录关联或编号冲突，未保存任何部分，请刷新后检查",
      );
    throw e;
  }
}
