import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  migrationFiles,
  businessTables,
  type Store,
} from "../src/server/db/client";
import {
  executeCommand,
  pointDetail,
  readCatalog,
} from "../src/server/catalog";
import {
  analyzeImport,
  applyImport,
  applyImportLevels,
  readImport,
  readImports,
  retryImport,
  discardImport,
} from "../src/server/imports";
import {
  executeLearning,
  readSessions,
  readAssessments,
  readErrors,
} from "../src/server/learning";
import { executeTask, readTasks } from "../src/server/tasks";
import {
  createBackup,
  exportData,
  restoreDatabase,
} from "../src/server/backup";
import type { ImportDraft, ReviewedItem } from "../src/lib/import-models";
import { sourceLearningDate } from "../src/lib/import-dates";
import { buildSummary, writeSummary } from "../src/server/summaries";
import {
  explicitLevel,
  sourceReportedLevel,
  levelConfirmationReason,
} from "../src/lib/import-levels";
import { reportedLevels } from "../src/lib/import-models";
import { summaryRecordTitle } from "../src/lib/summary-models";

const root = path.resolve("work/test-databases");
mkdirSync(root, { recursive: true });
const folder = mkdtempSync(path.join(root, "imports-"));
const clock = new Date("2026-10-08T12:00:00Z");
function fixture(file = ":memory:") {
  const store = openDatabase(file),
    subjectId = randomUUID(),
    chapterId = randomUUID(),
    pointId = randomUUID();
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "subject",
      id: subjectId,
      name: "高数",
    },
    store,
  );
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "chapter",
      id: chapterId,
      parentId: subjectId,
      name: "极限",
    },
    store,
  );
  executeCommand(
    {
      commandId: randomUUID(),
      action: "create",
      entity: "point",
      id: pointId,
      parentId: chapterId,
      name: "极限运算",
      initialLevel: "C",
    },
    store,
  );
  const source = () => ({
    id: randomUUID(),
    subject: { id: subjectId, name: "高数" },
    text: "今天学习了极限运算，学完了这一节。",
    attachment: null,
  });
  const output = () => ({
    items: [
      {
        pointId,
        chapterId,
        chapterName: null,
        name: "极限运算",
        summary: "学习了极限运算这一节。",
        stage: "COVERED",
        quote: "今天学习了极限运算",
        reason: "原文提到极限运算，与此点对应。",
      },
    ],
    warnings: [],
  });
  return { store, subjectId, chapterId, pointId, source, output };
}
function rows(draft: ImportDraft): ReviewedItem[] {
  return draft.items.map((i) => ({
    id: i.id,
    selected: true,
    pointId: i.pointId,
    chapterId: i.chapterId,
    chapterName: i.chapterName || "",
    name: i.name,
    summary: i.summary,
    stage: i.stage,
  }));
}
function command(draft: ImportDraft, patches: Record<string, unknown> = {}) {
  return {
    commandId: randomUUID(),
    id: draft.id,
    expectedVersion: draft.version,
    rows: rows(draft),
    session: null,
    ...patches,
  };
}
const count = (store: Store, table: string) =>
  (
    store.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
      n: number;
    }
  ).n;

test("原文等级按知识点对应，区分尚未评估、等级标准、升级目标及冲突", () => {
  const text =
    "A：未建立；B：理解；C：基础独立完成。\n1. 极限运算\n建议等级：C，待巩固。\n今天计算了极限运算题。\n升级目标：D。\n2. 完整波形\n建议等级：尚未评估。\n尚未画过完整波形。\n3. 积分\n目标等级：E\n明天计划学习积分。";
  assert.equal(
    sourceReportedLevel(text, {
      name: "极限运算",
      quote: "今天计算了极限运算题",
    })?.level,
    "C",
  );
  assert.equal(
    sourceReportedLevel(text, { name: "完整波形", quote: "尚未画过完整波形" })
      ?.level,
    "UNASSESSED",
  );
  assert.equal(
    sourceReportedLevel(text, { name: "积分", quote: "明天计划学习积分" }),
    null,
  );
  assert.equal(explicitLevel("A：未建立；B：理解；C：基础独立完成。"), null);
  assert.equal(explicitLevel("目标等级：E\n听懂了，感觉不错。"), null);
  assert.equal(explicitLevel("建议等级：B\n建议等级：C"), null);
  assert.equal(explicitLevel("建议等级：B/C"), null);
  assert.equal(explicitLevel("建议等级：B～C"), null);
  assert.equal(explicitLevel("建议等级：C 或 D"), null);
  assert.equal(explicitLevel("**自评等级：**E"), "E");
  assert.equal(
    sourceReportedLevel(
      "1. 平均电流\n建议等级：B\n（1）第一种公式\n（2）第二种公式\n计算曾经出现两倍误差。\n2. 下一个知识点",
      { name: "带前缀的平均电流", quote: "计算曾经出现两倍误差" },
    )?.level,
    "B",
  );
  assert.equal(
    sourceReportedLevel(
      "1. 甲\n建议等级：B\n重复的学习描述。\n2. 乙\n建议等级：C\n重复的学习描述。",
      { name: "不明项目", quote: "重复的学习描述" },
    ),
    null,
  );
});

test("明确等级进入草稿不改状态，确认后 A–E 只记为自评，未知单列且历史完整", async () => {
  for (const level of reportedLevels) {
    const f = fixture();
    try {
      const quote = `建议等级：${level === "UNASSESSED" ? "尚未评估" : level}`;
      const source = {
        ...f.source(),
        text: `1. 极限运算\n${quote}\n今天学习了极限运算。`,
      };
      const before = exportData(f.store).tables;
      const draft = await analyzeImport(source, f.store, async (prompt) => {
        assert.match(prompt, /reportedLevel只摘录原文/);
        return {
          ...f.output(),
          items: [{ ...f.output().items[0], reportedLevel: { level, quote } }],
        };
      });
      assert.equal(draft.status, "READY");
      assert.equal(draft.items[0].reportedLevel?.level, level);
      for (const table of businessTables)
        assert.deepEqual(exportData(f.store).tables[table], before[table]);
      const reviewed = rows(draft);
      reviewed[0].level = level;
      reviewed[0].levelReason = levelConfirmationReason(
        draft.items[0].reportedLevel,
      );
      const c = command(draft, { rows: reviewed });
      applyImport(c, f.store, clock);
      const countBeforeRepeat = count(f.store, "knowledge_events");
      applyImport(c, f.store, clock);
      assert.equal(count(f.store, "knowledge_events"), countBeforeRepeat);
      const detail = pointDetail(f.pointId, f.store);
      assert.equal(
        detail.point.masteryBasis,
        level === "UNASSESSED" ? "UNASSESSED" : "SELF_REPORTED",
      );
      assert.equal(
        detail.point.masteryLevel,
        level === "UNASSESSED" ? "A" : level,
      );
      assert.equal(detail.point.summaryBasedOnVersion, detail.point.version);
      assert.ok(
        detail.events.some(
          (e) => e.eventType === "STATE_CHANGED" && e.reason.includes(quote),
        ),
      );
      assert.equal(readImport(draft.id, f.store).source.text, source.text);
      assert.equal(readAssessments(undefined, f.store).length, 0);
      assert.equal(readErrors(undefined, f.store).length, 0);
      assert.equal(readTasks(f.store).length, 0);
    } finally {
      f.store.close();
    }
  }
});

