import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import {
  createBackup,
  restoreDatabase,
  exportData,
} from "../src/server/backup";
import { openDatabase } from "../src/server/db/client";
import { executeCommand, pointDetail } from "../src/server/catalog";
import {
  executeLearning,
  readAssessments,
  readErrors,
} from "../src/server/learning";
import {
  executeTask,
  readTasks,
  readSuggestions,
  suggestionFor,
} from "../src/server/tasks";
import { reviewAdvice, addDays, validDay } from "../src/lib/review-policy";
const clock = new Date("2026-10-07T12:00:00Z");
const created = new Date("2026-10-07T00:00:00Z");
function setup(level = "B", file = ":memory:") {
  const store = openDatabase(file);
  const subject = randomUUID(),
    chapter = randomUUID(),
    point = randomUUID(),
    other = randomUUID();
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "subject",
      id: subject,
      name: "高数",
    },
    store,
  );
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "chapter",
      id: chapter,
      parentId: subject,
      name: "极限",
    },
    store,
  );
  for (const pid of [point, other])
    executeCommand(
      {
        commandId: randomUUID(),
        action: "create",
        entity: "point",
        id: pid,
        parentId: chapter,
        name: pid,
        initialLevel: level,
      },
      store,
    );
  const task = (overrides: Record<string, unknown> = {}) => ({
    commandId: randomUUID(),
    action: "create",
    id: randomUUID(),
    pointId: point,
    expectedPointVersion: pointDetail(point, store).point.version,
    kind: "REVIEW",
    dueOn: "2026-10-07",
    reason: "准备独立复测",
    ...overrides,
  });
  const assessment = (overrides: Record<string, unknown> = {}) => ({
    commandId: randomUUID(),
    action: "assessment",
    id: randomUUID(),
    pointId: point,
    expectedVersion: pointDetail(point, store).point.version,
    occurredLocal: "2026-10-07T10:00",
    question: "独立求极限",
    response: "过程记录",
    result: "PASS",
    independent: true,
    hintCount: 0,
    answerViewed: false,
    taskType: "TYPICAL",
    ...overrides,
  });
  return { store, subject, chapter, point, other, task, assessment };
}
test("日历建议、未知证据、提示依赖与旧记录日期", () => {
  assert.equal(validDay("2026-02-30"), false);
  assert.equal(addDays("2028-02-28", 2), "2028-03-01");
  const input = {
    today: "2026-10-07",
    anchorDay: "2026-10-07",
    forgetting: false,
    test: null,
    useTest: false,
  };
  for (const [level, days] of [
    ["B", 2],
    ["C", 5],
    ["D", 14],
    ["E", 30],
  ] as const)
    assert.equal(
      reviewAdvice({ ...input, level }).dueOn,
      addDays(input.today, days),
    );
  assert.equal(reviewAdvice({ ...input, level: "A" }).dueOn, null);
  assert.equal(
    reviewAdvice({
      ...input,
      level: "C",
      useTest: true,
      test: {
        result: "PASS",
        independent: null,
        hint_count: null,
        answer_viewed: null,
      },
    }).dueOn,
    null,
  );
  assert.equal(
    reviewAdvice({
      ...input,
      level: "E",
      useTest: true,
      test: { result: "PASS", independent: 0, hint_count: 1, answer_viewed: 0 },
    }).dueOn,
    "2026-10-08",
  );
  assert.match(
    reviewAdvice({ ...input, level: "C", anchorDay: "2026-09-01" }).reason,
    /较早/,
  );
  assert.equal(
    reviewAdvice({ ...input, level: "C", anchorDay: "2026-09-01" }).dueOn,
    input.today,
  );
});
test("手动任务去重、幂等、非法日期与乐观锁", () => {
  const f = setup();
  try {
    const t = f.task();
    executeTask(t, f.store, clock);
    executeTask(t, f.store, clock);
    assert.equal(readTasks(f.store).length, 1);
    assert.throws(() => executeTask(f.task(), f.store, clock), /已有待处理/);
    assert.throws(
      () => executeTask({ ...t, reason: "改内容" }, f.store, clock),
      /提交编号/,
    );
    const move = {
      commandId: randomUUID(),
      action: "reschedule",
      id: t.id,
      expectedVersion: 1,
      dueOn: "2026-10-09",
      reason: "调整节奏",
    };
    executeTask(move, f.store, clock);
    assert.throws(
      () => executeTask({ ...move, commandId: randomUUID() }, f.store, clock),
      /已被修改/,
    );
    assert.throws(
      () =>
        executeTask(
          {
            ...move,
            commandId: randomUUID(),
            expectedVersion: 2,
            dueOn: "2026-02-30",
          },
          f.store,
          clock,
        ),
      /日期无效/,
    );
    assert.throws(
      () =>
        executeTask(
          {
            ...move,
            commandId: randomUUID(),
            expectedVersion: 2,
            dueOn: "2026-10-06",
          },
          f.store,
          clock,
        ),
      /未来日期/,
    );
    assert.equal(readTasks(f.store)[0].due_on, "2026-10-09");
    assert.equal(readTasks(f.store)[0].reason, "调整节奏");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "B");
  } finally {
    f.store.close();
  }
});
test("建议需确认、过期依据拒绝、既有任务不被建议替换", () => {
  const f = setup();
  try {
    executeLearning(
      f.assessment({ occurredLocal: "2026-09-01T10:00" }),
      f.store,
      clock,
    );
    const s = suggestionFor(f.point, f.store, clock);
    assert.equal(s.dueOn, "2026-10-07");
    assert.equal(readTasks(f.store).length, 0);
    executeCommand(
      {
        commandId: randomUUID(),
        action: "edit",
        entity: "point",
        id: f.point,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        name: "新名称",
        description: "",
        importance: 3,
        learningStage: "IN_PROGRESS",
      },
      f.store,
    );
    assert.throws(
      () =>
        executeTask(
          {
            commandId: randomUUID(),
            action: "confirm",
            id: randomUUID(),
            pointId: f.point,
            token: s.token,
          },
          f.store,
          clock,
        ),
      /建议依据/,
    );
    const fresh = suggestionFor(f.point, f.store, clock);
    executeTask(
      {
        commandId: randomUUID(),
        action: "confirm",
        id: randomUUID(),
        pointId: f.point,
        token: fresh.token,
      },
      f.store,
      clock,
    );
    assert.equal(
      readSuggestions(f.store, clock).some((s) => s.pointId === f.point),
      false,
    );
    assert.equal(readTasks(f.store)[0].source, "RULE_CONFIRMED");
    assert.equal(readTasks(f.store)[0].rule_version, "review-v1");
  } finally {
    f.store.close();
  }
});
test("复测与错误、等级、任务、下一安排原子保存且失败不伪造通过", () => {
  const f = setup();
  try {
    const t = f.task();
    executeTask(t, f.store, created);
    const next = randomUUID();
    const c = f.assessment({
      task: { id: t.id, expectedVersion: 1, next: { id: next, mode: "RULE" } },
      state: { targetLevel: "C", reason: "典型题独立通过", evidenceIds: [] },
    });
    executeLearning(c, f.store, clock);
    executeLearning(c, f.store, clock);
    assert.equal(readAssessments(undefined, f.store).length, 1);
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    assert.equal(
      readTasks(f.store).find((x) => x.id === t.id)?.completed_assessment_id,
      c.id,
    );
    assert.equal(
      readTasks(f.store).find((x) => x.id === next)?.due_on,
      "2026-10-12",
    );
    const fail = f.assessment({
      occurredLocal: "2026-10-07T20:00",
      result: "FAIL",
      error: { type: "UNKNOWN" },
      task: {
        id: next,
        expectedVersion: 1,
        next: { id: randomUUID(), mode: "RULE" },
      },
    });
    executeLearning(fail, f.store, clock);
    assert.equal(readErrors(undefined, f.store)[0].resolution_status, "OPEN");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    assert.equal(
      readTasks(f.store).find((x) => x.status === "PENDING")?.due_on,
      "2026-10-08",
    );
    assert.equal(
      readAssessments(undefined, f.store).find((x) => x.id === fail.id)?.result,
      "FAIL",
    );
  } finally {
    f.store.close();
  }
});
test("任务跨点、陈旧版本或非法下一安排使整次复测回滚", () => {
  const f = setup();
  try {
    const t = f.task();
    executeTask(t, f.store, created);
    for (const extra of [
      { pointId: f.other, expectedVersion: 1 },
      { task: { id: t.id, expectedVersion: 2 } },
      {
        task: {
          id: t.id,
          expectedVersion: 1,
          next: {
            id: randomUUID(),
            mode: "MANUAL",
            dueOn: "2026-10-01",
            reason: "无效过去日期",
          },
        },
      },
    ]) {
      assert.throws(() =>
        executeLearning(
          f.assessment({
            task: { id: t.id, expectedVersion: 1 },
            error: { type: "UNKNOWN" },
            ...extra,
          }),
          f.store,
          clock,
        ),
      );
      assert.equal(readAssessments(undefined, f.store).length, 0);
      assert.equal(readErrors(undefined, f.store).length, 0);
      assert.equal(readTasks(f.store)[0].status, "PENDING");
    }
  } finally {
    f.store.close();
  }
});
test("学习任务需实际 LEARN 日志，不能用旧记录或其他知识点充数", () => {
  const f = setup("A");
  try {
    const t = f.task({ kind: "LEARN" });
    executeTask(t, f.store, created);
    const session = (activity = "LEARN", point = f.point) => ({
      commandId: randomUUID(),
      action: "session",
      id: randomUUID(),
      subjectId: f.subject,
      startedLocal: "2026-10-07T09:00",
      endedLocal: "2026-10-07T09:30",
      durationMinutes: 30,
      points: [
        {
          id: point,
          expectedVersion: pointDetail(point, f.store).point.version,
          activity,
        },
      ],
      task: { id: t.id, expectedVersion: 1 },
    });
    assert.throws(
      () => executeLearning(session("REVIEW"), f.store, clock),
      /没有此知识点/,
    );
    assert.throws(
      () => executeLearning(session("LEARN", f.other), f.store, clock),
      /没有此知识点/,
    );
    assert.throws(
      () =>
        executeLearning(
          f.assessment({ task: { id: t.id, expectedVersion: 1 } }),
          f.store,
          clock,
        ),
      /学习任务需/,
    );
    const c = session();
    executeLearning(c, f.store, clock);
    assert.equal(readTasks(f.store)[0].completed_session_id, c.id);
    assert.equal(readAssessments(undefined, f.store).length, 0);
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "A");
    assert.throws(
      () =>
        executeLearning(
          {
            commandId: randomUUID(),
            action: "void",
            entity: "session",
            id: c.id,
            reason: "误录",
          },
          f.store,
          clock,
        ),
      /完成任务引用/,
    );
    executeTask(
      {
        commandId: randomUUID(),
        action: "reopen",
        id: t.id,
        expectedVersion: 2,
        reason: "修正完成依据",
      },
      f.store,
      clock,
    );
    executeLearning(
      {
        commandId: randomUUID(),
        action: "void",
        entity: "session",
        id: c.id,
        reason: "误录",
      },
      f.store,
      clock,
    );
    assert.equal(readTasks(f.store)[0].status, "PENDING");
    assert.ok(
      pointDetail(f.point, f.store).events.some(
        (e) => e.beforeJson?.includes(c.id) && e.eventType === "TASK_CHANGED",
      ),
    );
  } finally {
    f.store.close();
  }
});
test("完成引用已有有效测试、未知不自动排程、历史纠正与归档取消", () => {
  const f = setup();
  try {
    const old = f.assessment({ occurredLocal: "2026-10-06T10:00" });
    executeLearning(old, f.store, clock);
    const t = f.task();
    executeTask(t, f.store, created);
    const complete = (recordId: string) => ({
      commandId: randomUUID(),
      action: "complete",
      id: t.id,
      expectedVersion: 1,
      recordId,
    });
    assert.throws(
      () => executeTask(complete(old.id), f.store, clock),
      /安排之后/,
    );
    const current = f.assessment({
      independent: null,
      hintCount: null,
      answerViewed: null,
    });
    executeLearning(current, f.store, clock);
    assert.throws(
      () =>
        executeTask(
          { ...complete(current.id), next: { id: randomUUID(), mode: "RULE" } },
          f.store,
          clock,
        ),
      /手动/,
    );
    assert.equal(readTasks(f.store)[0].status, "PENDING");
    executeTask(complete(current.id), f.store, clock);
    assert.equal(readTasks(f.store)[0].status, "COMPLETED");
    const next = f.task();
    executeTask(next, f.store, clock);
    assert.throws(
      () =>
        executeTask(
          {
            commandId: randomUUID(),
            action: "reopen",
            id: t.id,
            expectedVersion: 2,
            reason: "修正",
          },
          f.store,
          clock,
        ),
      /已有下一任务/,
    );
    executeCommand(
      {
        commandId: randomUUID(),
        action: "archive",
        entity: "point",
        id: f.point,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        reason: "移出学习范围",
      },
      f.store,
    );
    assert.equal(
      readTasks(f.store).find((x) => x.id === next.id)?.status,
      "CANCELLED",
    );
    assert.equal(
      readTasks(f.store).find((x) => x.id === t.id)?.status,
      "COMPLETED",
    );
    assert.equal(
      readSuggestions(f.store, clock).some((x) => x.pointId === f.point),
      false,
    );
  } finally {
    f.store.close();
  }
});
test("本地日期、逾期排序与近 14 天错误边界", () => {
  const f = setup();
  try {
    const t = f.task();
    executeTask(t, f.store, new Date("2026-10-06T15:59:59Z"));
    // 16:00 UTC is the next Shanghai calendar date.
    assert.equal(
      suggestionFor(f.other, f.store, new Date("2026-10-06T16:00:00Z")).dueOn,
      null,
    );
    executeLearning(
      f.assessment({
        pointId: f.other,
        expectedVersion: 1,
        occurredLocal: "2026-10-07T00:01",
        result: "FAIL",
        error: { type: "UNKNOWN" },
      }),
      f.store,
      clock,
    );
    const t2 = f.task({
      pointId: f.other,
      expectedPointVersion: pointDetail(f.other, f.store).point.version,
    });
    executeTask(t2, f.store, clock);
    assert.equal(readTasks(f.store, clock)[0].id, t2.id);
    assert.equal(readTasks(f.store, clock)[0].recent_errors, 1);
    executeTask(
      {
        commandId: randomUUID(),
        action: "reschedule",
        id: t.id,
        expectedVersion: 1,
        dueOn: "2026-10-08",
        reason: "改期",
      },
      f.store,
      clock,
    );
    assert.equal(readTasks(f.store, clock)[1].due_on, "2026-10-08");
    assert.equal(
      readTasks(f.store, new Date("2026-10-22T12:00:00Z"))[0].recent_errors,
      0,
    );
  } finally {
    f.store.close();
  }
});

