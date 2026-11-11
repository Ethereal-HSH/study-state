"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  Plus,
  X,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/level-badge";
import {
  taskKinds,
  taskStatuses,
  type TaskRow,
  type ReviewSuggestion,
} from "@/lib/review-models";
import type { Catalog } from "@/lib/models";
import type {
  AssessmentRow,
  ErrorRow,
  SessionRow,
} from "@/lib/learning-models";
import { results } from "@/lib/learning-models";
import { daysBetween } from "@/lib/review-policy";
import { localInput } from "@/lib/dates";
import {
  LearningDialog,
  type LearningTarget,
} from "@/features/learning/learning-dialog";
type TaskTarget = {
  action:
    "create" | "confirm" | "reschedule" | "cancel" | "complete" | "reopen";
  task?: TaskRow;
  suggestion?: ReviewSuggestion;
};
type Props = {
  catalog: Catalog;
  tasks: TaskRow[];
  suggestions: ReviewSuggestion[];
  sessions: SessionRow[];
  assessments: AssessmentRow[];
  errors: ErrorRow[];
  timeZone: string;
  today: string;
  mode?: "today" | "all" | "point";
  pointId?: string;
};
export function ReviewWorkspace(props: Props) {
  const {
    catalog,
    tasks,
    suggestions,
    sessions,
    assessments,
    errors,
    timeZone,
    today,
    mode = "all",
    pointId,
  } = props;
  const [target, setTarget] = useState<TaskTarget | null>(null);
  const [learning, setLearning] = useState<LearningTarget | null>(null);
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState("pending");
  const [subject, setSubject] = useState("");
  const [search, setSearch] = useState("");
  const inScope = (pid: string) => !pointId || pointId === pid;
  const all = tasks.filter(
    (t) =>
      inScope(t.knowledge_point_id) &&
      (!subject || t.subject_id === subject) &&
      `${t.point_name} ${t.reason}`.includes(search),
  );
  const pending = all.filter((t) => t.status === "PENDING" && !t.archived_at);
  const shown =
    mode === "today"
      ? pending.filter((t) => t.due_on <= today).slice(0, 6)
      : all.filter((t) =>
          scope === "history"
            ? t.status !== "PENDING"
            : t.status === "PENDING" &&
              (scope === "pending" ||
                (scope === "due" ? t.due_on <= today : t.due_on > today)),
        );
  const advice = suggestions.filter(
    (s) =>
      inScope(s.pointId) &&
      (!subject || s.subjectId === subject) &&
      s.pointName.includes(search),
  );
  function start(t: TaskRow) {
    const point = catalog.points.find((p) => p.id === t.knowledge_point_id)!;
    const error =
      t.kind === "LEARN"
        ? undefined
        : errors.find(
            (e) =>
              e.knowledge_point_id === point.id &&
              !e.voided_at &&
              e.resolution_status !== "RESOLVED",
          );
    setLearning({
      action: t.kind === "LEARN" ? "session" : "assessment",
      point,
      task: t,
      error,
    });
  }
  return (
    <section
      className={`reviews-workspace ${mode === "today" ? "card dashboard-tasks" : ""}`}
    >
      {mode === "all" ? (
        <div className="page-heading">
          <div>
            <span className="eyebrow">REVIEW & NEXT STEP</span>
            <h1>复习与安排</h1>
            <p>把下一步定下来，到期后留下实际表现。</p>
          </div>
          <Button
            onClick={() => setTarget({ action: "create" })}
            disabled={!catalog.points.some((p) => !p.archivedAt)}
          >
            <Plus size={16} />
            安排任务
          </Button>
        </div>
      ) : (
        <div className="section-title between">
          <h2>{mode === "today" ? "今日待办" : "下一步安排"}</h2>
          <Link href="/reviews">
            {mode === "today" ? "查看全部" : "管理任务"}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      )}
      {message && (
        <div className="success-message" role="status">
          {message}
        </div>
      )}
      {mode === "all" && (
        <>
          <div className="learning-stats">
            <span>
              到期与逾期{" "}
              <strong>{pending.filter((t) => t.due_on <= today).length}</strong>{" "}
              项
            </span>
            <span>
              未来安排{" "}
              <strong>{pending.filter((t) => t.due_on > today).length}</strong>{" "}
              项
            </span>
          </div>
          <div className="learning-filters review-filters">
            <input
              aria-label="搜索任务"
              placeholder="搜索知识点或安排原因"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="按科目筛选任务"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="">全部科目</option>
              {catalog.subjects.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                  {s.archivedAt ? "（归档）" : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="任务范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="pending">全部待处理</option>
              <option value="due">到期与逾期</option>
              <option value="future">未来安排</option>
              <option value="history">完成与取消历史</option>
            </select>
          </div>
        </>
      )}
      <p className="field-help">
        {mode === "today"
          ? "按原定日期、近 14 天错误次数、未解决错误、遗忘标记与重要性排序。"
          : "逾期保留原日期；完成活动不代表通过或升级。"}
      </p>
      <div className="record-list">
        {shown.map((t) => (
          <article
            className={`record-card ${mode !== "today" ? "card" : ""}`}
            key={t.id}
          >
            <div className="record-top">
              <Link
                className="point-link"
                href={`/knowledge/${t.knowledge_point_id}`}
              >
                {t.point_name}
                <ArrowUpRight size={13} />
              </Link>
              <span
                className={`record-badge ${t.status === "COMPLETED" ? "passed" : t.status === "PENDING" && t.due_on < today ? "failed" : ""}`}
              >
                {t.status === "PENDING"
                  ? t.due_on < today
                    ? `逾期 ${daysBetween(t.due_on, today)} 天`
                    : t.due_on === today
                      ? "今天"
                      : "未来"
                  : taskStatuses[t.status]}
              </span>
            </div>
            <p className="record-meta">
              {t.subject_name} · {taskKinds[t.kind]} · {t.due_on}
              {t.archived_at ? " · 已归档" : ""}
            </p>
            <p>{t.reason}</p>
            {t.status === "PENDING" && (
              <p className="field-help">
                近 14 天错误 {t.recent_errors} 次 · 未解决 {t.open_errors} 条 ·
                重要性 {t.importance}/5
                {t.suspected_forgetting ? " · 疑似遗忘" : ""}
              </p>
            )}
            {t.status === "COMPLETED" && (
              <p className="field-help">
                完成于{" "}
                {localInput(new Date(t.completed_at!), timeZone).replace(
                  "T",
                  " ",
                )}{" "}
                · {t.completed_assessment_id ? "关联复测记录" : "关联学习日志"}
                {t.completed_assessment_id
                  ? ` · ${assessments.find((a) => a.id === t.completed_assessment_id)?.result === "PASS" ? "通过" : assessments.find((a) => a.id === t.completed_assessment_id)?.result === "FAIL" ? "未通过" : assessments.find((a) => a.id === t.completed_assessment_id)?.result === "PARTIAL" ? "部分完成" : "尚未判定"}`
                  : ""}
              </p>
            )}
            {t.status === "CANCELLED" && (
              <p className="field-help">取消原因：{t.cancel_reason}</p>
            )}
            <div className="record-actions">
              {t.status === "PENDING" && !t.archived_at && (
                <>
                  <Button size="sm" onClick={() => start(t)}>
                    {t.kind === "LEARN" ? "记录学习并完成" : "记录复测并完成"}
                  </Button>
                  {mode !== "today" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTarget({ action: "complete", task: t })}
                    >
                      关联已有记录
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTarget({ action: "reschedule", task: t })}
                  >
                    改期
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTarget({ action: "cancel", task: t })}
                  >
                    取消任务
                  </Button>
                </>
              )}
              {t.status === "COMPLETED" && !t.archived_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTarget({ action: "reopen", task: t })}
                >
                  撤销完成
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!shown.length && (
        <div className="small-empty">
          <CalendarDays size={27} />
          <h3>
            {mode === "today" ? "今天没有到期任务" : "暂无符合条件的任务"}
          </h3>
          <p>
            {pending.length
              ? `还有 ${pending.length} 项未来或其他范围的安排。`
              : "可以从具体知识点安排下一次学习或复测。"}
          </p>
          {mode === "today" && <Link href="/reviews">查看日期建议与安排</Link>}
        </div>
      )}
      {mode !== "today" && scope !== "history" && (
        <section className="suggestion-section">
          <div className="section-title">
            <h2>待确认的日期建议</h2>
          </div>
          <p className="muted">
            以下仅为建议，确认后才进入待办。每个知识点最多一项待处理任务。
          </p>
          <div className="record-list">
            {advice.map((s) => {
              const p = catalog.points.find((p) => p.id === s.pointId)!;
              return (
                <article className="card record-card" key={s.pointId}>
                  <div className="record-top">
                    <Link
                      className="point-link"
                      href={`/knowledge/${s.pointId}`}
                    >
                      {s.pointName}
                    </Link>
                    <LevelBadge
                      level={p.masteryLevel}
                      unassessed={p.masteryBasis === "UNASSESSED"}
                    />
                  </div>
                  <p>{s.reason}</p>
                  <p className="record-meta">
                    {s.dueOn
                      ? `建议日期 ${s.dueOn} · ${taskKinds[s.kind]}`
                      : "日期待手动选择"}
                  </p>
                  <div className="record-actions">
                    {s.dueOn && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setTarget({ action: "confirm", suggestion: s })
                        }
                      >
                        确认建议
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setTarget({ action: "create", suggestion: s })
                      }
                    >
                      手动安排
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {!advice.length && (
            <p className="field-help">
              当前范围已有安排，或还没有可安排的知识点。
            </p>
          )}
        </section>
      )}
      {target && (
        <TaskDialog
          target={target}
          {...props}
          onClose={() => setTarget(null)}
          onSuccess={setMessage}
        />
      )}
      {learning && (
        <LearningDialog
          target={learning}
          catalog={catalog}
          sessions={sessions}
          assessments={assessments}
          errors={errors}
          timeZone={timeZone}
          onClose={() => setLearning(null)}
          onSuccess={setMessage}
        />
      )}
    </section>
  );
}
function TaskDialog({
  target,
  catalog,
  sessions,
  assessments,
  today,
  timeZone,
  onClose,
  onSuccess,
}: Props & {
  target: TaskTarget;
  onClose: () => void;
  onSuccess: (m: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID()),
    [id] = useState(() => crypto.randomUUID()),
    [nextId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [pointId, setPointId] = useState(
      target.suggestion?.pointId ||
        catalog.points.find((p) => !p.archivedAt)?.id ||
        "",
    ),
    [nextMode, setNextMode] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  const labels = {
    create: "安排任务",
    confirm: "确认日期建议",
    reschedule: "调整任务日期",
    cancel: "取消任务",
    complete: "关联已有记录完成",
    reopen: "撤销任务完成",
  };
  const t = target.task,
    s = target.suggestion;
  const records =
    t?.kind === "LEARN"
      ? sessions
          .filter(
            (x) =>
              !x.voided_at &&
              x.points.some(
                (p) =>
                  p.id === t.knowledge_point_id && p.activity_type === "LEARN",
              ) &&
              x.ended_at >= t.created_at.slice(0, 16) + ":00.000Z",
          )
          .map((x) => ({
            id: x.id,
            text: `${localInput(new Date(x.ended_at), timeZone).replace("T", " ")} · ${x.duration_minutes} 分钟 · ${x.content || "学习"}`,
          }))
      : assessments
          .filter(
            (a) =>
              !a.voided_at &&
              a.knowledge_point_id === t?.knowledge_point_id &&
              a.occurred_at >= t?.created_at.slice(0, 16) + ":00.000Z",
          )
          .map((a) => ({
            id: a.id,
            text: `${localInput(new Date(a.occurred_at), timeZone).replace("T", " ")} · ${a.question_description.slice(0, 40)} · ${results[a.result]}`,
          }));
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFailure("");
    const f = new FormData(e.currentTarget);
    const get = (n: string) => String(f.get(n) || "");
    let payload: Record<string, unknown> = {
      commandId,
      action: target.action,
      id: t?.id || id,
    };
    if (target.action === "create")
      payload = {
        ...payload,
        pointId,
        expectedPointVersion: catalog.points.find((p) => p.id === pointId)!
          .version,
        kind: get("kind"),
        dueOn: get("date"),
        reason: get("reason"),
      };
    if (target.action === "confirm")
      payload = { ...payload, pointId: s!.pointId, token: s!.token };
    if (t) {
      payload.expectedVersion = t.version;
      if (target.action === "reschedule") payload.dueOn = get("date");
      if (target.action !== "complete") payload.reason = get("reason");
      else {
        payload.recordId = get("record");
        if (nextMode)
          payload.next = {
            id: nextId,
            mode: nextMode,
            ...(nextMode === "MANUAL"
              ? { dueOn: get("nextDate"), reason: get("nextReason") }
              : {}),
          };
      }
    }
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      router.refresh();
      onSuccess(data.message);
      onClose();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="modal learning-modal"
      aria-label={labels[target.action]}
      onCancel={(e) => (busy ? e.preventDefault() : onClose())}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">下一步由你确认</span>
          <h2>{labels[target.action]}</h2>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="关闭对话框"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          {s && target.action === "confirm" && (
            <div className="info-note">
              <strong>
                {s.pointName} · {s.dueOn}
              </strong>
              <p>{s.reason}</p>
              <p>规则为可调整的初值，确认会创建一项任务。</p>
            </div>
          )}
          {t && (
            <div className="info-note">
              {t.point_name} · {taskKinds[t.kind]} · 原定 {t.due_on}
            </div>
          )}
          {target.action === "create" && (
            <>
              <label>
                知识点
                <select
                  value={pointId}
                  onChange={(e) => setPointId(e.target.value)}
                  required
                >
                  {catalog.points
                    .filter((p) => !p.archivedAt)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                任务类型
                <select name="kind" defaultValue={s?.kind || "REVIEW"}>
                  {Object.entries(taskKinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {["create", "reschedule"].includes(target.action) && (
            <label>
              计划日期
              <input
                name="date"
                type="date"
                min={today}
                defaultValue={
                  s?.dueOn || (t && t.due_on >= today ? t.due_on : today)
                }
                required
              />
            </label>
          )}
          {["create", "reschedule", "cancel", "reopen"].includes(
            target.action,
          ) && (
            <label>
              {target.action === "reopen" ? "撤销原因" : "安排或变更原因"}
              <textarea
                name="reason"
                rows={3}
                required
                maxLength={1000}
                defaultValue={target.action === "create" ? s?.reason || "" : ""}
              />
            </label>
          )}
          {target.action === "reopen" && (
            <p className="field-help">
              撤销仅恢复待处理任务，原学习/复测与等级仍保留。若已有下一任务，请先取消它；历史会保留之前的完成依据。
            </p>
          )}
          {target.action === "complete" && (
            <>
              <label>
                选择实际记录
                <select name="record" required defaultValue="">
                  <option value="">请选择任务安排后发生的记录</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.text}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-help">
                学习任务需要学习日志；复习与抽查需要实际复测。未通过的测试也可完成本次活动，不能凭空标记通过。
              </p>
              <label>
                下一次安排
                <select
                  value={nextMode}
                  onChange={(e) => setNextMode(e.target.value)}
                >
                  <option value="">本次不安排下一任务</option>
                  <option value="RULE">确认按当前证据与等级规则安排</option>
                  <option value="MANUAL">手动选日期与原因</option>
                </select>
              </label>
              {nextMode === "MANUAL" && (
                <>
                  <label>
                    下次日期
                    <input
                      name="nextDate"
                      type="date"
                      min={today}
                      defaultValue={today}
                      required
                    />
                  </label>
                  <label>
                    下次安排原因
                    <textarea
                      name="nextReason"
                      rows={2}
                      required
                      maxLength={1000}
                    />
                  </label>
                </>
              )}
              {nextMode === "RULE" && (
                <p className="field-help">
                  根据最新有效活动与当前等级，B/C/D/E 为 +2/5/14/30
                  天，失败或提示依赖为 +1 天；证据未知请手动安排。
                </p>
              )}
            </>
          )}
          {failure && (
            <div className="error-message" role="alert">
              {failure}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            返回
          </Button>
          <Button
            disabled={busy}
            variant={target.action === "cancel" ? "destructive" : "default"}
          >
            {busy && <LoaderCircle size={15} className="spin" />}
            {busy ? "正在保存…" : "确认保存"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