test("等级可选择不采用；缺原因拒绝，错误等级摘录不挡住草稿且只用对应原文", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text: "1. 极限运算\n建议等级：B\n今天学习了极限运算。\n2. 其他知识点\n建议等级：E",
    };
    for (const suggestion of [
      { level: "E", quote: "建议等级：E" },
      { level: "C", quote: "建议等级：C" },
    ]) {
      const bad = await analyzeImport(
        { ...source, id: randomUUID() },
        f.store,
        async () => ({
          ...f.output(),
          items: [{ ...f.output().items[0], reportedLevel: suggestion }],
        }),
      );
      assert.equal(bad.status, "READY");
      assert.equal(bad.items[0].reportedLevel?.level, "B");
      assert.equal(bad.items[0].reportedLevel?.quote, "建议等级：B");
      assert.ok(bad.warnings.some((w) => w.includes("等级摘录未能核对")));
    }
    const draft = await analyzeImport(source, f.store, async () => f.output());
    assert.equal(draft.items[0].reportedLevel?.level, "B");
    const reviewed = rows(draft);
    reviewed[0].level = "B";
    assert.throws(
      () => applyImport(command(draft, { rows: reviewed }), f.store, clock),
      /等级确认原因/,
    );
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "C");
    const beforeGradeEvents = pointDetail(f.pointId, f.store).events.filter(
      (e) => e.eventType === "STATE_CHANGED",
    );
    reviewed[0].level = null;
    applyImport(command(draft, { rows: reviewed }), f.store, clock);
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "C");
    assert.deepEqual(
      pointDetail(f.pointId, f.store).events.filter(
        (e) => e.eventType === "STATE_CHANGED",
      ),
      beforeGradeEvents,
    );
  } finally {
    f.store.close();
  }
});

test("单个等级无法核对时保留全部学习内容，其他有效等级照常进入草稿", async () => {
  const f = fixture();
  try {
    const input = {
      ...f.source(),
      text: "1. 极限运算\n建议等级：B\n今天学习了极限运算。\n2. 函数连续\n今天学习了函数连续，还没评定等级。",
    };
    const draft = await analyzeImport(input, f.store, async () => ({
      items: [
        { ...f.output().items[0], reportedLevel: { level: "C", quote: "C" } },
        {
          ...f.output().items[0],
          pointId: null,
          name: "函数连续",
          summary: "学习了函数连续，未评定等级。",
          quote: "今天学习了函数连续",
          reportedLevel: { level: "E", quote: "建议等级：E" },
        },
      ],
      warnings: [],
    }));
    assert.equal(draft.status, "READY");
    assert.equal(draft.items.length, 2);
    assert.deepEqual(draft.items[0].reportedLevel, {
      level: "B",
      quote: "建议等级：B",
    });
    assert.equal(draft.items[1].reportedLevel, null);
    assert.equal(draft.items[1].summary, "学习了函数连续，未评定等级。");
    assert.equal(draft.source.text, input.text);
    assert.ok(
      draft.warnings.some(
        (w) => w.includes("函数连续") && w.includes("未自动选择等级"),
      ),
    );
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "C");
    assert.equal(count(f.store, "knowledge_points"), 1);
  } finally {
    f.store.close();
  }
});

test("一段内有整体 C 和分项 B 时不把整体等级套给分项，也不会整份失败", async () => {
  const f = fixture();
  try {
    const source =
      "1. 平均量与有效值\n建议等级：C；平均电感电压为零的独立推导建议B、待测。\n今天学习了平均电感电压为零的推导。";
    assert.equal(
      sourceReportedLevel(source, {
        name: "平均量与有效值",
        quote: "今天学习了平均电感电压为零的推导",
      })?.level,
      "C",
    );
    assert.equal(
      sourceReportedLevel(source, {
        name: "平均电感电压为零的独立推导",
        quote: "今天学习了平均电感电压为零的推导",
      }),
      null,
    );
    const draft = await analyzeImport(
      { ...f.source(), text: source },
      f.store,
      async () => ({
        items: [
          {
            ...f.output().items[0],
            pointId: null,
            name: "平均电感电压为零的独立推导",
            quote: "今天学习了平均电感电压为零的推导",
            reportedLevel: {
              level: "B",
              quote: "平均电感电压为零的独立推导建议B、待测。",
            },
          },
        ],
        warnings: [],
      }),
    );
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].reportedLevel, null);
    assert.ok(draft.warnings.some((w) => w.includes("分项归属")));
    assert.equal(count(f.store, "assessments"), 0);
  } finally {
    f.store.close();
  }
});

test("旧版已保存录入可补充原文等级，不改写原文及确认稿，不产生复测且幂等", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text: "1. 极限运算\n建议等级：D，仍需延迟复测。\n今天学习了极限运算。",
    };
    const draft = await analyzeImport(source, f.store, async () => f.output());
    f.store.raw
      .prepare(
        "UPDATE _ai_imports SET proposal_json=json_remove(proposal_json,'$.items[0].reportedLevel') WHERE id=?",
      )
      .run(draft.id);
    applyImport(command(readImport(draft.id, f.store)), f.store, clock);
    const original = f.store.raw
      .prepare("SELECT * FROM _ai_imports WHERE id=?")
      .get(draft.id);
    const reopened = readImport(draft.id, f.store);
    assert.equal(reopened.items[0].reportedLevel?.level, "D");
    const meta = reopened.levelReview![0];
    const supplement = {
      commandId: randomUUID(),
      id: draft.id,
      expectedVersion: reopened.version,
      rows: [
        {
          id: meta.id,
          pointId: meta.pointId,
          expectedPointVersion: meta.expectedPointVersion,
          level: "D",
          reason: levelConfirmationReason(reopened.items[0].reportedLevel),
        },
      ],
    };
    applyImportLevels(supplement, f.store, clock);
    const eventCount = count(f.store, "knowledge_events");
    applyImportLevels(supplement, f.store, clock);
    assert.equal(count(f.store, "knowledge_events"), eventCount);
    assert.deepEqual(
      f.store.raw.prepare("SELECT * FROM _ai_imports WHERE id=?").get(draft.id),
      original,
    );
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "D");
    assert.equal(
      pointDetail(f.pointId, f.store).point.masteryBasis,
      "SELF_REPORTED",
    );
    assert.equal(readAssessments(undefined, f.store).length, 0);
    assert.equal(readSessions(f.store).length, 0);
    assert.throws(
      () =>
        applyImportLevels(
          { ...supplement, rows: [{ ...supplement.rows[0], level: "E" }] },
          f.store,
          clock,
        ),
      /提交编号/,
    );
    assert.throws(
      () =>
        applyImportLevels(
          { ...supplement, commandId: randomUUID() },
          f.store,
          clock,
        ),
      /已更新/,
    );
  } finally {
    f.store.close();
  }
});

