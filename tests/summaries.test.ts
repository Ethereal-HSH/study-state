import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, businessTables } from "../src/server/db/client";
import { executeCommand, pointDetail } from "../src/server/catalog";
import { executeLearning } from "../src/server/learning";
import { executeTask } from "../src/server/tasks";
import {
  buildSummary,
  writeSummary,
  parseSummaryFilter,
} from "../src/server/summaries";
import {
  summaryMarkdown,
  summaryDays,
  narrativeMarkdown,
  summaryCoverage,
  summaryRecords,
  summarySchemaFor,
} from "../src/lib/summary-models";

const clock = new Date("2026-10-13T12:00:00Z");
function fixture() {
  const store = openDatabase(":memory:");
  const subject = randomUUID(),
    foreign = randomUUID(),
    chapter = randomUUID(),
    otherChapter = randomUUID(),
    foreignChapter = randomUUID(),
    point = randomUUID(),
    other = randomUUID(),
    secret = randomUUID();
  for (const [id, name] of [
    [subject, "电力电子"],
    [foreign, "不可外发科目"],
  ])
    executeCommand(
      {
        action: "create",
        entity: "subject",
        commandId: randomUUID(),
        id,
        name,
      },
      store,
    );
  for (const [id, parentId, name] of [
    [chapter, subject, "器件"],
    [otherChapter, subject, "变流"],
    [foreignChapter, foreign, "范围外章节"],
  ])
    executeCommand(
      {
        action: "create",
        entity: "chapter",
        commandId: randomUUID(),
        id,
        parentId,
        name,
      },
      store,
    );
  for (const [id, parentId, name] of [
    [point, chapter, "损耗"],
    [other, otherChapter, "整流"],
    [secret, foreignChapter, "范围外秘密知识点"],
  ])
    executeCommand(
      {
        action: "create",
        entity: "point",
        commandId: randomUUID(),
        id,
        parentId,
        name,
      },
      store,
    );
  const version = (id: string) => pointDetail(id, store).point.version;
  function session(
    ids = [point, other],
    day = "2026-10-06",
    overrides: Record<string, unknown> = {},
  ) {
    const command = {
      action: "session",
      commandId: randomUUID(),
      id: randomUUID(),
      subjectId: subject,
      startedLocal: day + "T09:00",
      endedLocal: day + "T09:40",
      durationMinutes: 30,
      content: "计算器件损耗，并比较整流电路",
      points: ids.map((id) => ({
        id,
        expectedVersion: version(id),
        activity: "LEARN",
      })),
      ...overrides,
    };
    executeLearning(command, store, clock);
    return command;
  }
  function assessment(overrides: Record<string, unknown> = {}) {
    const command = {
      action: "assessment",
      commandId: randomUUID(),
      id: randomUUID(),
      pointId: point,
      expectedVersion: version(point),
      occurredLocal: "2026-10-06T11:00",
      question: "计算开关损耗",
      result: "PASS",
      taskType: "TYPICAL",
      independent: true,
      hintCount: 0,
      answerViewed: false,
      ...overrides,
    };
    executeLearning(command, store, clock);
    return command;
  }
  const filter = {
    from: "2026-10-06",
    to: "2026-10-06",
    subjectId: subject,
    chapterId: null,
  };
  const report = (patch = {}) =>
    buildSummary({ ...filter, ...patch }, store, clock);
  return {
    store,
    subject,
    chapter,
    otherChapter,
    point,
    other,
    secret,
    session,
    assessment,
    filter,
    report,
    version,
  };
}
test("总结按时区包含起止日，跨知识点日志时间仅计一次，章节范围明确共享日志", () => {
  const f = fixture();
  try {
    f.session();
    f.session([f.point], "2026-10-06", {
      startedLocal: "2026-10-06T00:05",
      endedLocal: "2026-10-06T00:15",
      durationMinutes: 10,
    });
    f.session([f.point], "2026-10-05");
    f.session([f.point], "2026-10-07");
    const all = f.report();
    assert.equal(all.stats.sessions, 2);
    assert.equal(all.stats.minutes, 40);
    assert.equal(all.stats.recordedPoints, 2);
    assert.equal(all.stats.sharedSessions, 0);
    const chapter = f.report({ chapterId: f.chapter });
    assert.equal(chapter.stats.minutes, 40);
    assert.equal(chapter.stats.sharedSessions, 1);
    assert.deepEqual(chapter.sessions[0].pointNames, ["损耗"]);
    assert.ok(!chapter.points.some((x) => x.id === f.other));
    assert.equal(f.report({ from: null, to: null }).stats.minutes, 100);
  } finally {
    f.store.close();
  }
});
test("事实和 GPT 草稿按学习日期分组，日期降序，各天内容与跨日观察分开", () => {
  const f = fixture();
  try {
    const first = f.session([f.point], "2026-10-06", { content: "第一天内容" });
    const second = f.session([f.point], "2026-10-07", {
      content: "第二天内容",
    });
    f.assessment({ question: "第一天复测" });
    const r = f.report({ to: "2026-10-07" });
    r.importedRecords.push({
      id: randomUUID(),
      day: null,
      pointIds: [f.point],
      pointNames: ["损耗"],
      content: "日期未知的内容",
    });
    assert.deepEqual(summaryDays(r), ["2026-10-07", "2026-10-06", null]);
    const md = summaryMarkdown(r);
    const day2 = md.split("### 2026-10-07\n")[1].split("### 2026-10-06\n")[0];
    const day1 = md
      .split("### 2026-10-06\n")[1]
      .split("### 学习日期未登记\n")[0];
    assert.match(day2, /第二天内容/);
    assert.doesNotMatch(day2, /第一天/);
    assert.match(day1, /第一天内容/);
    assert.match(day1, /第一天复测/);
    assert.doesNotMatch(day1, /第二天内容|日期未知的内容/);
    const narrative = narrativeMarkdown(
      {
        overview: "两天学习记录。",
        observations: [
          { text: "第一天的整理", evidenceIds: [`session:${first.id}`] },
          { text: "第二天的整理", evidenceIds: [`session:${second.id}`] },
          {
            text: "跨日比较",
            evidenceIds: [`session:${first.id}`, `session:${second.id}`],
          },
          { text: "当前状态", evidenceIds: [`point:${f.point}`] },
        ],
        recommendations: [],
        warnings: [],
      },
      r,
    );
    assert.ok(
      narrative.indexOf("### 2026-10-07") < narrative.indexOf("### 2026-10-06"),
    );
    assert.match(
      narrative.split("### 2026-10-07")[1].split("### 2026-10-06")[0],
      /第二天的整理/,
    );
    assert.doesNotMatch(
      narrative.split("### 2026-10-07")[1].split("### 2026-10-06")[0],
      /第一天|跨日比较|当前状态/,
    );
    assert.match(narrative.split("### 整体观察与当前状态")[1], /跨日比较/);
  } finally {
    f.store.close();
  }
});

