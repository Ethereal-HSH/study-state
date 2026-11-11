import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  migrationFiles,
  type Store,
} from "../src/server/db/client";
import { executeCommand, pointDetail } from "../src/server/catalog";
import {
  exportData,
  createBackup,
  restoreDatabase,
} from "../src/server/backup";
import {
  createStudyRound,
  readStudyRounds,
  analyzeRoundImport,
  applyRoundImport,
  readRoundDraft,
  readRoundReviews,
  retryRoundImport,
} from "../src/server/study-rounds";
import { analyzeImport } from "../src/server/imports";
import { executeLearning } from "../src/server/learning";
import { suggestionFor } from "../src/server/tasks";
import { buildSummary, writeSummary } from "../src/server/summaries";
import {
  summaryCoverage,
  narrativeMarkdown,
  summaryMarkdown,
} from "../src/lib/summary-models";
import {
  studyRoundMarkdown,
  verifiedRoundItemIds,
  type RoundEvaluation,
} from "../src/lib/round-models";

const clock = new Date("2026-10-24T12:00:00Z");
const root = path.resolve("work/test-databases");
mkdirSync(root, { recursive: true });
const folder = mkdtempSync(path.join(root, "rounds-"));
function fixture(file = ":memory:") {
  const store = openDatabase(file),
    subject = randomUUID(),
    foreign = randomUUID(),
    chapters = [randomUUID(), randomUUID()],
    point = randomUUID(),
    other = randomUUID(),
    secret = randomUUID(),
    foreignChapter = randomUUID();
  for (const [id, name] of [
    [subject, "综合学习演示"],
    [foreign, "范围外科目"],
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
    [chapters[0], subject, "第五章"],
    [chapters[1], subject, "第七章"],
    [foreignChapter, foreign, "外部章节"],
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
    [point, chapters[0], "降压电路平均输出"],
    [other, chapters[1], "双极式PWM"],
    [secret, foreignChapter, "范围外秘密"],
  ])
    executeCommand(
      {
        action: "create",
        entity: "point",
        commandId: randomUUID(),
        id,
        parentId,
        name,
        initialLevel: "C",
      },
      store,
    );
  executeCommand(
    {
      action: "summary",
      entity: "point",
      commandId: randomUUID(),
      id: point,
      expectedVersion: pointDetail(point, store).point.version,
      summary: "第一轮：常规降压计算已记录。不能外发的完整旧笔记标记。",
      source: "MANUAL",
    },
    store,
  );
  const roundId = randomUUID(),
    create = {
      commandId: randomUUID(),
      id: roundId,
      subjectId: subject,
      number: 2,
      name: "整体结构",
      objective: "需求—电路—控制—输出，跨章节综合检查。",
      startedOn: "2026-10-23",
    };
  createStudyRound(create, store, clock);
  const source = () => ({
    id: randomUUID(),
    roundId,
    text: "学习日期：2026-10-23\n同一控制规律换电路：首次求错变量，给出代入式后订正。建议等级：C。尚未无提示重做。",
    fileName: "第二轮.txt",
    sendToGpt: true as const,
  });
  const evaluation: RoundEvaluation = {
    performance: "CORRECTED",
    firstAnswer: "首次求错了变量。",
    assistance: "已给代入式。",
    correction: "提示后正确求输出。",
    remaining: "尚未无提示重做。",
    sourceLevel: "C",
    sourceLevelQuote: "建议等级：C",
  };
  const output = () => ({
    overview: "围绕同一控制规律比较两种电路输出，提示后完成。",
    items: [
      {
        title: "同一控制规律换电路",
        summary: "给定D求输出时首次求错变量，提示后已订正，独立重做仍待验证。",
        quote: "首次求错变量，给出代入式后订正",
        pointIds: [point, other],
        evaluation: { ...evaluation },
      },
    ],
    warnings: [],
  });
  const apply = (
    draft: Awaited<ReturnType<typeof analyzeRoundImport>>,
    patch = {},
  ) => ({
    commandId: randomUUID(),
    id: draft.id,
    expectedVersion: draft.version,
    learningDate: draft.learningDate,
    overview: draft.overview,
    rows: draft.items,
    ...patch,
  });
  return {
    store,
    subject,
    chapters,
    point,
    other,
    secret,
    roundId,
    source,
    output,
    apply,
    create,
  };
}
function count(store: Store, table: string) {
  return (
    store.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }
  ).n;
}

