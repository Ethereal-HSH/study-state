import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import {
  applyMigrations,
  businessTables,
  migrationFiles,
  openDatabase,
} from "../src/server/db/client";
import { executeCommand } from "../src/server/catalog";
import { executeLearning } from "../src/server/learning";
import { randomUUID } from "node:crypto";

const root = path.resolve("work/test-databases");
mkdirSync(root, { recursive: true });
const folder = mkdtempSync(path.join(root, "migration4-"));
function legacy(file: string) {
  const raw = new Database(file);
  raw.pragma("foreign_keys = ON");
  raw.exec(
    "CREATE TABLE _migrations(name TEXT PRIMARY KEY NOT NULL,hash TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT",
  );
  for (const m of migrationFiles().slice(0, 3)) {
    raw.exec(m.sql);
    raw
      .prepare("INSERT INTO _migrations VALUES(?,?,?)")
      .run(m.name, m.hash, new Date().toISOString());
  }
  raw.pragma("user_version = 3");
  return { raw, db: drizzle(raw, { schema }), file, close: () => raw.close() };
}
test("Schema 3 升级保留知识点、日志、错误、任务及追加历史，自动备份且恢复外键约束", () => {
  const file = path.join(folder, "legacy.sqlite");
  const old = legacy(file);
  const subject = randomUUID(),
    chapter = randomUUID(),
    point = randomUUID();
  executeCommand(
    {
      action: "create",
      entity: "subject",
      commandId: randomUUID(),
      id: subject,
      name: "迁移验收科目",
    },
    old,
  );
  executeCommand(
    {
      action: "create",
      entity: "chapter",
      commandId: randomUUID(),
      id: chapter,
      parentId: subject,
      name: "章节",
    },
    old,
  );
  executeCommand(
    {
      action: "create",
      entity: "point",
      commandId: randomUUID(),
      id: point,
      parentId: chapter,
      name: "知识点",
      initialLevel: "C",
    },
    old,
  );
  executeLearning(
    {
      action: "session",
      commandId: randomUUID(),
      id: randomUUID(),
      subjectId: subject,
      startedLocal: "2026-10-06T09:00",
      endedLocal: "2026-10-06T09:30",
      durationMinutes: 25,
      points: [{ id: point, expectedVersion: 1, activity: "LEARN" }],
    },
    old,
    new Date("2026-10-07T12:00Z"),
  );
  executeLearning(
    {
      action: "assessment",
      commandId: randomUUID(),
      id: randomUUID(),
      pointId: point,
      expectedVersion: 2,
      occurredLocal: "2026-10-06T10:00",
      question: "保留原测试",
      result: "FAIL",
      error: {},
    },
    old,
    new Date("2026-10-07T12:00Z"),
  );
  old.raw
    .prepare(
      "INSERT INTO learning_tasks(id,knowledge_point_id,kind,due_on,reason,source,created_at,updated_at) VALUES(?,?,'REVIEW','2026-10-10','保留任务','MANUAL','now','now')",
    )
    .run(randomUUID(), point);
  const tables = [
    ...businessTables.filter((t) =>
      old.raw
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
        .get(t),
    ),
    "_catalog_events",
    "_command_receipts",
    "_ai_imports",
  ];
  const before = Object.fromEntries(
    tables.map((t) => [
      t,
      old.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
    ]),
  );
  old.close();
  const store = openDatabase(file);
  try {
    for (const t of tables)
      assert.deepEqual(
        store.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        before[t],
        t,
      );
    assert.equal(
      store.raw.pragma("user_version", { simple: true }),
      migrationFiles().length,
    );
    for (const table of [
      "study_rounds",
      "round_review_records",
      "round_review_points",
      "_round_imports",
    ])
      assert.equal(
        (
          store.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
        0,
      );
    assert.equal(store.raw.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(store.raw.pragma("foreign_key_check"), []);
    assert.deepEqual(store.raw.pragma("integrity_check"), [
      { integrity_check: "ok" },
    ]);
    assert.throws(
      () =>
        store.raw
          .prepare(
            "UPDATE knowledge_points SET chapter_id='missing' WHERE id=?",
          )
          .run(point),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        store.raw
          .prepare("UPDATE knowledge_events SET reason='overwrite'")
          .run(),
      /append-only/,
    );
    executeLearning(
      {
        action: "state",
        mode: "SELF_REPORTED",
        commandId: randomUUID(),
        pointId: point,
        expectedVersion: 3,
        targetLevel: "E",
        reason: "自评 E",
      },
      store,
    );
    const backup = path.join(
      folder,
      "migration-backups",
      readdirSync(path.join(folder, "migration-backups"))[0],
    );
    const saved = new Database(backup, { readonly: true });
    try {
      assert.equal(saved.pragma("user_version", { simple: true }), 3);
      for (const t of tables)
        assert.deepEqual(
          saved.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          before[t],
          t,
        );
    } finally {
      saved.close();
    }
  } finally {
    store.close();
  }
});
test("迁移发现断裂外键时整批回滚，并恢复外键开关", () => {
  const file = path.join(folder, "invalid.sqlite"),
    old = legacy(file);
  try {
    old.raw.pragma("foreign_keys = OFF");
    old.raw
      .prepare(
        "INSERT INTO chapters(id,subject_id,name,created_at,updated_at) VALUES('bad','missing','坏引用','now','now')",
      )
      .run();
    old.raw.pragma("foreign_keys = ON");
    assert.throws(() => applyMigrations(old.raw, file), /外键检查失败/);
    assert.equal(old.raw.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(old.raw.pragma("user_version", { simple: true }), 3);
    assert.equal(
      (
        old.raw.prepare("SELECT count(*) AS n FROM _migrations").get() as {
          n: number;
        }
      ).n,
      3,
    );
    assert.ok(
      (
        old.raw
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE name='knowledge_points'",
          )
          .get() as { sql: string }
      ).sql.includes("mastery_level <> 'E'"),
    );
    assert.equal(
      old.raw
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='knowledge_points_new'",
        )
        .get(),
      undefined,
    );
  } finally {
    old.close();
  }
});