test("补充等级拒绝越界、重复项目、过期版本及未保存草稿，多项冲突整批回滚", async () => {
  const f = fixture();
  try {
    const other = randomUUID();
    executeCommand(
      {
        action: "create",
        entity: "point",
        commandId: randomUUID(),
        id: other,
        parentId: f.chapterId,
        name: "等价替换",
      },
      f.store,
    );
    const source = {
      ...f.source(),
      text: "1. 极限运算\n建议等级：B\n今天学习了极限运算。\n2. 等价替换\n建议等级：C\n今天学习了等价替换。",
    };
    const draft = await analyzeImport(source, f.store, async () => ({
      items: [
        f.output().items[0],
        {
          ...f.output().items[0],
          pointId: other,
          name: "等价替换",
          quote: "今天学习了等价替换",
        },
      ],
      warnings: [],
    }));
    const blank = {
      commandId: randomUUID(),
      id: draft.id,
      expectedVersion: draft.version,
      rows: [
        {
          id: draft.items[0].id,
          pointId: f.pointId,
          expectedPointVersion: 1,
          level: "B",
          reason: "本人确认",
        },
      ],
    };
    assert.throws(
      () => applyImportLevels(blank, f.store, clock),
      /只能为已保存/,
    );
    applyImport(command(draft), f.store, clock);
    const saved = readImport(draft.id, f.store);
    const rows = saved.levelReview!.map((p, i) => ({
      id: p.id,
      pointId: p.pointId,
      expectedPointVersion: p.expectedPointVersion,
      level: i ? "C" : "B",
      reason: "本人确认原文等级",
    }));
    const input = { ...blank, expectedVersion: saved.version, rows };
    assert.throws(
      () =>
        applyImportLevels(
          { ...input, rows: [{ ...rows[0], pointId: other }] },
          f.store,
          clock,
        ),
      /只能补充本次/,
    );
    assert.throws(
      () =>
        applyImportLevels(
          { ...input, rows: [rows[0], rows[0]] },
          f.store,
          clock,
        ),
      /不能重复/,
    );
    assert.throws(
      () =>
        applyImportLevels(
          { ...input, rows: [{ ...rows[0], reason: " " }] },
          f.store,
          clock,
        ),
      /等级确认原因/,
    );
    executeCommand(
      {
        action: "summary",
        entity: "point",
        commandId: randomUUID(),
        id: other,
        expectedVersion: rows[1].expectedPointVersion,
        summary: "另一窗口修改摘要",
        source: "MANUAL",
      },
      f.store,
    );
    const before = exportData(f.store).tables;
    assert.throws(() => applyImportLevels(input, f.store, clock), /已更新/);
    assert.deepEqual(exportData(f.store).tables, before);
  } finally {
    f.store.close();
  }
});

test("只识别明确学习日期，不把上传、计划、预计复测或无效日期当学习日期", () => {
  assert.equal(
    sourceLearningDate("学习日期：2026年10月10日\n实际学习用时：未统计"),
    "2026-10-10",
  );
  assert.equal(sourceLearningDate("**学习日期：**2026-10-11"), "2026-10-11");
  assert.equal(
    sourceLearningDate("学习时间：2026/10/11 09:00—10:00"),
    "2026-10-11",
  );
  assert.equal(
    sourceLearningDate("建议复测日期：2026-10-11\n预计用时：5—10分钟"),
    null,
  );
  assert.equal(
    sourceLearningDate("上传日期：2026-10-11\n计划学习日期：2026-10-12"),
    null,
  );
  assert.equal(sourceLearningDate("学习日期：2026-02-30"), null);
  assert.equal(sourceLearningDate("学习日期：2026-10-110"), null);
  assert.equal(
    sourceLearningDate("学习日期：2026-10-10\n学习日期：2026-10-11"),
    null,
  );
});
test("旧版两次确认内容按原学习日期进入总结，用时未知不造日志或分钟", async () => {
  const f = fixture();
  try {
    const before = f.source();
    for (const day of ["2026-10-06", "2026-10-07"]) {
      const input = {
        ...before,
        id: randomUUID(),
        text: `学习日期：${day}\n实际学习用时：未统计，不按对话跨度计算。\n${before.text}`,
      };
      const draft = await analyzeImport(input, f.store, async () => f.output());
      assert.equal(draft.learningDate, day);
      const saved = applyImport(command(draft), f.store, clock);
      assert.equal(saved.sessionId, null);
      // Reproduce a pre-fix confirmation: no separately saved date field.
      f.store.raw
        .prepare(
          "UPDATE _ai_imports SET applied_json=json_remove(applied_json,'$.reviewed.learningDate') WHERE id=?",
        )
        .run(draft.id);
      assert.equal(readImport(draft.id, f.store).learningDate, day);
    }
    assert.equal(count(f.store, "study_sessions"), 0);
    const filter = {
      from: "2026-10-06",
      to: "2026-10-07",
      subjectId: f.subjectId,
      chapterId: f.chapterId,
    };
    const report = buildSummary(filter, f.store, clock);
    assert.equal(report.stats.importedRecords, 2);
    assert.equal(report.stats.unmeasuredRecords, 2);
    assert.equal(report.stats.minutes, 0);
    assert.equal(report.stats.assessments, 0);
    assert.deepEqual(
      report.importedRecords.map((x) => x.day),
      ["2026-10-06", "2026-10-07"],
    );
    assert.equal(
      buildSummary({ ...filter, to: "2026-10-06" }, f.store, clock).stats
        .importedRecords,
      1,
    );
    assert.equal(
      buildSummary(
        { ...filter, from: "2026-10-08", to: "2026-10-08" },
        f.store,
        clock,
      ).stats.importedRecords,
      0,
    );
    const narrative = await writeSummary(
      { filter, snapshotToken: report.snapshotToken },
      f.store,
      async (prompt) => {
        assert.match(prompt, /2026-10-06/);
        assert.match(prompt, /没有精确日志不等于没有学习/);
        return {
          overview: "两次内容录入有学习日期，用时未登记。",
          observations: [
            {
              text: "有确认内容记录。",
              evidenceIds: [`import:${report.importedRecords[0].id}`],
            },
          ],
          recommendations: [],
          warnings: [],
        };
      },
      clock,
    );
    assert.match(narrative.overview, /两次/);
  } finally {
    f.store.close();
  }
});
test("每天只展示本次确认内容，较早摘要保留在知识点历史，不重复算入当天", async () => {
  const f = fixture();
  try {
    const first = await analyzeImport(
      { ...f.source(), text: "学习日期：2026-10-06\n昨天学习了极限运算" },
      f.store,
      async () => {
        const out = f.output();
        out.items[0].summary = "第一天整理：极限的四则运算。";
        out.items[0].quote = "昨天学习了极限运算";
        return out;
      },
    );
    applyImport(command(first), f.store, clock);
    const second = await analyzeImport(
      { ...f.source(), text: "学习日期：2026-10-07\n今天练习了复合函数极限" },
      f.store,
      async () => {
        const out = f.output();
        out.items[0].summary = "第二天整理：复合函数极限。";
        out.items[0].quote = "今天练习了复合函数极限";
        return out;
      },
    );
    const previous = second.context.points.find(
      (p) => p.id === f.pointId,
    )!.aiSummary;
    const reviewed = rows(second);
    reviewed[0].summary = `${previous}\n\n【本次整理】\n${reviewed[0].summary}\n本人补充：注意内外层的条件。`;
    applyImport(command(second, { rows: reviewed }), f.store, clock);
    const filter = {
      from: "2026-10-06",
      to: "2026-10-07",
      subjectId: f.subjectId,
      chapterId: null,
    };
    const r = buildSummary(filter, f.store, clock);
    assert.match(r.importedRecords[0].content, /第一天整理/);
    assert.doesNotMatch(r.importedRecords[0].content, /第二天整理/);
    assert.match(r.importedRecords[1].content, /第二天整理/);
    assert.match(r.importedRecords[1].content, /本人补充/);
    assert.doesNotMatch(r.importedRecords[1].content, /第一天整理/);
    assert.match(
      pointDetail(f.pointId, f.store).point.aiSummary!,
      /第一天整理/,
    );
    const third = await analyzeImport(
      { ...f.source(), text: "学习日期：2026-10-08\n今天练习了无穷小替换" },
      f.store,
      async () => {
        const out = f.output();
        out.items[0].summary = "第三天整理：无穷小替换。";
        out.items[0].quote = "今天练习了无穷小替换";
        return out;
      },
    );
    const mixed = rows(third);
    mixed[0].summary = "把之前的极限四则运算和本次无穷小替换合写，无法分离。";
    applyImport(command(third, { rows: mixed }), f.store, clock);
    const latest = buildSummary(
      { ...filter, from: "2026-10-08", to: "2026-10-08" },
      f.store,
      clock,
    );
    assert.match(
      latest.importedRecords[0].content,
      /本次原文摘录：今天练习了无穷小替换/,
    );
    assert.doesNotMatch(latest.importedRecords[0].content, /极限四则/);
    assert.equal(
      pointDetail(f.pointId, f.store).point.aiSummary,
      mixed[0].summary,
    );
    const fourth = await analyzeImport(
      { ...f.source(), text: "学习日期：2026-10-08\n当晚独立练习了极限题" },
      f.store,
      async () => {
        const out = f.output();
        out.items[0].summary = "当晚学习内容。";
        out.items[0].quote = "当晚独立练习了极限题";
        return out;
      },
    );
    const measured = rows(fourth);
    measured[0].summary = `${mixed[0].summary}\n\n【本次整理】\n当晚学习内容。`;
    applyImport(
      command(fourth, {
        rows: measured,
        session: {
          startedLocal: "2026-10-08T18:00",
          endedLocal: "2026-10-08T18:30",
          durationMinutes: 20,
          activity: "LEARN",
        },
      }),
      f.store,
      clock,
    );
    const withLog = buildSummary(
      { ...filter, from: "2026-10-08", to: "2026-10-08" },
      f.store,
      clock,
    );
    assert.equal(withLog.sessions.length, 1);
    assert.equal(withLog.importedRecords.length, 1);
    assert.equal(withLog.stats.minutes, 20);
    assert.equal(withLog.sessions[0].content, "当晚学习内容。");
    assert.doesNotMatch(withLog.sessions[0].content!, /极限四则/);
  } finally {
    f.store.close();
  }
});