test("轮次保存冻结基线，不改写第一轮；重复编号、未来日期及提交冲突均拒绝", () => {
  const f = fixture();
  try {
    const baseline = readStudyRounds(f.store)[0].baseline;
    assert.equal(
      baseline.points.find((x) => x.id === f.point)?.masteryLevel,
      "C",
    );
    assert.match(
      baseline.points.find((x) => x.id === f.point)!.aiSummary!,
      /第一轮/,
    );
    assert.deepEqual(createStudyRound(f.create, f.store, clock), {
      id: f.roundId,
    });
    assert.throws(
      () => createStudyRound({ ...f.create, id: randomUUID() }, f.store, clock),
      /提交编号/,
    );
    assert.throws(
      () =>
        createStudyRound(
          { ...f.create, id: randomUUID(), commandId: randomUUID() },
          f.store,
          clock,
        ),
      /轮次已存在/,
    );
    assert.throws(
      () =>
        createStudyRound(
          {
            ...f.create,
            id: randomUUID(),
            commandId: randomUUID(),
            number: 3,
            startedOn: "2026-10-25",
          },
          f.store,
          clock,
        ),
      /未来/,
    );
    executeCommand(
      {
        action: "summary",
        entity: "point",
        commandId: randomUUID(),
        id: f.point,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        summary: "之后编辑的摘要",
        source: "MANUAL",
      },
      f.store,
    );
    assert.deepEqual(readStudyRounds(f.store)[0].baseline, baseline);
    assert.throws(
      () =>
        f.store.raw.prepare("UPDATE study_rounds SET baseline_json='{}'").run(),
      /immutable/,
    );
  } finally {
    f.store.close();
  }
});

