"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  Pencil,
  Clock3,
  FileText,
  Check,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/level-badge";
import { Editor, type EditorTarget } from "./editor";
import { EventChanges } from "./event-changes";
import {
  bases,
  stages,
  type Catalog,
  type Point,
  type Subject,
  type Chapter,
  type Event,
} from "@/lib/models";
const eventNames: Record<string, string> = {
  STATE_CHANGED: "建立 / 调整状态",
  RECORD_CORRECTED: "信息修正",
  SUMMARY_UPDATED: "摘要更新",
  ARCHIVED: "归档",
  TASK_CHANGED: "任务调整",
  LEARN: "学习记录",
  REVIEW: "复习记录",
  TEST: "复测表现",
  ERROR_CHANGED: "错误与复测",
  NOTE: "活动说明",
};
export function PointView({
  point,
  subject,
  chapter,
  events,
  catalog,
  timeZone,
  learningContent,
}: {
  point: Point;
  subject: Subject;
  chapter: Chapter;
  events: Event[];
  catalog: Catalog;
  timeZone: string;
  learningContent?: React.ReactNode;
}) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  const date = (s: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(s));
  async function saveSummary(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId,
          action: "summary",
          entity: "point",
          id: point.id,
          expectedVersion: point.version,
          summary: f.get("summary"),
          source: f.get("source"),
        }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setNotice("摘要已保存，掌握状态未改变");
      setCommandId(crypto.randomUUID());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/knowledge">
        <ArrowLeft size={15} />
        返回知识树
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="breadcrumb">
            {subject.name} / {chapter.name}
          </span>
          <h1>{point.name}</h1>
          <p>{point.description || "还没有添加说明。"}</p>
        </div>
        {!point.archivedAt && (
          <div className="actions">
            <Button
              variant="outline"
              onClick={() =>
                setEditor({ entity: "point", action: "edit", item: point })
              }
            >
              <Pencil size={15} />
              编辑信息
            </Button>
            <Button
              variant="ghost"
              aria-label="归档知识点"
              onClick={() =>
                setEditor({ entity: "point", action: "archive", item: point })
              }
            >
              <Archive size={17} />
            </Button>
          </div>
        )}
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {point.archivedAt && (
        <div className="archive-banner">
          <Archive size={17} />
          此知识点已归档。以下状态和历史仍然保留，暂不接受修改。
        </div>
      )}
      <div className="detail-stats">
        <section className="card">
          <span className="stat-label">当前掌握状态</span>
          <LevelBadge
            level={point.masteryLevel}
            unassessed={point.masteryBasis === "UNASSESSED"}
          />
          <p>
            {bases[point.masteryBasis]}
            {point.masteryBasis === "SELF_REPORTED" ? " · 等级仍基于自评" : ""}
            {point.suspectedForgetting ? " · 疑似遗忘" : ""}
          </p>
        </section>
        <section className="card">
          <span className="stat-label">学习进度</span>
          <h3>{stages[point.learningStage]}</h3>
          <p>与能力等级分别记录</p>
        </section>
        <section className="card">
          <span className="stat-label">重要性</span>
          <h3>
            {point.importance} <small>/ 5</small>
          </h3>
          <p>
            {point.importance >= 4
              ? "当前范围中的重点内容"
              : "按你的备考范围设置"}
          </p>
        </section>
      </div>
      {learningContent}
      <div className="detail-grid">
        <section className="card summary-card">
          <div className="section-title">
            <FileText size={18} />
            <h2>学习摘要</h2>
          </div>
          <p className="muted">
            保存你的整理，或粘贴 AI 生成的总结。摘要用于解释已有状态。
          </p>
          {point.aiSummary && (
            <div
              className={`summary-meta ${point.summaryBasedOnVersion !== point.version ? "stale" : ""}`}
            >
              {point.summaryBasedOnVersion !== point.version
                ? "状态或信息已有变化，摘要可能已过期"
                : "摘要对应当前版本"}{" "}
              ·{" "}
              {point.summarySource === "AI_PASTED"
                ? "AI 文本（本人确认）"
                : "本人整理"}
            </div>
          )}
          <form onSubmit={saveSummary} key={point.version}>
            <label className="sr-only" htmlFor="summary">
              学习摘要
            </label>
            <textarea
              id="summary"
              name="summary"
              rows={8}
              maxLength={10000}
              disabled={!!point.archivedAt}
              defaultValue={point.aiSummary || ""}
              placeholder="例如：能完成典型题，但还需要检查适用条件。目前没有足够的迁移题证据。"
            />
            {!point.archivedAt && (
              <div className="summary-actions">
                <label>
                  来源
                  <select
                    name="source"
                    defaultValue={point.summarySource || "MANUAL"}
                  >
                    <option value="MANUAL">本人整理</option>
                    <option value="AI_PASTED">AI 文本（本人确认）</option>
                  </select>
                </label>
                <Button disabled={busy}>
                  {busy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  保存摘要
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
          </form>
          {point.summaryUpdatedAt && (
            <p className="field-help">
              最近保存于 {date(point.summaryUpdatedAt)}
            </p>
          )}
        </section>
        <section className="card timeline-card">
          <div className="section-title">
            <Clock3 size={18} />
            <h2>学习状态时间线</h2>
          </div>
          <p className="muted">每一次修改都保留原因和前后记录。</p>
          <ol className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className="timeline-dot" />
                <div className="event-header">
                  <strong>
                    {eventNames[event.eventType] || event.eventType}
                  </strong>
                  <time>{date(event.recordedAt)}</time>
                </div>
                <p>{event.reason}</p>
                <details>
                  <summary>查看记录详情</summary>
                  <EventChanges
                    beforeJson={event.beforeJson}
                    afterJson={event.afterJson}
                  />
                </details>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {editor && (
        <Editor
          target={editor}
          catalog={catalog}
          onClose={() => setEditor(null)}
          onSuccess={setNotice}
        />
      )}
    </>
  );
}