test("总结识别后续章节的范围内补充，保留模块标题，不修改原文或等级", async () => {
  const f = fixture();
  try {
    f.store.raw
      .prepare("UPDATE chapters SET name='第三章' WHERE id=?")
      .run(f.chapterId);
    const source = {
      ...f.source(),
      text: "模块：后续应用\n学习日期：2026-10-06\n一、时间与资料\n主要资料：第四章课件\n二、实际作答\n今天学习了极限运算，提示后完成。\n下一模块：第五章",
    };
    const draft = await analyzeImport(source, f.store, async () => f.output());
    applyImport(command(draft), f.store, clock);
    const before = exportData(f.store).tables;
    const r = buildSummary(
      { from: null, to: null, subjectId: f.subjectId, chapterId: f.chapterId },
      f.store,
      clock,
    );
    const row = r.importedRecords[0];
    assert.equal(row.source?.module, "后续应用");
    assert.equal(row.source?.chapter, "第四章");
    assert.deepEqual(row.source?.supplementPointIds, [f.pointId]);
    assert.match(
      summaryRecordTitle(row),
      /极限运算（第四章学习中的跨章节补充）/,
    );
    assert.equal(readImport(draft.id, f.store).source.text, source.text);
    assert.deepEqual(exportData(f.store).tables, before);
  } finally {
    f.store.close();
  }
});