test("先留原文和可编辑草稿，只发当前原文与名称目录，不发完整第一轮笔记", async () => {
  const f = fixture();
  try {
    const before = exportData(f.store).tables,
      source = f.source();
    let calls = 0;
    const draft = await analyzeRoundImport(source, f.store, async (prompt) => {
      calls++;
      assert.match(prompt, /同一任务可关联多个章节/);
      assert.doesNotMatch(prompt, /完整旧笔记标记|范围外秘密/);
      return f.output();
    });
    assert.equal(draft.status, "READY");
    assert.equal(draft.items.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual(draft.items[0].pointIds, [f.point, f.other]);
    const after = exportData(f.store).tables;
    for (const table of [
      "knowledge_points",
      "knowledge_events",
      "round_review_records",
      "assessments",
      "learning_tasks",
    ])
      assert.deepEqual(after[table], before[table]);
    await analyzeRoundImport(source, f.store, async () => {
      calls++;
      return f.output();
    });
    assert.equal(calls, 1);
    assert.throws(
      () =>
        f.store.raw.prepare("UPDATE _round_imports SET input_json='{}'").run(),
      /immutable/,
    );
    assert.equal(readRoundDraft(draft.id, f.store).source.text, source.text);
    await assert.rejects(
      () =>
        analyzeRoundImport(
          { ...f.source(), sendToGpt: false },
          f.store,
          async () => {
            calls++;
            return f.output();
          },
        ),
      /true/,
    );
    assert.equal(calls, 1);
  } finally {
    f.store.close();
  }
});

test("一条综合任务关联跨章多点，只追加本轮表现，原等级摘要不变且不产生复测通过", async () => {
  const f = fixture();
  try {
    const original = f.store.raw
        .prepare("SELECT * FROM knowledge_points ORDER BY id")
        .all(),
      baseline = readStudyRounds(f.store)[0].baseline;
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    const c = f.apply(draft);
    const result = applyRoundImport(c, f.store, clock);
    assert.equal(result.recordIds.length, 1);
    assert.equal(count(f.store, "round_review_records"), 1);
    assert.equal(count(f.store, "round_review_points"), 2);
    assert.equal(readRoundReviews(f.store, f.point).length, 1);
    assert.equal(readRoundReviews(f.store, f.other).length, 1);
    assert.equal(readRoundReviews(f.store)[0].evaluation.sourceLevel, "C");
    assert.deepEqual(
      f.store.raw.prepare("SELECT * FROM knowledge_points ORDER BY id").all(),
      original,
    );
    assert.deepEqual(readStudyRounds(f.store)[0].baseline, baseline);
    for (const table of [
      "assessments",
      "error_records",
      "learning_tasks",
      "study_sessions",
    ])
      assert.equal(count(f.store, table), 0);
    assert.deepEqual(applyRoundImport(c, f.store, clock), result);
    assert.equal(count(f.store, "round_review_records"), 1);
    assert.throws(
      () => applyRoundImport({ ...c, overview: "修改内容" }, f.store, clock),
      /提交编号/,
    );
    const markdown = studyRoundMarkdown(
      readStudyRounds(f.store)[0],
      readRoundReviews(f.store),
      [draft.overview],
    );
    assert.match(markdown, /第一轮/);
    assert.match(markdown, /首次求错/);
    assert.match(markdown, /提示后/);
  } finally {
    f.store.close();
  }
});

test("本轮未测、仅讲解及未指定知识点的整体任务均保留，不降级原C或伪造个人弱点", async () => {
  const f = fixture();
  try {
    const out = f.output();
    out.items[0].evaluation = {
      ...out.items[0].evaluation,
      performance: "UNTESTED",
      firstAnswer: null,
      assistance: null,
      correction: null,
      sourceLevel: null,
      sourceLevelQuote: null,
    };
    out.items.push({ ...out.items[0], title: "整体框架待验证", pointIds: [] });
    const draft = await analyzeRoundImport(
      f.source(),
      f.store,
      async () => out,
    );
    applyRoundImport(f.apply(draft, { learningDate: null }), f.store, clock);
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
    assert.equal(readRoundReviews(f.store).length, 2);
    assert.equal(
      readRoundReviews(f.store).filter((x) => !x.pointIds.length).length,
      1,
    );
    const r = buildSummary(
      { from: null, to: null, subjectId: f.subject, chapterId: null },
      f.store,
      clock,
    );
    assert.equal(r.stats.reviewRecords, 2);
    assert.equal(r.stats.assessments, 0);
    assert.equal(r.stats.minutes, 0);
    assert.equal(
      buildSummary({ ...r.filter, from: "2026-10-23" }, f.store, clock).stats
        .reviewRecords,
      0,
    );
  } finally {
    f.store.close();
  }
});

test("日期、原文、范围、版本或重复项目出错时整批回滚，不部分保存", async () => {
  const f = fixture();
  try {
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    const c = f.apply(draft);
    for (const patch of [
      { learningDate: "2026-10-25" },
      { rows: [{ ...draft.items[0], pointIds: [f.secret] }] },
      { rows: [draft.items[0], draft.items[0]] },
      { rows: [{ ...draft.items[0], quote: "不存在的原文" }] },
    ]) {
      assert.throws(
        () => applyRoundImport({ ...c, ...patch }, f.store, clock),
        /未来|范围|项目|依据/,
      );
      assert.equal(count(f.store, "round_review_records"), 0);
    }
    executeCommand(
      {
        action: "summary",
        entity: "point",
        commandId: randomUUID(),
        id: f.other,
        expectedVersion: pointDetail(f.other, f.store).point.version,
        summary: "另一窗口新摘要",
        source: "MANUAL",
      },
      f.store,
    );
    assert.throws(() => applyRoundImport(c, f.store, clock), /已更新/);
    assert.equal(count(f.store, "round_review_records"), 0);
    assert.equal(readRoundDraft(draft.id, f.store).status, "READY");
  } finally {
    f.store.close();
  }
});

test("第三轮保留此前综合任务关联，第二轮历史和开始时基线仍不变", async () => {
  const f = fixture();
  try {
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    applyRoundImport(f.apply(draft), f.store, clock);
    const second = readStudyRounds(f.store)[0];
    const id = randomUUID();
    createStudyRound(
      { ...f.create, number: 3, id, commandId: randomUUID() },
      f.store,
      clock,
    );
    const third = readStudyRounds(f.store).find((x) => x.id === id)!;
    assert.deepEqual(
      third.baseline.priorReviewIds,
      readRoundReviews(f.store).map((x) => x.id),
    );
    assert.deepEqual(
      readStudyRounds(f.store).find((x) => x.id === f.roundId),
      second,
    );
  } finally {
    f.store.close();
  }
});

test("总结按日期收录综合任务，按章保留共享上下文但全科只计一次，草稿引用可核对", async () => {
  const f = fixture();
  try {
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    applyRoundImport(f.apply(draft), f.store, clock);
    const filter = {
      from: null,
      to: null,
      subjectId: f.subject,
      chapterId: null,
    };
    const r = buildSummary(filter, f.store, clock);
    assert.equal(r.stats.reviewRecords, 1);
    assert.equal(r.stats.recordedPoints, 2);
    assert.equal(r.stats.assessments, 0);
    const chapter = buildSummary(
      { ...filter, chapterId: f.chapters[0] },
      f.store,
      clock,
    );
    assert.equal(chapter.reviewRecords[0].shared, true);
    assert.deepEqual(chapter.reviewRecords[0].pointIds, [f.point]);
    assert.match(summaryMarkdown(r), /第2轮综合评估/);
    assert.match(summaryMarkdown(r), /首次作答/);
    const narrative = await writeSummary(
      { filter, snapshotToken: r.snapshotToken },
      f.store,
      async (prompt) => {
        assert.match(prompt, /同一控制规律换电路/);
        return {
          overview: "第二轮提示后完成。",
          observations: [
            {
              text: "提示后订正，仍待独立验证。",
              evidenceIds: [`round-review:${r.reviewRecords[0].id}`],
            },
          ],
          recommendations: [],
          warnings: [],
        };
      },
      clock,
    );
    assert.equal(summaryCoverage(narrative, r).covered, 1);
    assert.match(narrativeMarkdown(narrative, r), /### 2026-10-23/);
  } finally {
    f.store.close();
  }
});

test("失败保留原文，重试不静默外发；入口互斥，外来引用拒收，未核对摘录仅保留草稿", async () => {
  const f = fixture();
  try {
    const source = f.source();
    let calls = 0;
    let draft = await analyzeRoundImport(source, f.store, async () => {
      calls++;
      throw new Error("演示网络中断");
    });
    assert.equal(draft.status, "FAILED");
    assert.equal(readRoundDraft(draft.id, f.store).source.text, source.text);
    draft = await retryRoundImport(
      draft.id,
      draft.version,
      f.store,
      async () => {
        calls++;
        return f.output();
      },
    );
    assert.equal(draft.status, "READY");
    assert.equal(calls, 2);
    for (const bad of [
      { ...f.output().items[0], pointIds: [f.secret] },
      { ...f.output().items[0], quote: "编造摘录" },
    ]) {
      const result = await analyzeRoundImport(
        f.source(),
        f.store,
        async () => ({ ...f.output(), items: [bad] }),
      );
      if (bad.pointIds.includes(f.secret))
        assert.equal(result.status, "FAILED");
      else {
        assert.equal(result.status, "READY");
        assert.equal(result.items[0].quoteVerified, false);
        assert.deepEqual(verifiedRoundItemIds(result), []);
        assert.throws(
          () => applyRoundImport(f.apply(result), f.store, clock),
          /依据必须逐字/,
        );
      }
    }
    let release!: (value: unknown) => void;
    const pending = analyzeRoundImport(
      f.source(),
      f.store,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await assert.rejects(
      () =>
        analyzeImport(
          {
            id: randomUUID(),
            subject: { id: f.subject, name: "综合学习演示" },
            text: "测试",
            attachment: null,
          },
          f.store,
          async () => ({ items: [], warnings: [] }),
        ),
      /已有/,
    );
    release(f.output());
    await pending;
  } finally {
    f.store.close();
  }
});

test("一项摘录未核对不丢弃整份草稿，默认只选择可核对项；伪造校验标记也不能保存", async () => {
  const f = fixture();
  try {
    const out = f.output();
    out.items.push({
      ...out.items[0],
      title: "另一道综合问题",
      quote: "原文没有这段概括",
    });
    const draft = await analyzeRoundImport(
      f.source(),
      f.store,
      async () => out,
    );
    assert.equal(draft.status, "READY");
    assert.equal(draft.items.length, 2);
    assert.deepEqual(
      draft.items.map((x) => x.quoteVerified),
      [true, false],
    );
    assert.deepEqual(verifiedRoundItemIds(draft), [draft.items[0].id]);
    assert.ok(draft.warnings.some((x) => x.includes("默认不选中")));
    assert.throws(
      () =>
        applyRoundImport(
          f.apply(draft, {
            rows: [{ ...draft.items[1], quoteVerified: true }],
          }),
          f.store,
          clock,
        ),
      /依据必须逐字/,
    );
    assert.equal(count(f.store, "round_review_records"), 0);
    applyRoundImport(
      f.apply(draft, { rows: [draft.items[0]] }),
      f.store,
      clock,
    );
    const saved = readRoundDraft(draft.id, f.store);
    assert.equal(saved.applied?.rows.length, 1);
    assert.equal(saved.items.length, 2);
    assert.equal(saved.items[1].quote, "原文没有这段概括");
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "C");
  } finally {
    f.store.close();
  }
});

test("排版差异还原真实原文；本人修正未核对摘录后可保存，不更改原文或旧等级", async () => {
  const f = fixture();
  try {
    const source = {
      ...f.source(),
      text: "学习日期：2026-10-23\n首次求错变量，\r\n  给出代入式后订正\n建议等级：C。尚未无提示重做。",
    };
    const out = f.output();
    out.items.push({
      ...out.items[0],
      title: "第二项",
      quote: "原文没有这段话",
    });
    const draft = await analyzeRoundImport(source, f.store, async () => out);
    assert.equal(draft.status, "READY");
    assert.equal(draft.items[0].quote, "首次求错变量，\r\n  给出代入式后订正");
    const originalPoints = f.store.raw
      .prepare("SELECT * FROM knowledge_points ORDER BY id")
      .all();
    const rows = draft.items.map((x, i) =>
      i ? { ...x, quote: "尚未无提示重做。" } : x,
    );
    applyRoundImport(f.apply(draft, { rows }), f.store, clock);
    const saved = readRoundDraft(draft.id, f.store);
    assert.equal(saved.applied?.rows.length, 2);
    assert.ok(saved.applied?.rows.every((x) => x.quoteVerified));
    assert.equal(saved.source.text, source.text);
    assert.deepEqual(
      f.store.raw.prepare("SELECT * FROM knowledge_points ORDER BY id").all(),
      originalPoints,
    );
  } finally {
    f.store.close();
  }
});

test("分轮原文、确认结果与基线可完整导出备份并独立恢复", async () => {
  const f = fixture(path.join(folder, `source-${randomUUID()}.sqlite`));
  const backup = path.join(folder, `backup-${randomUUID()}.sqlite`),
    target = path.join(folder, `restored-${randomUUID()}.sqlite`);
  let before: ReturnType<typeof exportData>;
  try {
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    applyRoundImport(f.apply(draft), f.store, clock);
    before = exportData(f.store);
    assert.equal(before.tables._round_imports.length, 1);
    await createBackup(f.store, backup);
  } finally {
    f.store.close();
  }
  await restoreDatabase(backup, target);
  const restored = openDatabase(target);
  try {
    assert.deepEqual(exportData(restored).tables, before!.tables);
    assert.equal(readRoundReviews(restored).length, 1);
  } finally {
    restored.close();
  }
});

test("Schema4升级新增轮次表并自动备份，旧知识点与原文历史逐行保持", () => {
  const file = path.join(folder, `v4-${randomUUID()}.sqlite`),
    raw = new Database(file);
  raw.exec(
    "CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,hash TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT",
  );
  for (const m of migrationFiles().slice(0, 4)) {
    raw.exec(m.sql);
    raw
      .prepare("INSERT INTO _migrations VALUES(?,?,?)")
      .run(m.name, m.hash, "now");
  }
  raw.pragma("user_version=4");
  const subject = randomUUID();
  raw
    .prepare(
      "INSERT INTO subjects(id,name,created_at,updated_at) VALUES(?,?,?,?)",
    )
    .run(subject, "保留旧科目", "now", "now");
  const before = raw.prepare("SELECT * FROM subjects").all();
  raw.close();
  const store = openDatabase(file);
  try {
    assert.deepEqual(store.raw.prepare("SELECT * FROM subjects").all(), before);
    assert.equal(store.raw.pragma("user_version", { simple: true }), 5);
    assert.equal(count(store, "study_rounds"), 0);
    assert.deepEqual(store.raw.pragma("foreign_key_check"), []);
    assert.ok(readdirSync(path.join(folder, "migration-backups")).length > 0);
  } finally {
    store.close();
  }
});

test("综合模式可匹配超过300点的整科学习目录，不按单章强行拆开；原文空白完整保留", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 301; i++)
      executeCommand(
        {
          action: "create",
          entity: "point",
          id: randomUUID(),
          commandId: randomUUID(),
          parentId: f.chapters[i % 2],
          name: `补充基础点${i}`,
        },
        f.store,
      );
    const source = { ...f.source(), text: `\n  ${f.source().text}\n\n` };
    const draft = await analyzeRoundImport(source, f.store, async (prompt) => {
      assert.match(prompt, /补充基础点300/);
      return f.output();
    });
    assert.equal(draft.status, "READY");
    assert.equal(draft.context.length, 303);
    assert.equal(draft.source.text, source.text);
  } finally {
    f.store.close();
  }
});