test("作废学习和测试不计有效统计，PASS 未知独立性不当作独立通过", () => {
  const f = fixture();
  try {
    const log = f.session();
    executeLearning(
      {
        action: "void",
        entity: "session",
        id: log.id,
        commandId: randomUUID(),
        reason: "误录",
      },
      f.store,
      clock,
    );
    const invalid = f.assessment();
    executeLearning(
      {
        action: "void",
        entity: "assessment",
        id: invalid.id,
        commandId: randomUUID(),
        reason: "重复",
      },
      f.store,
      clock,
    );
    f.assessment({ independent: null, hintCount: null, answerViewed: null });
    f.assessment({
      result: "UNASSESSED",
      independent: null,
      hintCount: null,
      answerViewed: null,
    });
    const r = f.report();
    assert.equal(r.stats.minutes, 0);
    assert.equal(r.stats.sessions, 0);
    assert.equal(r.stats.assessments, 2);
    assert.equal(r.stats.pass, 1);
    assert.equal(r.stats.independentPass, 0);
    assert.equal(r.stats.unassessedTests, 1);
  } finally {
    f.store.close();
  }
});
test("时段记录与当前自评、暂未评估、错误、待办分开，目录不算已经学习", () => {
  const f = fixture();
  try {
    f.assessment({
      result: "FAIL",
      independent: false,
      error: {},
      occurredLocal: "2026-10-05T11:00",
    });
    executeLearning(
      {
        action: "state",
        mode: "SELF_REPORTED",
        pointId: f.point,
        expectedVersion: f.version(f.point),
        commandId: randomUUID(),
        targetLevel: "C",
        reason: "本人自评",
      },
      f.store,
      clock,
    );
    executeTask(
      {
        action: "create",
        id: randomUUID(),
        commandId: randomUUID(),
        pointId: f.point,
        expectedPointVersion: f.version(f.point),
        kind: "REVIEW",
        dueOn: "2026-10-06",
        reason: "安排复习",
      },
      f.store,
      new Date("2026-10-06T12:00Z"),
    );
    const r = f.report();
    assert.equal(r.stats.recordedPoints, 0);
    assert.equal(r.stats.assessments, 0);
    assert.equal(r.stats.newErrors, 0);
    assert.equal(r.current.openErrors, 1);
    assert.equal(r.current.selfReported, 1);
    assert.equal(r.current.evidence, 0);
    assert.equal(r.current.distribution.UNASSESSED, 1);
    assert.equal(r.current.distribution.A, 0);
    assert.equal(r.current.pendingTasks, 1);
    assert.equal(r.current.overdueTasks, 1);
    assert.equal(r.stats.gradeChanges, 0);
    const changed = f.report({ from: "2026-10-13", to: "2026-10-13" });
    assert.equal(changed.stats.gradeChanges, 1);
    assert.match(changed.changes[0].before, /暂未评估/);
    assert.match(changed.changes[0].after, /用户自评/);
    assert.match(summaryMarkdown(r), /不能仅凭目录或自评/);
  } finally {
    f.store.close();
  }
});
test("已完成任务只在实际完成日期计数，完成任务不增加复测通过", () => {
  const f = fixture();
  try {
    const task = randomUUID();
    executeTask(
      {
        action: "create",
        id: task,
        commandId: randomUUID(),
        pointId: f.point,
        expectedPointVersion: f.version(f.point),
        kind: "LEARN",
        dueOn: "2026-10-06",
        reason: "完成学习",
      },
      f.store,
      new Date("2026-10-06T01:00Z"),
    );
    const command = {
      action: "session",
      id: randomUUID(),
      commandId: randomUUID(),
      subjectId: f.subject,
      startedLocal: "2026-10-06T09:00",
      endedLocal: "2026-10-06T09:30",
      durationMinutes: 20,
      points: [
        { id: f.point, expectedVersion: f.version(f.point), activity: "LEARN" },
      ],
      task: { id: task, expectedVersion: 1 },
    };
    executeLearning(command, f.store, new Date("2026-10-06T12:00Z"));
    const r = f.report();
    assert.equal(r.stats.completedTasks, 1);
    assert.equal(r.stats.independentPass, 0);
    assert.equal(
      f.report({ from: "2026-10-07", to: "2026-10-07" }).stats.completedTasks,
      0,
    );
  } finally {
    f.store.close();
  }
});
test("空范围、非法日期与越界章节明确处理；归档后仍能回看历史", () => {
  const f = fixture();
  try {
    assert.throws(
      () => parseSummaryFilter({ ...f.filter, from: "2026-02-30" }),
      /日期无效/,
    );
    assert.throws(
      () => parseSummaryFilter({ ...f.filter, from: "2026-10-08" }),
      /开始日期/,
    );
    assert.throws(() => f.report({ chapterId: randomUUID() }), /章节不存在/);
    assert.throws(
      () => f.report({ subjectId: null, chapterId: f.chapter, extra: true }),
      /范围或日期/,
    );
    const foreign = f.store.raw
      .prepare("SELECT chapter_id FROM knowledge_points WHERE id=?")
      .get(f.secret) as { chapter_id: string };
    assert.throws(() => f.report({ chapterId: foreign.chapter_id }), /不属于/);
    f.session();
    executeCommand(
      {
        action: "archive",
        entity: "chapter",
        id: f.chapter,
        expectedVersion: 1,
        commandId: randomUUID(),
        reason: "结束范围",
      },
      f.store,
    );
    const r = f.report({ chapterId: f.chapter });
    assert.equal(r.stats.sessions, 1);
    assert.equal(r.current.archived, 1);
    assert.equal(
      f.report({ from: "2026-10-01", to: "2026-10-01" }).stats.sessions,
      0,
    );
  } finally {
    f.store.close();
  }
});
test("GPT 只收到所选范围，引用受约束，整个总结过程不写学习数据", async () => {
  const f = fixture();
  try {
    const log = f.session(),
      r = f.report();
    const tables = [
      ...businessTables,
      "_command_receipts",
      "_catalog_events",
      "_ai_imports",
    ];
    const snapshot = () =>
      tables.map((t) =>
        f.store.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      );
    const before = snapshot();
    let received = "";
    const result = await writeSummary(
      { filter: f.filter, snapshotToken: r.snapshotToken },
      f.store,
      async (prompt) => {
        received = prompt;
        return {
          overview: "有学习日志，但暂无复测证据。",
          observations: [
            { text: "记录了学习活动。", evidenceIds: [`session:${log.id}`] },
          ],
          recommendations: [
            { text: "建议进行独立复测。", pointIds: [f.point] },
          ],
          warnings: ["自评不等于复测确认。"],
        };
      },
      clock,
    );
    assert.match(received, /计算器件损耗/);
    assert.doesNotMatch(received, /范围外秘密知识点|不可外发科目/);
    const modelFacts = JSON.parse(received.split("快照：\n")[1]);
    assert.ok(
      modelFacts.points
        .filter((p: { basis: string }) => p.basis === "UNASSESSED")
        .every((p: { level: unknown }) => p.level === null),
    );
    assert.match(result.overview, /暂无复测证据/);
    assert.deepEqual(snapshot(), before);
    for (const output of [
      {
        overview: "错误引用",
        observations: [
          { text: "引用外来记录", evidenceIds: [`point:${f.secret}`] },
        ],
        recommendations: [],
        warnings: [],
      },
      {
        overview: "不允许写入",
        observations: [],
        recommendations: [],
        warnings: [],
        masteryLevel: "E",
      },
    ])
      await assert.rejects(
        () =>
          writeSummary(
            { filter: f.filter, snapshotToken: r.snapshotToken },
            f.store,
            async () => output,
            clock,
          ),
        /范围外|格式不完整/,
      );
    assert.deepEqual(snapshot(), before);
  } finally {
    f.store.close();
  }
});
test("事实汇总后数据已变更时拒绝旧快照，不发起 GPT 请求", async () => {
  const f = fixture();
  try {
    const r = f.report();
    f.session();
    let called = false;
    await assert.rejects(
      () =>
        writeSummary(
          { filter: f.filter, snapshotToken: r.snapshotToken },
          f.store,
          async () => {
            called = true;
            return {};
          },
          clock,
        ),
      /学习数据已更新/,
    );
    assert.equal(called, false);
  } finally {
    f.store.close();
  }
});