test("本人可核对修改学习日期；未来日期、无效日期和与日志日期矛盾均拒绝", async () => {
  const f = fixture();
  try {
    const input = {
      ...f.source(),
      text: "学习日期：2026-10-06\n今天学习了极限运算，学完了这一节。",
    };
    const draft = await analyzeImport(input, f.store, async () => f.output());
    const original = input.text;
    assert.throws(
      () =>
        applyImport(
          command(draft, { learningDate: "2026-10-09" }),
          f.store,
          clock,
        ),
      /未来/,
    );
    assert.throws(
      () =>
        applyImport(
          command(draft, { learningDate: "2026-02-30" }),
          f.store,
          clock,
        ),
      /日期无效/,
    );
    assert.throws(
      () =>
        applyImport(
          command(draft, {
            learningDate: "2026-10-06",
            session: {
              startedLocal: "2026-10-07T09:00",
              endedLocal: "2026-10-07T09:30",
              durationMinutes: 20,
              activity: "LEARN",
            },
          }),
          f.store,
          clock,
        ),
      /日期不一致/,
    );
    const confirmed = command(draft, { learningDate: "2026-10-07" });
    applyImport(confirmed, f.store, clock);
    applyImport(confirmed, f.store, clock);
    assert.equal(readImport(draft.id, f.store).learningDate, "2026-10-07");
    assert.equal(readImport(draft.id, f.store).source.text, original);
    assert.equal(count(f.store, "study_sessions"), 0);
  } finally {
    f.store.close();
  }
});
test("已有精确学习日志的录入不重复计数或在日志作废后冒充另一条记录", async () => {
  const f = fixture();
  try {
    const input = {
      ...f.source(),
      text: "学习日期：2026-10-06\n今天学习了极限运算，学完了这一节。",
    };
    const draft = await analyzeImport(input, f.store, async () => f.output());
    const result = applyImport(
      command(draft, {
        session: {
          startedLocal: "2026-10-06T09:00",
          endedLocal: "2026-10-06T09:40",
          durationMinutes: 30,
          activity: "LEARN",
        },
      }),
      f.store,
      clock,
    );
    const filter = {
      from: "2026-10-06",
      to: "2026-10-06",
      subjectId: f.subjectId,
      chapterId: null,
    };
    const report = buildSummary(filter, f.store, clock);
    assert.equal(report.stats.sessions, 1);
    assert.equal(report.stats.minutes, 30);
    assert.equal(report.stats.importedRecords, 0);
    executeLearning(
      {
        action: "void",
        entity: "session",
        commandId: randomUUID(),
        id: result.sessionId,
        reason: "时间误录",
      },
      f.store,
      clock,
    );
    const after = buildSummary(filter, f.store, clock);
    assert.equal(after.stats.sessions, 0);
    assert.equal(after.stats.importedRecords, 0);
  } finally {
    f.store.close();
  }
});
test("账户整理只保存原文和草稿；原文不可改写，重复请求不重复调用", async () => {
  const f = fixture();
  let calls = 0;
  try {
    const before = exportData(f.store).tables;
    const source = f.source();
    const draft = await analyzeImport(source, f.store, async (prompt) => {
      calls++;
      assert.ok(prompt.includes(f.pointId));
      return f.output();
    });
    assert.equal(draft.status, "READY");
    for (const table of businessTables)
      assert.deepEqual(exportData(f.store).tables[table], before[table]);
    assert.equal(draft.source.text, source.text);
    assert.equal(draft.context.points[0].version, 1);
    assert.throws(
      () =>
        f.store.raw
          .prepare("UPDATE _ai_imports SET input_json='{}' WHERE id=?")
          .run(draft.id),
      /immutable/,
    );
    assert.throws(
      () =>
        f.store.raw.prepare("DELETE FROM _ai_imports WHERE id=?").run(draft.id),
      /retained/,
    );
    assert.equal(
      (
        await analyzeImport(source, f.store, async () => {
          calls++;
          return f.output();
        })
      ).id,
      draft.id,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      analyzeImport({ ...source, text: "改变原文" }, f.store, async () =>
        f.output(),
      ),
      /编号/,
    );
  } finally {
    f.store.close();
  }
});
test("确认摘要和进度不制造掌握、复测、错误解决或任务完成；明确用时只计一次", async () => {
  const f = fixture();
  try {
    executeCommand(
      {
        commandId: randomUUID(),
        entity: "point",
        action: "summary",
        id: f.pointId,
        expectedVersion: 1,
        summary: "原有学习摘要",
        source: "MANUAL",
      },
      f.store,
    );
    executeTask(
      {
        commandId: randomUUID(),
        action: "create",
        id: randomUUID(),
        pointId: f.pointId,
        expectedPointVersion: 2,
        kind: "REVIEW",
        dueOn: "2026-10-08",
        reason: "复习",
      },
      f.store,
      clock,
    );
    const draft = await analyzeImport(f.source(), f.store, async () =>
      f.output(),
    );
    const reviewed = rows(draft);
    reviewed[0].summary = "原有学习摘要\n\n本次：" + reviewed[0].summary;
    const result = applyImport(
      command(draft, {
        rows: reviewed,
        session: {
          startedLocal: "2026-10-08T09:00",
          endedLocal: "2026-10-08T09:40",
          durationMinutes: 30,
          activity: "LEARN",
        },
      }),
      f.store,
      clock,
    );
    const p = pointDetail(f.pointId, f.store).point;
    assert.equal(p.masteryLevel, "C");
    assert.equal(p.masteryBasis, "SELF_REPORTED");
    assert.equal(p.learningStage, "COVERED");
    assert.ok(p.aiSummary?.includes("原有学习摘要"));
    assert.equal(p.summaryBasedOnVersion, p.version);
    assert.equal(readTasks(f.store)[0].status, "PENDING");
    assert.equal(readAssessments(undefined, f.store).length, 0);
    assert.equal(readErrors(undefined, f.store).length, 0);
    assert.equal(readSessions(f.store)[0].duration_minutes, 30);
    assert.equal(readSessions(f.store)[0].id, result.sessionId);
    assert.ok(
      pointDetail(f.pointId, f.store).events.some((e) =>
        e.afterJson?.includes(draft.id),
      ),
    );
  } finally {
    f.store.close();
  }
});
test("空知识树可确认创建科目、共用章节及多个点；未评估保持未知，不重复计算用时", async () => {
  const store = openDatabase(":memory:");
  try {
    const source = {
      id: randomUUID(),
      subject: { id: null, name: "英语" },
      text: "学过主语和宾语，宾语还在学习。",
      attachment: null,
    };
    const draft = await analyzeImport(source, store, async () => ({
      items: ["主语", "宾语"].map((name) => ({
        pointId: null,
        chapterId: null,
        chapterName: "句子结构",
        name,
        summary: `本次学习${name}。`,
        stage: "IN_PROGRESS",
        quote: name,
        reason: "原文出现此项学习内容。",
      })),
      warnings: [],
    }));
    assert.throws(
      () =>
        applyImport(
          command(draft, {
            session: {
              startedLocal: "2026-10-08T10:00",
              endedLocal: "2026-10-08T10:40",
              durationMinutes: 90,
              activity: "LEARN",
            },
          }),
          store,
          clock,
        ),
      /分钟/,
    );
    assert.equal(readCatalog(store).subjects.length, 0);
    assert.equal(readCatalog(store).chapters.length, 0);
    assert.equal(readCatalog(store).points.length, 0);
    assert.equal(readImport(draft.id, store).status, "READY");
    const result = applyImport(
      command(draft, {
        session: {
          startedLocal: "2026-10-08T10:00",
          endedLocal: "2026-10-08T10:40",
          durationMinutes: 25,
          activity: "LEARN",
        },
      }),
      store,
      clock,
    );
    const catalog = readCatalog(store);
    assert.equal(catalog.subjects.length, 1);
    assert.equal(catalog.chapters.length, 1);
    assert.equal(catalog.points.length, 2);
    assert.ok(catalog.points.every((p) => p.masteryBasis === "UNASSESSED"));
    assert.equal(readSessions(store).length, 1);
    assert.equal(readSessions(store)[0].points.length, 2);
    assert.equal(readSessions(store)[0].duration_minutes, 25);
    assert.equal(result.pointIds.length, 2);
  } finally {
    store.close();
  }
});
test("归属越界及整理后的版本冲突均拒绝；任何错误回滚整批保存", async () => {
  const f = fixture();
  try {
    const draft = await analyzeImport(f.source(), f.store, async () =>
      f.output(),
    );
    const bad = rows(draft);
    bad[0].pointId = randomUUID();
    assert.throws(
      () => applyImport(command(draft, { rows: bad }), f.store, clock),
      /范围/,
    );
    const before = readCatalog(f.store);
    assert.throws(
      () =>
        applyImport(
          command(draft, {
            session: {
              startedLocal: "2026-10-08T09:00",
              endedLocal: "2026-10-08T09:10",
              durationMinutes: 30,
              activity: "LEARN",
            },
          }),
          f.store,
          clock,
        ),
      /分钟/,
    );
    assert.deepEqual(readCatalog(f.store), before);
    assert.equal(count(f.store, "study_sessions"), 0);
    assert.equal(readImport(draft.id, f.store).status, "READY");
    executeCommand(
      {
        commandId: randomUUID(),
        entity: "point",
        action: "edit",
        id: f.pointId,
        expectedVersion: 1,
        name: "极限运算",
        description: "其他窗口新内容",
      },
      f.store,
    );
    assert.throws(() => applyImport(command(draft), f.store), /已更新/);
    assert.equal(pointDetail(f.pointId, f.store).point.aiSummary, null);
  } finally {
    f.store.close();
  }
});
test("非结构化输出、额外掌握字段、捏造原文和外来 ID 均不会入库；失败可重试", async () => {
  const f = fixture();
  try {
    for (const output of [
      { ...f.output(), mastery: "E" },
      {
        ...f.output(),
        items: [{ ...f.output().items[0], quote: "我独立全做对了" }],
      },
      {
        ...f.output(),
        items: [{ ...f.output().items[0], pointId: randomUUID() }],
      },
    ]) {
      const draft = await analyzeImport(
        f.source(),
        f.store,
        async () => output,
      );
      assert.equal(draft.status, "FAILED");
      assert.equal(readCatalog(f.store).points[0].version, 1);
      const fixed = await retryImport(
        draft.id,
        draft.version,
        f.store,
        async () => f.output(),
      );
      assert.equal(fixed.status, "READY");
      assert.equal(fixed.source.text, draft.source.text);
      discardImport(fixed.id, fixed.version, f.store);
      assert.throws(() => applyImport(command(fixed), f.store), /已处理/);
    }
    assert.equal(count(f.store, "study_sessions"), 0);
  } finally {
    f.store.close();
  }
});
test("确认幂等；重复指向、未知字段、再次确认和过期版本无法生成第二份学习记录", async () => {
  const f = fixture();
  try {
    const draft = await analyzeImport(f.source(), f.store, async () =>
      f.output(),
    );
    assert.throws(
      () => applyImport(command(draft, { targetLevel: "E" }), f.store),
      /Unrecognized/,
    );
    const c = command(draft);
    const a = applyImport(c, f.store, clock),
      b = applyImport(c, f.store, clock);
    assert.deepEqual(a, b);
    assert.equal(readImport(draft.id, f.store).status, "APPLIED");
    assert.throws(() => applyImport({ ...c, rows: [] }, f.store), /Too small/);
    assert.throws(() => applyImport(command(draft), f.store), /已处理/);
    assert.equal(count(f.store, "_ai_imports"), 1);
    const stored = readImport(draft.id, f.store).applied as {
      reviewed: { rows: ReviewedItem[] };
    } | null;
    assert.equal(stored?.reviewed.rows[0].summary, rows(draft)[0].summary);
  } finally {
    f.store.close();
  }
});
test("图片真实性及大小校验在调用前执行；重启中断保留原文并可重试", async () => {
  const f = fixture();
  let calls = 0;
  try {
    await assert.rejects(
      analyzeImport(
        {
          ...f.source(),
          attachment: {
            name: "x.png",
            mime: "image/png",
            base64: Buffer.from("not an image").toString("base64"),
          },
        },
        f.store,
        async () => {
          calls++;
          return f.output();
        },
      ),
      /类型不符/,
    );
    assert.equal(calls, 0);
    const draft = await analyzeImport(f.source(), f.store, async () => {
      throw new Error("private diagnostic must not reach UI");
    });
    assert.equal(draft.status, "FAILED");
    assert.ok(!draft.error?.includes("private"));
    f.store.raw
      .prepare(
        "UPDATE _ai_imports SET status='RUNNING',worker_pid=-1 WHERE id=?",
      )
      .run(draft.id);
    assert.equal(readImports(f.store)[0].status, "FAILED");
    const recovered = readImport(draft.id, f.store);
    assert.equal(
      (
        await retryImport(recovered.id, recovered.version, f.store, async () =>
          f.output(),
        )
      ).status,
      "READY",
    );
  } finally {
    f.store.close();
  }
});
test("并发上传只运行一个账户请求；跨知识点归属重复时整批回滚", async () => {
  const f = fixture();
  try {
    let release!: (output: unknown) => void;
    const pending = analyzeImport(
      f.source(),
      f.store,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await assert.rejects(
      analyzeImport(f.source(), f.store, async () => f.output()),
      /正在整理/,
    );
    release(f.output());
    const draft = await pending;
    const duplicate = await analyzeImport(f.source(), f.store, async () => ({
      ...f.output(),
      items: [
        ...f.output().items,
        { ...f.output().items[0], pointId: null, name: "另一建议知识点" },
      ],
    }));
    const selected = rows(duplicate);
    selected[1].pointId = f.pointId;
    assert.throws(
      () => applyImport(command(duplicate, { rows: selected }), f.store),
      /同一知识点/,
    );
    assert.equal(
      pointDetail(f.pointId, f.store).point.version,
      draft.context.points[0].version,
    );
  } finally {
    f.store.close();
  }
});
test("旧 Schema 2 升级自动备份；原有目录、证据及追加历史保持原值", () => {
  const file = path.join(folder, "schema2.sqlite"),
    raw = new Database(file);
  raw.exec(
    "CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,hash TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT",
  );
  for (const m of migrationFiles().slice(0, 2)) {
    raw.exec(m.sql);
    raw
      .prepare("INSERT INTO _migrations VALUES(?,?,?)")
      .run(m.name, m.hash, clock.toISOString());
  }
  raw
    .prepare(
      "INSERT INTO subjects(id,name,created_at,updated_at) VALUES(?,?,?,?)",
    )
    .run("legacy", "旧科目", clock.toISOString(), clock.toISOString());
  raw.close();
  const store = openDatabase(file);
  try {
    assert.equal(readCatalog(store).subjects[0].id, "legacy");
    assert.equal(readCatalog(store).subjects[0].name, "旧科目");
    assert.equal(
      store.raw.pragma("user_version", { simple: true }),
      migrationFiles().length,
    );
    assert.equal(count(store, "_ai_imports"), 0);
    assert.ok(readdirSync(path.join(folder, "migration-backups")).length > 0);
    assert.deepEqual(store.raw.pragma("foreign_key_check"), []);
  } finally {
    store.close();
  }
});
test("确认编辑后的摘要、原文和归属完整进入 JSON / SQLite 快照，关闭和独立恢复后相同", async () => {
  const file = path.join(folder, "source.sqlite"),
    f = fixture(file);
  const draft = await analyzeImport(f.source(), f.store, async () =>
    f.output(),
  );
  const reviewed = rows(draft);
  reviewed[0].summary += "\n本人补充：下次检查适用条件。";
  applyImport(command(draft, { rows: reviewed }), f.store, clock);
  const before = exportData(f.store),
    backup = path.join(folder, "backup.sqlite");
  assert.equal(
    (
      before.tables._ai_imports[0] as { input_json: string }
    ).input_json.includes(f.source().text),
    true,
  );
  await createBackup(f.store, backup);
  f.store.close();
  const reopened = openDatabase(file);
  assert.deepEqual(exportData(reopened).tables, before.tables);
  reopened.close();
  const restored = path.join(folder, "restored.sqlite");
  await restoreDatabase(backup, restored);
  const store = openDatabase(restored);
  try {
    assert.deepEqual(exportData(store).tables, before.tables);
    assert.equal(readImport(draft.id, store).status, "APPLIED");
  } finally {
    store.close();
  }
});

// Regression cases from real intake formats; all mutations use isolated databases.
test("集中等级清单支持独立标题，歧义和后续计划不继承", async () => {
  const { listedLevels } = await import("../src/lib/import-candidates");
  const text =
    "五、建议等级与证据边界\n1. 极限运算：C，基础题正确。\n2. 完整波形：暂未评估。\n3. 积分：B/C，归属不明。\n六、后续计划\n1. 导数：E";
  assert.equal(listedLevels(text).length, 2);
  assert.equal(
    sourceReportedLevel(text, { name: "极限运算", quote: "基础题正确" })?.level,
    "C",
  );
  assert.equal(
    sourceReportedLevel(text, { name: "极限计算", quote: "基础题正确" }),
    null,
  );
});
test("记录与对话日期仅作候选，跨日学习时间不默认首日", async () => {
  const { sourceDateCandidates } = await import("../src/lib/import-dates");
  const text =
    "记录日期：2026-10-18\n对话节点：2026-10-17 23:41开始，2026-10-18 00:01结束\n上传日期：2026-10-19\n建议复测日期：2026-10-20";
  assert.equal(sourceLearningDate(text), null);
  assert.deepEqual(
    sourceDateCandidates(text).map((x) => x.day),
    ["2026-10-18", "2026-10-17", "2026-10-18"],
  );
  assert.equal(
    sourceLearningDate("学习时间：2026-10-17 23:41至2026-10-18 00:01"),
    null,
  );
});
test("待复测建议默认不建任务，无逐字依据仅略过建议", async () => {
  const f = fixture();
  try {
    const output = f.output();
    const draft = await analyzeImport(f.source(), f.store, async () => ({
      ...output,
      items: output.items.map((x) => ({
        ...x,
        review: { action: "独立计算", quote: "虚构的待复测依据" },
      })),
    }));
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].review, null);
    applyImport(command(draft), f.store, clock);
    assert.equal(readTasks(f.store).length, 0);
  } finally {
    f.store.close();
  }
});
test("确认复测任务与录入原子保存、重试幂等、不制造通过证据", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text: f.source().text + "\n已纠正，尚未独立复测。",
    };
    const output = f.output();
    const review = {
      action: "脱离提示重新计算极限",
      quote: "已纠正，尚未独立复测。",
    };
    const draft = await analyzeImport(source, f.store, async () => ({
      ...output,
      items: output.items.map((x) => ({ ...x, review })),
    }));
    assert.equal(draft.items[0].review?.action, review.action);
    assert.equal(readTasks(f.store).length, 0);
    const c = command(draft, {
      rows: rows(draft).map((x) => ({
        ...x,
        reviewTask: { ...review, dueOn: "2026-10-09" },
      })),
    });
    const saved = applyImport(c, f.store, clock);
    assert.deepEqual(applyImport(c, f.store, clock), saved);
    const tasks = readTasks(f.store);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "PENDING");
    assert.match(tasks[0].reason, new RegExp(draft.id));
    assert.equal(count(f.store, "assessments"), 0);
    assert.equal(count(f.store, "error_records"), 0);
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "C");
  } finally {
    f.store.close();
  }
});
test("复测日期非法或已有待办时整次录入回滚", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text: f.source().text + "\n尚未独立复测。",
    };
    const draft = await analyzeImport(source, f.store, async () => f.output());
    const before = pointDetail(f.pointId, f.store).point;
    const c = command(draft, {
      rows: rows(draft).map((x) => ({
        ...x,
        reviewTask: {
          action: "独立检查",
          quote: "尚未独立复测。",
          dueOn: "2026-10-07",
        },
      })),
    });
    assert.throws(() => applyImport(c, f.store, clock), /过去/);
    assert.deepEqual(pointDetail(f.pointId, f.store).point, before);
    assert.equal(readImport(draft.id, f.store).status, "READY");
    executeTask(
      {
        action: "create",
        commandId: randomUUID(),
        id: randomUUID(),
        pointId: f.pointId,
        expectedPointVersion: before.version,
        kind: "SPOT_CHECK",
        dueOn: "2026-10-09",
        reason: "已有待办",
      },
      f.store,
      clock,
    );
    const fresh = await analyzeImport(
      { ...source, id: randomUUID() },
      f.store,
      async () => f.output(),
    );
    assert.throws(
      () =>
        applyImport(
          command(fresh, {
            rows: rows(fresh).map((x) => ({
              ...x,
              reviewTask: {
                action: "独立检查",
                quote: "尚未独立复测。",
                dueOn: "2026-10-09",
              },
            })),
          }),
          f.store,
          clock,
        ),
      /已有待处理任务/,
    );
    assert.equal(readImport(fresh.id, f.store).status, "READY");
    assert.equal(readTasks(f.store).length, 1);
  } finally {
    f.store.close();
  }
});

