"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, FlaskConical, NotebookPen, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Catalog, type Point } from "@/lib/models";
import {
  results,
  taskTypes,
  errorTypes,
  causeStatuses,
  resolutions,
  type SessionRow,
  type AssessmentRow,
  type ErrorRow,
} from "@/lib/learning-models";
import { localInput, localDay } from "@/lib/dates";
import { LearningDialog, type LearningTarget } from "./learning-dialog";
export function LearningWorkspace({
  mode,
  catalog,
  sessions,
  assessments,
  errors,
  timeZone,
  point,
  initialOpen = false,
  sessionId,
}: {
  mode: "sessions" | "errors" | "point";
  catalog: Catalog;
  sessions: SessionRow[];
  assessments: AssessmentRow[];
  errors: ErrorRow[];
  timeZone: string;
  point?: Point;
  initialOpen?: boolean;
  sessionId?: string;
}) {
  const [target, setTarget] = useState<LearningTarget | null>(
    initialOpen ? { action: "session", point } : null,
  );
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [resultFilter, setResultFilter] = useState("");
  const activePoints = catalog.points.filter((p) => !p.archivedAt);
  const fmt = (value: string) =>
    localInput(new Date(value), timeZone).replace("T", " ");
  const nowDay = localDay(new Date().toISOString(), timeZone);
  const todayMinutes = sessions
    .filter((s) => !s.voided_at && localDay(s.started_at, timeZone) === nowDay)
    .reduce((n, s) => n + s.duration_minutes, 0);
  const shownSessions = sessions.filter(
    (s) =>
      (!sessionId || s.id === sessionId) &&
      (includeClosed || !s.voided_at) &&
      (!point || s.points.some((p) => p.id === point.id)) &&
      `${s.subject_name} ${s.content || ""} ${s.points.map((p) => p.name).join(" ")}`.includes(
        search,
      ),
  );
  const shownErrors = errors.filter(
    (e) =>
      (!point || e.knowledge_point_id === point.id) &&
      (includeClosed ||
        (!e.voided_at &&
          e.resolution_status !== "RESOLVED" &&
          !e.archived_at)) &&
      `${e.point_name} ${e.question_description} ${e.cause || ""}`.includes(
        search,
      ),
  );
  const shownTests = assessments.filter(
    (a) =>
      (!point || a.knowledge_point_id === point.id) &&
      (includeClosed || !a.voided_at) &&
      (!resultFilter || a.result === resultFilter),
  );
  const errorCards = (
    <div className="record-list">
      {shownErrors.map((e) => (
        <article
          className={`card record-card ${e.voided_at ? "void-record" : ""}`}
          key={e.id}
        >
          <div className="record-top">
            <Link
              href={`/knowledge/${e.knowledge_point_id}`}
              className="point-link"
            >
              {e.point_name}
              <ArrowUpRight size={13} />
            </Link>
            <span
              className={`record-badge ${e.resolution_status === "RESOLVED" ? "passed" : ""}`}
            >
              {e.voided_at ? "已作废" : resolutions[e.resolution_status]}
            </span>
          </div>
          <h3>{e.question_description}</h3>
          <p className="record-meta">
            {fmt(e.occurred_at)} · {errorTypes[e.error_type]} ·{" "}
            {causeStatuses[e.cause_status]}
          </p>
          {e.cause && (
            <p>
              <b>错因：</b>
              {e.cause}
            </p>
          )}
          {e.correction && (
            <p>
              <b>订正：</b>
              {e.correction}
            </p>
          )}
          <p className="field-help">
            {e.pattern_key
              ? `同类错误「${e.pattern_key}」共出现 ${e.repeated_count} 次`
              : "尚未归入同类错误"}
            {e.last_retested_at ? ` · 最近复测 ${fmt(e.last_retested_at)}` : ""}
          </p>
          {e.voided_at ? (
            <p className="field-help">作废原因：{e.void_reason}</p>
          ) : (
            !e.archived_at &&
            e.resolution_status !== "RESOLVED" && (
              <div className="record-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTarget({ action: "error-correction", error: e })
                  }
                >
                  补充订正
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setTarget({
                      action: "assessment",
                      point: catalog.points.find(
                        (p) => p.id === e.knowledge_point_id,
                      ),
                      error: e,
                    })
                  }
                >
                  针对此错误复测
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTarget({ action: "void", error: e })}
                >
                  作废
                </Button>
              </div>
            )
          )}
        </article>
      ))}
      {!shownErrors.length && (
        <div className="empty-state">
          <h3>暂无符合条件的错误</h3>
          <p>复测中记录的错误会出现在这里；证据不足时可以暂不归因。</p>
        </div>
      )}
    </div>
  );
  return (
    <section className={mode === "point" ? "point-evidence" : ""}>
      {mode !== "point" && (
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {mode === "sessions" ? "LEARNING JOURNAL" : "ERROR & RETEST"}
            </span>
            <h1>{mode === "sessions" ? "学习日志" : "错误记录"}</h1>
            <p>
              {mode === "sessions"
                ? "记录活动与用时，能力变化由复测来证明。"
                : "保留实际过程，通过下一次独立复测确认修复。"}
            </p>
          </div>
          <Button
            disabled={!activePoints.length}
            onClick={() =>
              setTarget({
                action: mode === "sessions" ? "session" : "assessment",
              })
            }
          >
            <Plus size={16} />
            {mode === "sessions" ? "记录学习" : "记录复测"}
          </Button>
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {mode === "point" && (
        <div className="section-title between">
          <h2>学习与复测证据</h2>
          {!point?.archivedAt && (
            <div className="actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTarget({ action: "session", point })}
              >
                <NotebookPen size={14} />
                记录学习
              </Button>
              <Button
                size="sm"
                onClick={() => setTarget({ action: "assessment", point })}
              >
                <FlaskConical size={14} />
                记录复测
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTarget({ action: "state", point })}
              >
                调整等级
              </Button>
            </div>
          )}
        </div>
      )}
      {mode === "sessions" && (
        <div className="learning-stats">
          <span>
            今日有效学习时间 <strong>{todayMinutes}</strong> 分钟
          </span>
          <span>
            当前有效日志{" "}
            <strong>{sessions.filter((s) => !s.voided_at).length}</strong> 条
          </span>
        </div>
      )}
      <div className="filters evidence-filters">
        {mode !== "point" ? (
          <input
            className="plain-search"
            placeholder={
              mode === "sessions"
                ? "搜索科目、知识点或内容"
                : "搜索知识点、题目或错因"
            }
            aria-label="搜索学习记录"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        ) : (
          <select
            aria-label="筛选测试结果"
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
          >
            <option value="">全部测试结果</option>
            {Object.entries(results).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
        <label className="archive-toggle">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          {mode === "errors" ? "包括已解决、归档和作废" : "包括已作废"}
        </label>
      </div>
      {mode === "sessions" && (
        <div className="record-list">
          {shownSessions.map((s) => (
            <article
              className={`card record-card ${s.voided_at ? "void-record" : ""}`}
              key={s.id}
            >
              <div className="record-top">
                <Link href={`/sessions/${s.id}`} className="point-link">
                  {s.subject_name} · {fmt(s.started_at)}
                </Link>
                <span className="record-badge">
                  {s.voided_at ? "已作废" : `${s.duration_minutes} 分钟`}
                </span>
              </div>
              <p>{s.content || "未填写学习内容"}</p>
              <div className="point-chips">
                {s.points.map((p) => (
                  <Link key={p.id} href={`/knowledge/${p.id}`}>
                    {p.name} ·{" "}
                    {p.activity_type === "LEARN"
                      ? "学习"
                      : p.activity_type === "REVIEW"
                        ? "复习"
                        : "测试活动"}
                  </Link>
                ))}
              </div>
              {s.raw_note && (
                <details>
                  <summary>原始记录</summary>
                  <p>{s.raw_note}</p>
                </details>
              )}
              <p className="field-help">
                结束时间 {fmt(s.ended_at)} · 用时只计算一次
                {s.voided_at ? ` · 作废原因：${s.void_reason}` : ""}
              </p>
              {!s.voided_at && (
                <div className="record-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTarget({ action: "void", session: s })}
                  >
                    作废记录
                  </Button>
                </div>
              )}
            </article>
          ))}
          {!shownSessions.length && (
            <div className="card empty-state">
              <h3>暂无学习日志</h3>
              <p>
                {activePoints.length
                  ? "记录刚刚完成的一段学习，把知识点和原始想法关联起来。"
                  : "先在知识树里添加一个知识点，再记录学习。"}
              </p>
              <Link href="/knowledge" className="button button-outline">
                打开知识树
              </Link>
            </div>
          )}
        </div>
      )}
      {mode === "errors" && errorCards}
      {mode === "point" && (
        <>
          <div className="record-list">
            {shownTests.map((a) => (
              <article
                className={`card record-card ${a.voided_at ? "void-record" : ""}`}
                key={a.id}
              >
                <div className="record-top">
                  <h3>{a.question_description}</h3>
                  <span
                    className={`record-badge ${a.result === "PASS" ? "passed" : a.result === "FAIL" ? "failed" : ""}`}
                  >
                    {a.voided_at ? "已作废" : results[a.result]}
                  </span>
                </div>
                <p className="record-meta">
                  {fmt(a.occurred_at)} · {taskTypes[a.task_type]} ·{" "}
                  {a.difficulty === "UNKNOWN"
                    ? "难度未记录"
                    : a.difficulty === "EASY"
                      ? "简单"
                      : a.difficulty === "STANDARD"
                        ? "标准"
                        : "较难"}
                </p>
                <div className="evidence-tags">
                  <span>
                    独立完成：
                    {a.independent === null
                      ? "未知"
                      : a.independent
                        ? "是"
                        : "否"}
                  </span>
                  <span>
                    提示：
                    {a.hint_count === null ? "未知" : `${a.hint_count} 次`}
                  </span>
                  <span>
                    看答案：
                    {a.answer_viewed === null
                      ? "未知"
                      : a.answer_viewed
                        ? "是"
                        : "否"}
                  </span>
                  <span>
                    新题：
                    {a.is_new_question === null
                      ? "未知"
                      : a.is_new_question
                        ? "是"
                        : "否"}
                  </span>
                  <span>
                    能解释：
                    {a.can_explain === null
                      ? "未知"
                      : a.can_explain
                        ? "是"
                        : "否"}
                  </span>
                </div>
                {a.response_excerpt && (
                  <details>
                    <summary>我的作答与思路</summary>
                    <p>{a.response_excerpt}</p>
                  </details>
                )}
                {a.question_ref && (
                  <p className="field-help">来源：{a.question_ref}</p>
                )}
                {a.note && <p>{a.note}</p>}
                {a.voided_at ? (
                  <p className="field-help">作废原因：{a.void_reason}</p>
                ) : (
                  !point?.archivedAt && (
                    <div className="record-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setTarget({ action: "void", assessment: a })
                        }
                      >
                        作废测试
                      </Button>
                    </div>
                  )
                )}
              </article>
            ))}
            {!shownTests.length && (
              <div className="card empty-state">
                <h3>还没有有效复测记录</h3>
                <p>“看懂了”和“独立完成”分别记录，不用急着给出更高等级。</p>
              </div>
            )}
          </div>
          <div className="section-title errors-subtitle">
            <h2>此知识点的错误</h2>
          </div>
          {errorCards}
        </>
      )}
      {target && (
        <LearningDialog
          target={target}
          catalog={catalog}
          sessions={sessions}
          assessments={assessments}
          errors={errors}
          timeZone={timeZone}
          onClose={() => setTarget(null)}
          onSuccess={setMessage}
        />
      )}
    </section>
  );
}
