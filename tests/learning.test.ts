import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/server/db/client";
import { executeCommand, pointDetail, AppError } from "../src/server/catalog";
import {
  executeLearning,
  readSessions,
  readAssessments,
  readErrors,
} from "../src/server/learning";
import { parseLocal } from "../src/lib/dates";
const clock = new Date("2026-10-06T12:00:00.000Z");
function setup(level = "B") {
  const store = openDatabase(":memory:");
  const subject = randomUUID(),
    chapter = randomUUID(),
    point = randomUUID(),
    other = randomUUID();
  executeCommand(
    {
      action: "create",
      entity: "subject",
      commandId: randomUUID(),
      id: subject,
      name: "高数",
    },
    store,
  );
  executeCommand(
    {
      action: "create",
      entity: "chapter",
      commandId: randomUUID(),
      id: chapter,
      parentId: subject,
      name: "极限",
    },
    store,
  );
  for (const pid of [point, other])
    executeCommand(
      {
        action: "create",
        entity: "point",
        commandId: randomUUID(),
        id: pid,
        parentId: chapter,
        name: pid === point ? "洛必达" : "连续性",
        initialLevel: level,
      },
      store,
    );
  const run = (c: unknown) => executeLearning(c, store, clock);
  const assessment = (overrides: Record<string, unknown> = {}) => ({
    action: "assessment",
    id: randomUUID(),
    commandId: randomUUID(),
    pointId: point,
    expectedVersion: pointDetail(point, store).point.version,
    occurredLocal: "2026-10-06T10:00",
    question: "判断洛必达适用条件",
    result: "PASS",
    taskType: "TYPICAL",
    independent: true,
    hintCount: 0,
    answerViewed: false,
    isNew: true,
    canExplain: true,
    ...overrides,
  });
  return { store, subject, chapter, point, other, run, assessment };
}
test("一次学习关联两个知识点，用时只累计一次；时区与跨日校验", () => {
  const f = setup();
  try {
    const command = {
      action: "session",
      id: randomUUID(),
      commandId: randomUUID(),
      subjectId: f.subject,
      startedLocal: "2026-10-06T09:00",
      endedLocal: "2026-10-06T09:30",
      durationMinutes: 30,
      points: [f.point, f.other].map((id) => ({
        id,
        expectedVersion: 1,
        activity: "LEARN",
      })),
    };
    f.run(command);
    f.run(command);
    const sessions = readSessions(f.store);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].points.length, 2);
    assert.equal(
      sessions.reduce((n, s) => n + s.duration_minutes, 0),
      30,
    );
    assert.equal(sessions[0].started_at, "2026-10-06T01:00:00.000Z");
    assert.throws(
      () =>
        f.run({
          ...command,
          id: randomUUID(),
          commandId: randomUUID(),
          startedLocal: "2026-10-05T23:50",
          endedLocal: "2026-10-06T00:20",
        }),
      /跨日/,
    );
    assert.throws(
      () => parseLocal("2026-02-30T10:00", "Asia/Shanghai"),
      /无效/,
    );
  } finally {
    f.store.close();
  }
});
test("有提示或证据未知不能升级，整个复测事务回滚；通过典型题才 B→C", () => {
  const f = setup();
  try {
    const invalid = f.assessment({
      independent: false,
      hintCount: 1,
      state: { targetLevel: "C", reason: "请求升级" },
    });
    assert.throws(() => f.run(invalid), /独立通过/);
    assert.equal(readAssessments(f.point, f.store).length, 0);
    assert.throws(
      () =>
        f.run(
          f.assessment({
            independent: null,
            hintCount: null,
            state: { targetLevel: "C", reason: "请求升级" },
          }),
        ),
      /独立通过/,
    );
    f.run(
      f.assessment({ state: { targetLevel: "C", reason: "典型题独立完成" } }),
    );
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    assert.equal(pointDetail(f.point, f.store).point.masteryBasis, "EVIDENCE");
  } finally {
    f.store.close();
  }
});
test("手动自评可跨级升降至任意等级，保留自评来源且不制造复测事实", () => {
  const f = setup("A");
  try {
    for (const targetLevel of ["C", "E", "D", "B", "A"]) {
      const before = pointDetail(f.point, f.store).point;
      const command = {
        action: "state",
        mode: "SELF_REPORTED",
        commandId: randomUUID(),
        pointId: f.point,
        expectedVersion: before.version,
        targetLevel,
        reason: "根据实际情况更新个人自评",
      };
      f.run(command);
      f.run(command);
      const after = pointDetail(f.point, f.store).point;
      assert.equal(after.masteryLevel, targetLevel);
      assert.equal(after.masteryBasis, "SELF_REPORTED");
      assert.equal(after.version, before.version + 1);
      const events = f.store.raw
        .prepare(
          "SELECT before_json,after_json,reason,assessment_id,rule_version FROM knowledge_events WHERE command_id=?",
        )
        .all(command.commandId) as {
        before_json: string;
        after_json: string;
        reason: string;
        assessment_id: string | null;
        rule_version: string;
      }[];
      assert.equal(events.length, 1);
      assert.equal(
        JSON.parse(events[0].before_json).masteryLevel,
        before.masteryLevel,
      );
      assert.equal(JSON.parse(events[0].after_json).masteryLevel, targetLevel);
      assert.equal(
        JSON.parse(events[0].after_json).adjustmentMode,
        "SELF_REPORTED",
      );
      assert.deepEqual(JSON.parse(events[0].after_json).evidenceIds, []);
      assert.equal(events[0].assessment_id, null);
      assert.equal(events[0].reason, command.reason);
      assert.equal(events[0].rule_version, "mastery-v2");
      assert.throws(
        () => f.run({ ...command, commandId: randomUUID() }),
        (e) => e instanceof AppError && e.status === 409,
      );
    }
    assert.equal(readAssessments(f.point, f.store).length, 0);
    assert.equal(readSessions(f.store).length, 0);
    assert.equal(readErrors(f.point, f.store).length, 0);
    const tasks = f.store.raw
      .prepare("SELECT count(*) AS n FROM learning_tasks")
      .get() as { n: number };
    assert.equal(tasks.n, 0);
  } finally {
    f.store.close();
  }
});
test("已有等级可改回暂未评估，保留实际进度、测试、错误和旧历史，之后可重新确认", () => {
  const f = setup("A");
  try {
    const passed = f.assessment({
      state: { targetLevel: "C", reason: "典型题独立通过" },
    });
    f.run(passed);
    f.run({
      action: "session",
      commandId: randomUUID(),
      id: randomUUID(),
      subjectId: f.subject,
      startedLocal: "2026-10-06T09:00",
      endedLocal: "2026-10-06T09:30",
      durationMinutes: 20,
      points: [
        {
          id: f.point,
          expectedVersion: pointDetail(f.point, f.store).point.version,
          activity: "LEARN",
        },
      ],
    });
    const before = pointDetail(f.point, f.store),
      tests = readAssessments(f.point, f.store),
      sessions = readSessions(f.store);
    const command = {
      action: "state",
      commandId: randomUUID(),
      mode: "SELF_REPORTED",
      pointId: f.point,
      expectedVersion: before.point.version,
      targetLevel: "UNASSESSED",
      reason: "只提到了名称，相关内容尚未介绍",
    };
    assert.throws(() => f.run({ ...command, reason: "" }), /原因/);
    assert.throws(
      () => f.run({ ...command, mode: "EVIDENCE", evidenceIds: [passed.id] }),
      /暂未评估请使用手动自评/,
    );
    const result = f.run(command);
    f.run(command);
    assert.match(result.message, /暂未评估/);
    const after = pointDetail(f.point, f.store);
    assert.equal(after.point.masteryBasis, "UNASSESSED");
    assert.equal(after.point.masteryLevel, "A");
    assert.equal(after.point.learningStage, before.point.learningStage);
    assert.equal(after.point.version, before.point.version + 1);
    assert.deepEqual(readAssessments(f.point, f.store), tests);
    assert.deepEqual(readSessions(f.store), sessions);
    assert.deepEqual(readErrors(f.point, f.store), []);
    assert.equal(after.events.length, before.events.length + 1);
    const latest = after.events[0];
    assert.equal(JSON.parse(latest.afterJson!).masteryBasis, "UNASSESSED");
    assert.deepEqual(JSON.parse(latest.afterJson!).evidenceIds, []);
    assert.equal(JSON.parse(latest.beforeJson!).masteryBasis, "EVIDENCE");
    assert.throws(
      () => f.run({ ...command, commandId: randomUUID() }),
      (e) => e instanceof AppError && e.status === 409,
    );
    f.run({
      ...command,
      commandId: randomUUID(),
      mode: "EVIDENCE",
      targetLevel: "C",
      expectedVersion: after.point.version,
      evidenceIds: [passed.id],
    });
    assert.equal(pointDetail(f.point, f.store).point.masteryBasis, "EVIDENCE");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
  } finally {
    f.store.close();
  }
});
test("两种方式不可混淆：自评要求原因且拒绝关联证据，复测确认不能无证据", () => {
  const f = setup("A");
  try {
    const assessment = f.assessment();
    f.run(assessment);
    const command = {
      action: "state",
      mode: "SELF_REPORTED",
      commandId: randomUUID(),
      pointId: f.point,
      expectedVersion: pointDetail(f.point, f.store).point.version,
      targetLevel: "C",
      reason: "本人自评",
    };
    assert.throws(() => f.run({ ...command, reason: "  " }), /原因/);
    assert.throws(
      () => f.run({ ...command, evidenceIds: [assessment.id] }),
      /手动自评不关联/,
    );
    assert.throws(() => f.run({ ...command, mode: "UNKNOWN" }), AppError);
    assert.throws(
      () => f.run({ ...command, mode: "EVIDENCE", targetLevel: "B" }),
      /关联有效测试证据/,
    );
    assert.throws(
      () => f.run({ ...command, mode: "EVIDENCE", targetLevel: "C" }),
      /独立通过/,
    );
    assert.throws(
      () =>
        f.run(
          f.assessment({
            state: {
              targetLevel: "E",
              mode: "SELF_REPORTED",
              reason: "不能绕过复测确认",
            },
          }),
        ),
      AppError,
    );
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "A");
    assert.equal(readAssessments(f.point, f.store).length, 1);
  } finally {
    f.store.close();
  }
});
test("相同等级可在自评与复测确认间切换，旧依据和历史保留", () => {
  const f = setup("A");
  try {
    const adjust = (mode: string, evidenceIds: string[] = []) =>
      f.run({
        action: "state",
        mode,
        commandId: randomUUID(),
        pointId: f.point,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        targetLevel: "C",
        reason: "确认本次调整方式",
        evidenceIds,
      });
    adjust("SELF_REPORTED");
    const assessment = f.assessment();
    f.run(assessment);
    adjust("EVIDENCE", [assessment.id]);
    assert.equal(pointDetail(f.point, f.store).point.masteryBasis, "EVIDENCE");
    assert.throws(
      () =>
        f.run({
          action: "void",
          entity: "assessment",
          id: assessment.id,
          commandId: randomUUID(),
          reason: "误录",
        }),
      /支撑当前等级/,
    );
    adjust("SELF_REPORTED");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    assert.equal(
      pointDetail(f.point, f.store).point.masteryBasis,
      "SELF_REPORTED",
    );
    assert.equal(readAssessments(f.point, f.store).length, 1);
    assert.equal(readAssessments(f.point, f.store)[0].voided_at, null);
    const history = f.store.raw
      .prepare(
        "SELECT after_json FROM knowledge_events WHERE knowledge_point_id=? AND event_type='STATE_CHANGED' ORDER BY sequence DESC",
      )
      .all(f.point) as { after_json: string }[];
    assert.deepEqual(
      history.slice(0, 3).map((e) => JSON.parse(e.after_json).adjustmentMode),
      ["SELF_REPORTED", "EVIDENCE", "SELF_REPORTED"],
    );
    assert.deepEqual(JSON.parse(history[1].after_json).evidenceIds, [
      assessment.id,
    ]);
  } finally {
    f.store.close();
  }
});
test("复测确认可从 A 跨级到 C 或 D，保留目标证据要求与调整历史", () => {
  for (const targetLevel of ["C", "D"] as const) {
    const f = setup("A");
    try {
      const command = {
        action: "state",
        commandId: randomUUID(),
        pointId: f.point,
        expectedVersion: 1,
        targetLevel,
        reason: "根据实际测试直接确认目标等级",
        evidenceIds: [] as string[],
      };
      assert.throws(() => f.run(command), /独立通过/);
      assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "A");
      assert.equal(pointDetail(f.point, f.store).point.version, 1);

      const assessment = f.assessment({
        taskType: targetLevel === "C" ? "TYPICAL" : "TRANSFER",
      });
      f.run(assessment);
      const confirmed = {
        ...command,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        evidenceIds: [assessment.id],
      };
      f.run(confirmed);
      f.run(confirmed);
      const detail = pointDetail(f.point, f.store);
      assert.equal(detail.point.masteryLevel, targetLevel);
      assert.equal(detail.point.masteryBasis, "EVIDENCE");
      assert.equal(detail.point.version, confirmed.expectedVersion + 1);
      const events = f.store.raw
        .prepare(
          "SELECT before_json,after_json,reason,assessment_id FROM knowledge_events WHERE command_id=?",
        )
        .all(confirmed.commandId) as {
        before_json: string;
        after_json: string;
        reason: string;
        assessment_id: string;
      }[];
      assert.equal(events.length, 1);
      assert.equal(JSON.parse(events[0].before_json).masteryLevel, "A");
      assert.equal(JSON.parse(events[0].after_json).masteryLevel, targetLevel);
      assert.deepEqual(JSON.parse(events[0].after_json).evidenceIds, [
        assessment.id,
      ]);
      assert.equal(events[0].reason, command.reason);
      assert.equal(events[0].assessment_id, assessment.id);
      assert.throws(
        () => f.run({ ...confirmed, commandId: randomUUID() }),
        (e) => e instanceof AppError && e.status === 409,
      );
    } finally {
      f.store.close();
    }
  }
});
test("复测时可同时跨级确认 D，单次测试仍不能直接确认 E", () => {
  const f = setup("A");
  try {
    f.run(
      f.assessment({
        taskType: "VARIANT",
        state: { targetLevel: "D", reason: "新变式独立通过并解释思路" },
      }),
    );
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "D");
    assert.equal(pointDetail(f.point, f.store).point.masteryBasis, "EVIDENCE");
    assert.throws(
      () =>
        f.run(
          f.assessment({
            occurredLocal: "2026-10-06T11:00",
            taskType: "TRANSFER",
            state: { targetLevel: "E", reason: "仍需延迟复测" },
          }),
        ),
      /两次/,
    );
    assert.equal(readAssessments(f.point, f.store).length, 1);
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "D");
  } finally {
    f.store.close();
  }
});
test("未知错因保持待证据；订正不能直接解决；有提示复测不能解决", () => {
  const f = setup("C");
  try {
    f.run(
      f.assessment({
        result: "FAIL",
        independent: false,
        occurredLocal: "2026-10-05T10:00",
        error: {},
        forgetting: true,
      }),
    );
    let error = readErrors(f.point, f.store)[0];
    assert.equal(error.error_type, "UNKNOWN");
    assert.equal(error.cause_status, "PENDING_EVIDENCE");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    f.run({
      action: "error-correction",
      commandId: randomUUID(),
      id: error.id,
      expectedVersion: error.version,
      type: "CONDITION",
      causeStatus: "CONFIRMED",
      cause: "作答未检查未定式，用户确认",
      correction: "先判断类型",
    });
    error = readErrors(f.point, f.store)[0];
    assert.equal(error.resolution_status, "AWAITING_RETEST");
    assert.throws(
      () =>
        f.run(
          f.assessment({
            independent: false,
            hintCount: 1,
            retests: [
              {
                errorId: error.id,
                expectedVersion: error.version,
                outcome: "PASS",
                resolve: true,
              },
            ],
          }),
        ),
      /独立复测通过/,
    );
    assert.equal(readAssessments(f.point, f.store).length, 1);
    const passed = f.assessment({
      retests: [
        {
          errorId: error.id,
          expectedVersion: error.version,
          outcome: "PASS",
          resolve: true,
        },
      ],
      forgetting: false,
    });
    f.run(passed);
    assert.equal(readErrors(f.point, f.store)[0].resolution_status, "RESOLVED");
    f.run({
      action: "void",
      entity: "assessment",
      id: passed.id,
      commandId: randomUUID(),
      reason: "复测结果录错",
    });
    assert.equal(
      readErrors(f.point, f.store)[0].resolution_status,
      "AWAITING_RETEST",
    );
    assert.ok(
      readAssessments(f.point, f.store).find((a) => a.id === passed.id)
        ?.voided_at,
    );
  } finally {
    f.store.close();
  }
});
test("复测不能跨知识点解决错误，原错误同一时刻测试也不接受", () => {
  const f = setup();
  try {
    f.run(f.assessment({ result: "FAIL", error: {} }));
    const e = readErrors(f.point, f.store)[0];
    assert.throws(
      () =>
        f.run(
          f.assessment({
            pointId: f.other,
            expectedVersion: 1,
            occurredLocal: "2026-10-06T11:00",
            retests: [
              {
                errorId: e.id,
                expectedVersion: 1,
                outcome: "PASS",
                resolve: true,
              },
            ],
          }),
        ),
      /该知识点/,
    );
    assert.throws(
      () =>
        f.run(
          f.assessment({
            retests: [
              {
                errorId: e.id,
                expectedVersion: 1,
                outcome: "PASS",
                resolve: true,
              },
            ],
          }),
        ),
      /原错误之后/,
    );
  } finally {
    f.store.close();
  }
});
test("E 需要延迟证据；连续刷题不能 E，间隔八天独立新变式可以 E", () => {
  const f = setup("D");
  try {
    const first = f.assessment({
      occurredLocal: "2026-09-20T10:00",
      taskType: "VARIANT",
    });
    f.run(first);
    assert.throws(
      () =>
        f.run(
          f.assessment({
            occurredLocal: "2026-09-21T10:00",
            taskType: "VARIANT",
            state: {
              targetLevel: "E",
              reason: "太快",
              evidenceIds: [first.id],
            },
          }),
        ),
      /不足 7/,
    );
    const last = f.assessment({
      occurredLocal: "2026-09-28T10:00",
      taskType: "TRANSFER",
      state: {
        targetLevel: "E",
        reason: "延迟后依然独立完成",
        evidenceIds: [first.id],
      },
    });
    f.run(last);
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "E");
    assert.throws(
      () =>
        f.run({
          action: "void",
          entity: "assessment",
          id: first.id,
          commandId: randomUUID(),
          reason: "误录",
        }),
      /支撑当前等级/,
    );
  } finally {
    f.store.close();
  }
});
test("延迟复测期间有学习活动，不能把测试间隔当成无练习间隔", () => {
  const f = setup("D");
  try {
    const first = f.assessment({
      occurredLocal: "2026-09-20T10:00",
      taskType: "VARIANT",
    });
    f.run(first);
    f.run({
      action: "session",
      id: randomUUID(),
      commandId: randomUUID(),
      subjectId: f.subject,
      startedLocal: "2026-09-27T09:00",
      endedLocal: "2026-09-27T09:30",
      durationMinutes: 30,
      points: [
        {
          id: f.point,
          expectedVersion: pointDetail(f.point, f.store).point.version,
          activity: "REVIEW",
        },
      ],
    });
    assert.throws(
      () =>
        f.run(
          f.assessment({
            occurredLocal: "2026-09-28T10:00",
            taskType: "VARIANT",
            state: {
              targetLevel: "E",
              reason: "仍有近期复习",
              evidenceIds: [first.id],
            },
          }),
        ),
      /不足 7/,
    );
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "D");
  } finally {
    f.store.close();
  }
});
test("复测重复提交幂等，过期版本和未来时间拒绝", () => {
  const f = setup();
  try {
    const c = f.assessment();
    f.run(c);
    f.run(c);
    assert.equal(readAssessments(f.point, f.store).length, 1);
    assert.throws(
      () => f.run({ ...c, id: randomUUID(), commandId: randomUUID() }),
      (e) => e instanceof AppError && e.status === 409,
    );
    assert.throws(
      () => f.run(f.assessment({ occurredLocal: "2026-10-07T12:00" })),
      /尚未发生/,
    );
  } finally {
    f.store.close();
  }
});