test("超过八条学习记录仍可逐条总结，清单完整且一次请求不改学习数据", async () => {
  const f = fixture();
  try {
    for (let i = 1; i <= 12; i++)
      f.session([f.point], "2026-10-06", {
        content: `专题${i}：给出方法后完成练习，独立选式待验证。`,
      });
    const r = f.report();
    const before = f.store.raw
      .prepare("SELECT * FROM knowledge_events ORDER BY sequence")
      .all();
    let calls = 0;
    const value = await writeSummary(
      { filter: f.filter, snapshotToken: r.snapshotToken },
      f.store,
      async (prompt) => {
        calls++;
        const facts = JSON.parse(prompt.split("快照：\n")[1]);
        assert.equal(facts.coverageChecklist.length, 12);
        assert.match(prompt, /首次独立表现/);
        assert.match(prompt, /提示后的完成/);
        assert.match(prompt, /错误到纠正/);
        assert.match(prompt, /不等于 A、失败、没有学习或个人弱点/);
        return {
          overview: "有十二项专题的提示后练习记录，尚需独立验证。",
          observations: r.sessions.map((x) => ({
            text: x.content!,
            evidenceIds: [`session:${x.id}`],
          })),
          recommendations: [],
          warnings: [],
        };
      },
      clock,
    );
    assert.equal(calls, 1);
    assert.equal(value.observations.length, 12);
    assert.equal(summaryCoverage(value, r).covered, 12);
    assert.match(narrativeMarkdown(value, r), /已引用 12\/12/);
    assert.deepEqual(
      f.store.raw
        .prepare("SELECT * FROM knowledge_events ORDER BY sequence")
        .all(),
      before,
    );
  } finally {
    f.store.close();
  }
});

