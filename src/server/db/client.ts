import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export const businessTables = [
  "subjects",
  "chapters",
  "knowledge_points",
  "study_sessions",
  "study_session_points",
  "assessments",
  "error_records",
  "error_retests",
  "learning_tasks",
  "knowledge_events",
  "study_rounds",
  "round_review_records",
  "round_review_points",
] as const;
export function databasePath() {
  return path.resolve(process.env.DATABASE_PATH || "./data/study.sqlite");
}
export function migrationFiles() {
  const dir = path.join(process.cwd(), "drizzle");
  return readdirSync(dir)
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), "utf8");
      return {
        name,
        sql,
        hash: createHash("sha256").update(sql).digest("hex"),
      };
    });
}
export function applyMigrations(raw: Database.Database, file: string) {
  raw.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT",
  );
  const applied = raw
    .prepare("SELECT name, hash FROM _migrations ORDER BY name")
    .all() as { name: string; hash: string }[];
  const files = migrationFiles();
  for (let i = 0; i < applied.length; i++) {
    if (
      !files[i] ||
      files[i].name !== applied[i].name ||
      files[i].hash !== applied[i].hash
    )
      throw new Error("数据库迁移版本不匹配，已停止；请恢复对应的应用版本。");
  }
  const pending = files.slice(applied.length);
  if (pending.length && applied.length && file !== ":memory:") {
    const dir = path.join(path.dirname(file), "migration-backups");
    mkdirSync(dir, { recursive: true });
    raw
      .prepare("VACUUM INTO ?")
      .run(path.join(dir, `before-${Date.now()}.sqlite`));
  }
  const rebuild = pending.some((m) =>
    /^-- @requires-foreign-keys-off\s*$/m.test(m.sql),
  );
  const foreignKeys = raw.pragma("foreign_keys", { simple: true }) === 1;
  if (rebuild) raw.pragma("foreign_keys = OFF");
  try {
    raw
      .transaction(() => {
        for (const migration of pending) {
          raw.exec(migration.sql);
          raw
            .prepare("INSERT INTO _migrations VALUES (?, ?, ?)")
            .run(migration.name, migration.hash, new Date().toISOString());
        }
      if (rebuild && (raw.pragma("foreign_key_check") as unknown[]).length)
          throw new Error("数据库升级外键检查失败，已回滚；请检查升级前备份。");
        raw.pragma(`user_version = ${files.length}`);
      })
      .immediate();
  } finally {
    if (rebuild && foreignKeys) raw.pragma("foreign_keys = ON");
  }
}
export function openDatabase(file = databasePath(), lease = false) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const raw = new Database(file);
  let leaseFile: string | undefined;
  try {
    raw.pragma("foreign_keys = ON");
    raw.pragma("busy_timeout = 5000");
    raw.pragma("journal_mode = WAL");
    applyMigrations(raw, file);
    if (lease && file !== ":memory:") {
      const dir = `${file}.locks`;
      mkdirSync(dir, { recursive: true });
      leaseFile = path.join(dir, `${process.pid}.json`);
      writeFileSync(
        leaseFile,
        JSON.stringify({
          pid: process.pid,
          file,
          openedAt: new Date().toISOString(),
        }),
      );
      const cleanup = () => {
        if (leaseFile && existsSync(leaseFile)) {
          try {
            unlinkSync(leaseFile);
          } catch {}
        }
      };
      process.once("exit", cleanup);
    }
    return {
      raw,
      db: drizzle(raw, { schema }),
      file,
      close() {
        raw.close();
        if (leaseFile && existsSync(leaseFile)) unlinkSync(leaseFile);
      },
    };
  } catch (error) {
    raw.close();
    throw error;
  }
}
export type Store = ReturnType<typeof openDatabase>;
const globalStore = globalThis as unknown as { studyStore?: Store };
export function getStore(): Store {
  return (globalStore.studyStore ??= openDatabase(databasePath(), true));
}
