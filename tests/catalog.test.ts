import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  openDatabase,
  businessTables,
  migrationFiles,
} from "../src/server/db/client";
import {
  executeCommand,
  readCatalog,
  pointDetail,
  AppError,
} from "../src/server/catalog";
import {
  createBackup,
  restoreDatabase,
  exportData,
  validateDatabase,
} from "../src/server/backup";
import { sameOrigin, readBody } from "../src/server/http";

const tempRoot = path.resolve("work/test-databases");
mkdirSync(tempRoot, { recursive: true });
const folder = mkdtempSync(path.join(tempRoot, "run-"));
function fixture(file = ":memory:") {
  const store = openDatabase(file);
  const subjectId = randomUUID(),
    chapterId = randomUUID(),
    pointId = randomUUID();
  executeCommand(
    {
      action: "create",
      entity: "subject",
      commandId: randomUUID(),
      id: subjectId,
      name: "高等数学",
    },
    store,
  );
  executeCommand(
    {
      action: "create",
      entity: "chapter",
      commandId: randomUUID(),
      id: chapterId,
      parentId: subjectId,
      name: "极限",
    },
    store,
  );
  const command = {
    action: "create",
    entity: "point",
    commandId: randomUUID(),
    id: pointId,
    parentId: chapterId,
    name: "洛必达法则",
    initialLevel: "C",
    learningStage: "IN_PROGRESS",
    importance: 5,
  };
  executeCommand(command, store);
  return { store, subjectId, chapterId, pointId, command };
}
test("空库迁移幂等、业务表齐全、外键和 STRICT 约束有效", () => {
  const file = path.join(folder, "migration.sqlite");
  let s = openDatabase(file);
  for (const name of businessTables)
    assert.ok(
      s.raw
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
        .get(name),
    );
  assert.equal(s.raw.pragma("foreign_keys", { simple: true }), 1);
  assert.throws(
    () =>
      s.raw
        .prepare(
          "INSERT INTO chapters(id,subject_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .run("x", "missing", "x", "now", "now"),
    /FOREIGN KEY/,
  );
  s.close();
  s = openDatabase(file);
  assert.equal(
    (
      s.raw.prepare("SELECT count(*) AS n FROM _migrations").get() as {
        n: number;
      }
    ).n,
    migrationFiles().length,
  );
  s.close();
});
test("新建、修改、摘要的版本及审计保留；自评不得伪装成证据", () => {
  const { store, pointId } = fixture();
  try {
    let p = pointDetail(pointId, store);
    assert.equal(p.point.masteryLevel, "C");
    assert.equal(p.point.masteryBasis, "SELF_REPORTED");
    assert.equal(p.events.length, 1);
    executeCommand(
      {
        action: "edit",
        entity: "point",
        id: pointId,
        commandId: randomUUID(),
        expectedVersion: 1,
        name: "洛必达法则与条件",
        importance: 5,
        learningStage: "COVERED",
      },
      store,
    );
    executeCommand(
      {
        action: "summary",
        entity: "point",
        id: pointId,
        commandId: randomUUID(),
        expectedVersion: 2,
        summary: "会典型题，尚无迁移题证据",
        source: "AI_PASTED",
      },
      store,
    );
    p = pointDetail(pointId, store);
    assert.equal(p.point.version, 3);
    assert.equal(p.point.summaryBasedOnVersion, 3);
    assert.equal(p.point.masteryLevel, "C");
    assert.equal(p.events.length, 3);
    assert.match(p.events[1].beforeJson!, /洛必达法则/);
    assert.throws(
      () => store.raw.exec("UPDATE knowledge_events SET reason='overwritten'"),
      /append-only/,
    );
    assert.throws(
      () => store.raw.exec("DELETE FROM knowledge_events"),
      /append-only/,
    );
  } finally {
    store.close();
  }
});
test("双窗口过期编辑返回 409，未覆盖新内容", () => {
  const { store, pointId } = fixture();
  try {
    const c = {
      action: "edit",
      entity: "point",
      id: pointId,
      commandId: randomUUID(),
      expectedVersion: 1,
      name: "新名称",
    };
    executeCommand(c, store);
    assert.throws(
      () =>
        executeCommand(
          { ...c, commandId: randomUUID(), name: "旧表单" },
          store,
        ),
      (e) => e instanceof AppError && e.status === 409,
    );
    assert.equal(pointDetail(pointId, store).point.name, "新名称");
  } finally {
    store.close();
  }
});
test("重复提交幂等，同 commandId 不同内容拒绝；重复名失败无残留审计", () => {
  const { store, pointId, command } = fixture();
  try {
    executeCommand(command, store);
    assert.equal(pointDetail(pointId, store).events.length, 1);
    assert.throws(
      () => executeCommand({ ...command, name: "不同内容" }, store),
      (e) => e instanceof AppError && e.status === 409,
    );
    const before = store.raw
      .prepare("SELECT count(*) AS n FROM _command_receipts")
      .get();
    assert.throws(
      () =>
        executeCommand(
          { ...command, commandId: randomUUID(), id: randomUUID() },
          store,
        ),
      (e) => e instanceof AppError && e.status === 409,
    );
    assert.deepEqual(
      store.raw.prepare("SELECT count(*) AS n FROM _command_receipts").get(),
      before,
    );
  } finally {
    store.close();
  }
});
test("未知字段、越级自评 E、无效父级拒绝", () => {
  const { store, command } = fixture();
  try {
    for (const delta of [
      { initialLevel: "E" },
      { masteryBasis: "EVIDENCE" },
      { parentId: randomUUID() },
    ])
      assert.throws(
        () =>
          executeCommand(
            {
              ...command,
              commandId: randomUUID(),
              id: randomUUID(),
              name: "新点",
              ...delta,
            },
            store,
          ),
        (e) => e instanceof AppError && e.status === 400,
      );
  } finally {
    store.close();
  }
});
test("归档科目原子归档全部子级、取消任务、保留历史，归档下不可新增", () => {
  const { store, subjectId, chapterId, pointId, command } = fixture();
  try {
    const now = new Date().toISOString();
    store.raw
      .prepare(
        "INSERT INTO learning_tasks (id,knowledge_point_id,kind,due_on,reason,source,created_at,updated_at) VALUES(?,?,'REVIEW','2026-10-07','test','MANUAL',?,?)",
      )
      .run(randomUUID(), pointId, now, now);
    executeCommand(
      {
        action: "archive",
        entity: "subject",
        id: subjectId,
        commandId: randomUUID(),
        expectedVersion: 1,
        reason: "调整范围",
      },
      store,
    );
    const c = readCatalog(store);
    assert.ok(c.subjects[0].archivedAt);
    assert.ok(c.chapters[0].archivedAt);
    assert.ok(c.points[0].archivedAt);
    assert.equal(pointDetail(pointId, store).events.length, 3);
    assert.equal(
      (
        store.raw.prepare("SELECT status FROM learning_tasks").get() as {
          status: string;
        }
      ).status,
      "CANCELLED",
    );
    assert.throws(
      () =>
        executeCommand(
          {
            ...command,
            commandId: randomUUID(),
            id: randomUUID(),
            name: "不可新增",
          },
          store,
        ),
      (e) => e instanceof AppError && e.status === 400,
    );
    assert.equal(c.chapters[0].id, chapterId);
  } finally {
    store.close();
  }
});
test("重开数据库后完整持久化，在线备份可恢复并保留当前库副本", async () => {
  const file = path.join(folder, "persist.sqlite");
  const { store, pointId } = fixture(file);
  const backup = path.join(folder, "snapshot.sqlite");
  const original = exportData(store);
  await createBackup(store, backup);
  store.close();
  let s = openDatabase(file);
  assert.equal(pointDetail(pointId, s).point.name, "洛必达法则");
  executeCommand(
    {
      action: "edit",
      entity: "point",
      id: pointId,
      commandId: randomUUID(),
      expectedVersion: 1,
      name: "备份之后的修改",
    },
    s,
  );
  s.close();
  const restored = await restoreDatabase(backup, file);
  assert.ok(restored.previousBackup && existsSync(restored.previousBackup));
  s = openDatabase(file);
  assert.deepEqual(exportData(s).tables, original.tables);
  s.close();
  validateDatabase(backup);
});
test("错误版本备份及仍在运行的数据库拒绝恢复", async () => {
  const target = path.join(folder, "locked.sqlite");
  const { store } = fixture(target);
  const backup = path.join(folder, "locked-backup.sqlite");
  await createBackup(store, backup);
  store.close();
  mkdirSync(`${target}.locks`);
  writeFileSync(
    path.join(`${target}.locks`, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid }),
  );
  await assert.rejects(restoreDatabase(backup, target), /仍在运行/);
  const raw = new Database(backup);
  raw
    .prepare("UPDATE _migrations SET hash=? WHERE name=?")
    .run("tampered", "0001_initial.sql");
  raw.close();
  assert.throws(() => validateDatabase(backup), /版本/);
});
test("同源保护拒绝外站/缺失 Origin；JSON 大小与格式校验", async () => {
  for (const origin of ["https://example.com", "null", ""])
    assert.throws(
      () =>
        sameOrigin(
          new Request("http://127.0.0.1:4318/api/commands", {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
          }),
        ),
      /本地应用/,
    );
  sameOrigin(
    new Request("http://127.0.0.1:4318/api/commands", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:4318",
        "content-type": "application/json",
      },
    }),
  );
  await assert.rejects(
    readBody(
      new Request("http://localhost", { method: "POST", body: "broken" }),
    ),
    /无法读取/,
  );
  await assert.rejects(
    readBody(
      new Request("http://localhost", {
        method: "POST",
        body: "x".repeat(65537),
      }),
    ),
    /过长/,
  );
});