test("任务闭环重启与快照恢复保留日期、完成依据和历史", async () => {
  const root = path.resolve("work/test-databases");
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(path.join(root, "tasks-"));
  const file = path.join(folder, "study.sqlite");
  const f = setup("B", file);
  const t = f.task();
  executeTask(t, f.store, created);
  const assessment = f.assessment({
    task: {
      id: t.id,
      expectedVersion: 1,
      next: { id: randomUUID(), mode: "RULE" },
    },
  });
  executeLearning(assessment, f.store, clock);
  const original = exportData(f.store);
  const backup = await createBackup(
    f.store,
    path.join(folder, "snapshot.sqlite"),
  );
  f.store.close();
  const reopened = openDatabase(file);
  try {
    assert.deepEqual(exportData(reopened).tables, original.tables);
  } finally {
    reopened.close();
  }
  const restore = path.join(folder, "restored.sqlite");
  await restoreDatabase(backup, restore);
  const restored = openDatabase(restore);
  try {
    assert.deepEqual(exportData(restored).tables, original.tables);
    const tasks = readTasks(restored, clock);
    assert.equal(tasks.length, 2);
    assert.equal(
      tasks.find((t) => t.status === "COMPLETED")?.completed_assessment_id,
      assessment.id,
    );
    assert.equal(
      tasks.find((t) => t.status === "PENDING")?.due_on,
      "2026-10-09",
    );
  } finally {
    restored.close();
  }
});