test("漏掉的内容显式标记，不自动重发；跨日比较与目录引用不冒充日总结", async () => {
  const f = fixture();
  try {
    const first = f.session([f.point], "2026-10-06");
    const second = f.session([f.point], "2026-10-07");
    const r = f.report({ to: "2026-10-07" });
    let calls = 0;
    const value = await writeSummary(
      { filter: r.filter, snapshotToken: r.snapshotToken },
      f.store,
      async () => {
        calls++;
        return {
          overview: "仅有跨日比较。",
          observations: [
            {
              text: "两天都学习了损耗。",
              evidenceIds: [`session:${first.id}`, `session:${second.id}`],
            },
            { text: "目录有损耗。", evidenceIds: [`point:${f.point}`] },
          ],
          recommendations: [],
          warnings: [],
        };
      },
      clock,
    );
    assert.equal(calls, 1);
    const check = summaryCoverage(value, r);
    assert.equal(check.covered, 0);
    assert.equal(check.missing.length, 2);
    assert.ok(
      value.warnings.some((x) => x.includes("不能将本草稿视为完整总结")),
    );
    const markdown = narrativeMarkdown(value, r);
    assert.match(markdown, /未展开/);
    assert.match(markdown, /2026-10-06/);
    assert.match(markdown, /2026-10-07/);
  } finally {
    f.store.close();
  }
});

