import { Database, HardDrive, Clock3, ShieldCheck } from "lucide-react";
import { getStore, migrationFiles } from "@/server/db/client";
import { DataActions } from "@/features/settings/data-actions";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default function Settings() {
  const store = getStore();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DATA, YOUR SPACE</span>
          <h1>数据与设置</h1>
          <p>
            记录留在本机，也能完整带走。AI 录入仅在你发起整理时发送对应内容。
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card">
          <div className="section-title">
            <HardDrive size={19} />
            <h2>本地数据</h2>
          </div>
          <dl className="settings-list">
            <div>
              <dt>存储位置</dt>
              <dd className="path-text">{store.file}</dd>
            </div>
            <div>
              <dt>显示时区</dt>
              <dd>{process.env.APP_TIMEZONE || "Asia/Shanghai"}</dd>
            </div>
            <div>
              <dt>数据库版本</dt>
              <dd>Schema {migrationFiles().length} · SQLite</dd>
            </div>
            <div>
              <dt>云端同步</dt>
              <dd>未启用，数据保存在这台电脑</dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <div className="section-title">
            <Database size={19} />
            <h2>备份与导出</h2>
          </div>
          <p className="muted">
            数据库备份可完整恢复学习记录。JSON
            保留结构和关联，适合阅读、迁移或交给其他工具分析。
          </p>
          <DataActions />
          <div className="info-note">
            <ShieldCheck size={18} />
            <span>
              备份包含归档内容和修改历史。建议定期保存一份到其他位置。
            </span>
          </div>
        </section>
      </div>
      <section className="card restore-guide">
        <div className="section-title">
          <ShieldCheck size={18} />
          <h2>ChatGPT 账户与 AI 录入</h2>
        </div>
        <p className="muted">
          通过本机 Codex 的 ChatGPT 登录整理学习进度，无需 API Key。登录由 Codex
          管理，知序不保存凭据。整理时发送本次原文 /
          图片和所选科目的目录，使用账户的 Codex 额度。
        </p>
        <Link href="/imports" className="button button-outline">
          打开 AI 录入与账户状态
        </Link>
      </section>
      <section className="card restore-guide">
        <div className="section-title">
          <Clock3 size={18} />
          <h2>需要恢复备份时</h2>
        </div>
        <ol>
          <li>先关闭正在运行的本地应用服务。</li>
          <li>
            在项目目录运行 <code>pnpm db:restore "备份文件的完整路径"</code>。
          </li>
          <li>
            工具会校验版本和完整性，并在替换前保留当前数据库的备份。完成后重新启动应用。
          </li>
        </ol>
        <p className="muted">
          恢复会替换当前学习数据；归档内容仍保留在所选备份中。仅支持此应用同版本的
          SQLite 备份。
        </p>
      </section>
    </>
  );
}
