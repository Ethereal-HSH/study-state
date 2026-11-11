import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { businessTables, migrationFiles, type Store } from "./db/client";

export function validateDatabase(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const check = db.pragma("integrity_check") as { integrity_check: string }[];
    if (
      check.length !== 1 ||
      check[0].integrity_check !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length
    )
      throw new Error("备份完整性或外键检查失败");
    const versions = db
      .prepare("SELECT name, hash FROM _migrations ORDER BY name")
      .all() as { name: string; hash: string }[];
    const expected = migrationFiles();
    if (
      versions.length !== expected.length ||
      versions.some(
        (v, i) => v.name !== expected[i].name || v.hash !== expected[i].hash,
      )
    )
      throw new Error("备份版本与当前应用不一致，请使用相同应用版本恢复");
    for (const table of businessTables)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    db.prepare("SELECT 1 FROM _ai_imports LIMIT 1").get();
    db.prepare("SELECT 1 FROM _round_imports LIMIT 1").get();
  } finally {
    db.close();
  }
}
export async function createBackup(store: Store, destination?: string) {
  const dir = path.resolve("backups");
  const target = destination
    ? path.resolve(destination)
    : path.join(
        dir,
        `study-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.sqlite`,
      );
  if (existsSync(target)) throw new Error("备份文件已存在，拒绝覆盖");
  mkdirSync(path.dirname(target), { recursive: true });
  await store.raw.backup(target);
  validateDatabase(target);
  return target;
}
export function assertStopped(target: string) {
  const dir = `${target}.locks`;
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const info = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as {
      pid: number;
    };
    let active = true;
    try {
      process.kill(info.pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") active = false;
    }
    if (active)
      throw new Error(
        `应用仍在运行（PID ${info.pid}）。请关闭应用服务后再恢复。`,
      );
  }
}
export async function restoreDatabase(source: string, target: string) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (source === target) throw new Error("备份和目标不能相同");
  validateDatabase(source);
  assertStopped(target);
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-${randomUUID()}.sqlite`;
  const old = `${target}.before-restore-${Date.now()}.sqlite`;
  const incoming = new Database(source, { readonly: true });
  try {
    await incoming.backup(temp);
  } finally {
    incoming.close();
  }
  validateDatabase(temp);
  assertStopped(target);
  let hadOriginal = false;
  try {
    if (existsSync(target)) {
      const previous = new Database(target, { fileMustExist: true });
      try {
        previous.pragma("busy_timeout=1000");
        await previous.backup(old);
        const result = previous.pragma("wal_checkpoint(TRUNCATE)") as {
          busy: number;
        }[];
        if (result.some((x) => x.busy))
          throw new Error("数据库正在使用，请停止服务");
      } finally {
        previous.close();
      }
      hadOriginal = true;
    }
    // The app lease and final checkpoint above require an offline application.
    // Only the explicitly selected database and its SQLite sidecars are replaced.
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(`${target}${suffix}`)) unlinkSync(`${target}${suffix}`);
    renameSync(temp, target);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  return { target, previousBackup: hadOriginal ? old : null };
}
export function exportData(store: Store) {
  const tables = [
    ...businessTables,
    "_catalog_events",
    "_command_receipts",
    "_migrations",
    "_ai_imports",
    "_round_imports",
  ];
  return store.raw.transaction(() => ({
    schema_version: migrationFiles().length,
    app_version: "0.6.1",
    exported_at: new Date().toISOString(),
    timezone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    tables: Object.fromEntries(
      tables.map((t) => [t, store.raw.prepare(`SELECT * FROM ${t}`).all()]),
    ),
  }))();
}