test("分轮实际练习日期参与复习建议和E级间隔校验，本轮未测不算练习", async () => {
  const f = fixture();
  try {
    const originalSuggestion = suggestionFor(f.point, f.store, clock);
    assert.equal(originalSuggestion.dueOn, null);
    executeLearning(
      {
        action: "state",
        mode: "SELF_REPORTED",
        commandId: randomUUID(),
        pointId: f.point,
        expectedVersion: pointDetail(f.point, f.store).point.version,
        targetLevel: "D",
        reason: "测试已有自评D的延迟校验。",
      },
      f.store,
      clock,
    );
    const first = randomUUID();
    const assessment = (id: string, occurredLocal: string) => ({
      action: "assessment",
      commandId: randomUUID(),
      id,
      pointId: f.point,
      expectedVersion: pointDetail(f.point, f.store).point.version,
      occurredLocal,
      question: "独立解释新变式。",
      result: "PASS",
      taskType: "VARIANT",
      independent: true,
      hintCount: 0,
      answerViewed: false,
      isNew: true,
      canExplain: true,
    });
    executeLearning(assessment(first, "2026-10-10T10:00"), f.store, clock);
    const prior = suggestionFor(f.point, f.store, clock);
    const draft = await analyzeRoundImport(f.source(), f.store, async () =>
      f.output(),
    );
    applyRoundImport(f.apply(draft), f.store, clock);
    const after = suggestionFor(f.point, f.store, clock);
    assert.notEqual(after.token, prior.token);
    assert.equal(after.dueOn, "2026-11-06");
    assert.throws(
      () =>
        executeLearning(
          {
            ...assessment(randomUUID(), "2026-10-24T10:00"),
            state: {
              targetLevel: "E",
              reason: "两次测试虽然间隔14天，但昨天仍有复习。",
              evidenceIds: [first],
            },
          },
          f.store,
          clock,
        ),
      /不足 7/,
    );
    assert.equal(pointDetail(f.point, f.store).point.masteryLevel, "D");
  } finally {
    f.store.close();
  }
  const f2 = fixture();
  try {
    const out = f2.output();
    out.items[0].evaluation = {
      ...out.items[0].evaluation,
      performance: "UNTESTED",
      sourceLevel: null,
      sourceLevelQuote: null,
    };
    const draft = await analyzeRoundImport(
      f2.source(),
      f2.store,
      async () => out,
    );
    applyRoundImport(f2.apply(draft), f2.store, clock);
    assert.equal(suggestionFor(f2.point, f2.store, clock).dueOn, null);
    assert.equal(pointDetail(f2.point, f2.store).point.masteryLevel, "C");
  } finally {
    f2.store.close();
  }
});