test("日期未知的学习单独成组，跨章节补充保留范围与缺口，空范围不假造覆盖", () => {
  const f = fixture();
  try {
    const r = f.report();
    const id = randomUUID();
    r.importedRecords.push({
      id,
      day: null,
      pointIds: [f.point],
      pointNames: ["损耗"],
      content: "后续模块中补充了损耗分析。",
      source: {
        module: "后续章节综合例题",
        chapter: "第四章",
        supplementPointIds: [f.point],
      },
    });
    const value = {
      overview: "学习日期未知。",
      observations: [
        { text: "后续章节补充练习了损耗。", evidenceIds: [`import:${id}`] },
      ],
      recommendations: [],
      warnings: [],
    };
    assert.equal(summaryCoverage(value, r).covered, 1);
    assert.match(
      summaryRecords(r)[0].title,
      /损耗（第四章学习中的跨章节补充）/,
    );
    assert.doesNotMatch(summaryRecords(r)[0].title, /后续章节综合例题/);
    const md = narrativeMarkdown(value, r);
    assert.match(md.split("### 学习日期未登记")[1], /后续章节补充练习了损耗/);
    assert.doesNotMatch(md, /### 整体观察与当前状态/);
    r.importedRecords = [];
    assert.equal(summaryCoverage(value, r).total, 0);
    assert.match(narrativeMarkdown(value, r), /没有学习或复测记录/);
  } finally {
    f.store.close();
  }
});

test("传给模型的输出约束仅允许快照内依据与建议知识点，合法但范围外的UUID也拒绝", () => {
  const f = fixture();
  try {
    const log = f.session();
    const r = f.report();
    const schema = summarySchemaFor(r);
    const value = {
      overview: "只看当前范围。",
      observations: [
        { text: "有学习记录。", evidenceIds: [`session:${log.id}`] },
      ],
      recommendations: [{ text: "安排复测。", pointIds: [f.point] }],
      warnings: [],
    };
    assert.equal(schema.safeParse(value).success, true);
    assert.equal(
      schema.safeParse({
        ...value,
        observations: [
          { text: "外来记录", evidenceIds: [`point:${f.secret}`] },
        ],
      }).success,
      false,
    );
    assert.equal(
      schema.safeParse({
        ...value,
        recommendations: [{ text: "外来建议", pointIds: [f.secret] }],
      }).success,
      false,
    );
    assert.equal(
      schema.safeParse({ ...value, masteryLevel: "E" }).success,
      false,
    );
  } finally {
    f.store.close();
  }
});