test("名称不同的 GPT 等级只提供可核对候选，不自动采用", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text:
        f.source().text +
        "\n五、建议等级与证据边界\n1. 极限基础运算：B，需再检查。",
    };
    const output = f.output();
    const draft = await analyzeImport(source, f.store, async () => ({
      ...output,
      items: output.items.map((x) => ({
        ...x,
        reportedLevel: { level: "B", quote: "1. 极限基础运算：B，需再检查。" },
      })),
    }));
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].reportedLevel, null);
    assert.equal(draft.items[0].levelCandidate?.level, "B");
    assert.equal(pointDetail(f.pointId, f.store).point.masteryLevel, "C");
  } finally {
    f.store.close();
  }
});

test("科目超过300点后可按章节整理，未选范围不会调用AI，旧请求仍兼容", async () => {
  const f = fixture();
  try {
    const otherChapter = randomUUID();
    executeCommand(
      {
        action: "create",
        entity: "chapter",
        id: otherChapter,
        parentId: f.subjectId,
        name: "其他章节",
        commandId: randomUUID(),
      },
      f.store,
    );
    f.store.raw.transaction(() => {
      for (let i = 0; i < 300; i++)
        executeCommand(
          {
            action: "create",
            entity: "point",
            id: randomUUID(),
            parentId: otherChapter,
            name: `其他知识点${i}`,
            commandId: randomUUID(),
          },
          f.store,
        );
    })();
    let calls = 0;
    await assert.rejects(
      () =>
        analyzeImport(f.source(), f.store, async () => {
          calls++;
          return f.output();
        }),
      /301.*整理范围/,
    );
    assert.equal(calls, 0);
    assert.equal(count(f.store, "_ai_imports"), 0);
    const input = { ...f.source(), chapterIds: [f.chapterId] };
    const draft = await analyzeImport(input, f.store, async (prompt) => {
      calls++;
      assert.ok(!prompt.includes("其他知识点0"));
      assert.ok(!prompt.includes(otherChapter));
      assert.match(prompt, /本次仅整理所选章节：极限/);
      return f.output();
    });
    assert.equal(draft.status, "READY");
    assert.equal(draft.context.points.length, 1);
    assert.equal(draft.context.chapters.length, 1);
    assert.deepEqual(draft.source.chapterIds, [f.chapterId]);
    assert.equal(count(f.store, "knowledge_points"), 301);
    applyImport(command(draft), f.store, clock);
    assert.equal(count(f.store, "knowledge_points"), 301);
    assert.equal(
      readImport(draft.id, f.store).source.chapterIds?.[0],
      f.chapterId,
    );
    // A changed range cannot reuse an already captured request id.
    await assert.rejects(
      () =>
        analyzeImport(
          { ...input, chapterIds: [otherChapter] },
          f.store,
          async () => f.output(),
        ),
      /编号已用于其他原文/,
    );
  } finally {
    f.store.close();
  }
});
test("章节范围拒绝越界、归档、重复及新科目绑定已有章节", async () => {
  const f = fixture();
  try {
    let calls = 0;
    const organizer = async () => {
      calls++;
      return f.output();
    };
    await assert.rejects(
      () =>
        analyzeImport(
          { ...f.source(), chapterIds: [randomUUID()] },
          f.store,
          organizer,
        ),
      /不存在/,
    );
    await assert.rejects(
      () =>
        analyzeImport(
          { ...f.source(), chapterIds: [f.chapterId, f.chapterId] },
          f.store,
          organizer,
        ),
      /重复/,
    );
    await assert.rejects(
      () =>
        analyzeImport(
          {
            ...f.source(),
            subject: { id: null, name: "新科目" },
            chapterIds: [f.chapterId],
          },
          f.store,
          organizer,
        ),
      /新科目不能/,
    );
    executeCommand(
      {
        action: "archive",
        entity: "chapter",
        id: f.chapterId,
        reason: "测试归档章节的范围校验",
        expectedVersion: 1,
        commandId: randomUUID(),
      },
      f.store,
    );
    await assert.rejects(
      () =>
        analyzeImport(
          { ...f.source(), chapterIds: [f.chapterId] },
          f.store,
          organizer,
        ),
      /已归档/,
    );
    assert.equal(calls, 0);
  } finally {
    f.store.close();
  }
});
test("限定章节后AI和确认稿都不能新增范围外章节，独立新章节入口可用", async () => {
  const f = fixture();
  try {
    const output = f.output();
    const draft = await analyzeImport(
      { ...f.source(), chapterIds: [f.chapterId] },
      f.store,
      async () => output,
    );
    assert.throws(
      () =>
        applyImport(
          command(draft, {
            rows: rows(draft).map((r) => ({
              ...r,
              pointId: null,
              chapterId: null,
              chapterName: "越界章节",
            })),
          }),
          f.store,
          clock,
        ),
      /限定章节/,
    );
    assert.equal(readImport(draft.id, f.store).status, "READY");
    const newOutput = {
      ...output,
      items: output.items.map((x) => ({
        ...x,
        pointId: null,
        chapterId: null,
        chapterName: "新的章节",
      })),
    };
    const failed = await analyzeImport(
      { ...f.source(), chapterIds: [f.chapterId] },
      f.store,
      async () => newOutput,
    );
    assert.equal(failed.status, "FAILED");
    assert.match(failed.error!, /不在所选范围/);
    const fresh = await analyzeImport(
      { ...f.source(), chapterIds: [] },
      f.store,
      async () => newOutput,
    );
    assert.equal(fresh.status, "READY");
    assert.equal(fresh.context.points.length, 0);
    assert.equal(fresh.context.chapters.length, 0);
    const result = applyImport(command(fresh), f.store, clock);
    assert.equal(result.pointIds.length, 1);
    assert.equal(count(f.store, "knowledge_points"), 2);
    assert.equal(count(f.store, "assessments"), 0);
  } finally {
    f.store.close();
  }
});

test("章节识别以当前材料依据为准，不把前置、计划或正文引用当作当前章节", async () => {
  const { sourceChapter, chapterKey } =
    await import("../src/lib/import-chapters");
  const text =
    "电力电子学习记录\n模块：PWM面积等效\n依据：第七章课件7.1，第3～5页\n前模块关联：第六章交流调压\n下一模块：第八章\n一、本模块定位\n依据：第二章公式";
  assert.equal(sourceChapter(text)?.name, "第七章");
  assert.equal(chapterKey("第７章 PWM"), 7);
  assert.equal(chapterKey("第七章"), 7);
  assert.equal(sourceChapter("前置知识：第六章\n下一模块：第七章"), null);
  assert.equal(sourceChapter("依据：第六章和第七章课件"), null);
  assert.equal(sourceChapter("依据：第六章至八章"), null);
  assert.equal(sourceChapter("依据：计划学习第七章"), null);
  assert.equal(
    sourceChapter("模块：第七章练习\n一、实际学习\n依据：第七章"),
    null,
  );
});
test("自动识别新章节并用章号替代模块名，确认时只创建一个章节且重复提交幂等", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      chapterMode: "AUTO",
      text:
        "模块：PWM面积等效\n依据：第七章课件7.1，第3～5页\n" + f.source().text,
    };
    const output = f.output();
    const draft = await analyzeImport(source, f.store, async () => ({
      ...output,
      items: [
        ...output.items.map((x) => ({
          ...x,
          pointId: null,
          chapterId: null,
          chapterName: "PWM面积等效模块",
        })),
        ...output.items.map((x) => ({
          ...x,
          pointId: null,
          chapterId: null,
          chapterName: null,
          name: "面积等效条件",
        })),
      ],
    }));
    assert.equal(draft.status, "READY");
    assert.equal(draft.context.points.length, 0);
    assert.ok(
      draft.items.every(
        (x) => x.chapterName === "第七章" && x.chapterId === null,
      ),
    );
    assert.equal(count(f.store, "chapters"), 1);
    const c = command(draft);
    const saved = applyImport(c, f.store, clock);
    assert.deepEqual(applyImport(c, f.store, clock), saved);
    assert.equal(count(f.store, "chapters"), 2);
    const chapter = readCatalog(f.store).chapters.find(
      (x) => x.name === "第七章",
    )!;
    assert.equal(
      readCatalog(f.store).points.filter((x) => x.chapterId === chapter.id)
        .length,
      2,
    );
    assert.equal(count(f.store, "assessments"), 0);
  } finally {
    f.store.close();
  }
});
test("新章节模式同样识别已存在的章号，自动归入且不创建重复章节", async () => {
  const f = fixture();
  try {
    const chapterId = randomUUID();
    executeCommand(
      {
        action: "create",
        entity: "chapter",
        id: chapterId,
        parentId: f.subjectId,
        name: "第7章 PWM控制",
        commandId: randomUUID(),
      },
      f.store,
    );
    const output = f.output();
    const draft = await analyzeImport(
      {
        ...f.source(),
        chapterIds: [],
        text: "依据：第七章课件\n" + f.source().text,
      },
      f.store,
      async () => ({
        ...output,
        items: output.items.map((x) => ({
          ...x,
          pointId: null,
          chapterId: null,
          chapterName: "面积等效原理",
        })),
      }),
    );
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].chapterId, chapterId);
    assert.equal(draft.items[0].chapterName, null);
    applyImport(command(draft), f.store, clock);
    assert.equal(count(f.store, "chapters"), 2);
    assert.equal(count(f.store, "knowledge_points"), 2);
  } finally {
    f.store.close();
  }
});
test("自动模式按原文重新确定范围，不沿用上次章节，冲突模式和重号均拒绝", async () => {
  const f = fixture();
  try {
    for (const name of ["第七章", "第7章 重号"])
      executeCommand(
        {
          action: "create",
          entity: "chapter",
          id: randomUUID(),
          parentId: f.subjectId,
          name,
          commandId: randomUUID(),
        },
        f.store,
      );
    let calls = 0;
    await assert.rejects(
      () =>
        analyzeImport(
          { ...f.source(), chapterMode: "AUTO", chapterIds: [f.chapterId] },
          f.store,
          async () => {
            calls++;
            return f.output();
          },
        ),
      /不能同时/,
    );
    await assert.rejects(
      () =>
        analyzeImport(
          {
            ...f.source(),
            chapterMode: "AUTO",
            text: "依据：第七章课件\n" + f.source().text,
          },
          f.store,
          async () => {
            calls++;
            return f.output();
          },
        ),
      /多个目录/,
    );
    assert.equal(calls, 0);
    const source = {
      ...f.source(),
      chapterMode: "AUTO",
      text: "依据：第八章课件\n" + f.source().text,
    };
    const output = f.output();
    const draft = await analyzeImport(source, f.store, async () => ({
      ...output,
      items: output.items.map((x) => ({
        ...x,
        pointId: null,
        chapterId: null,
        chapterName: "旧模块",
      })),
    }));
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].chapterName, "第八章");
    assert.equal(draft.context.chapters.length, 0);
  } finally {
    f.store.close();
  }
});
