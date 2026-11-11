"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { levels, type Catalog, type Point } from "@/lib/models";
import {
  results,
  taskTypes,
  errorTypes,
  causeStatuses,
  type AssessmentRow,
  type ErrorRow,
  type SessionRow,
} from "@/lib/learning-models";
import { localInput } from "@/lib/dates";
import type { TaskRow } from "@/lib/review-models";
export type LearningTarget = {
  action: "session" | "assessment" | "state" | "error-correction" | "void";
  point?: Point;
  error?: ErrorRow;
  session?: SessionRow;
  assessment?: AssessmentRow;
  task?: TaskRow;
};
const names = {
  session: "记录学习",
  assessment: "记录复测",
  state: "调整等级",
  "error-correction": "订正错误",
  void: "作废记录",
};
function Choice({ name, label }: { name: string; label: string }) {
  return (
    <label>
      {label}
      <select name={name} defaultValue="unknown">
        <option value="unknown">未记录 / 不确定</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </label>
  );
}
export function LearningDialog({
  target,
  catalog,
  sessions,
  assessments,
  errors,
  timeZone,
  onClose,
  onSuccess,
}: {
  target: LearningTarget;
  catalog: Catalog;
  sessions: SessionRow[];
  assessments: AssessmentRow[];
  errors: ErrorRow[];
  timeZone: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [stateMode, setStateMode] = useState("SELF_REPORTED");
  const [commandId] = useState(() => crypto.randomUUID());
  const [id] = useState(() => crypto.randomUUID());
  const [nextId] = useState(() => crypto.randomUUID());
  const [nextMode, setNextMode] = useState("");
  const activeSubjects = catalog.subjects.filter((x) => !x.archivedAt);
  const activePoints = catalog.points.filter(
    (p) =>
      !p.archivedAt &&
      catalog.chapters.some(
        (c) =>
          c.id === p.chapterId &&
          !c.archivedAt &&
          activeSubjects.some((s) => s.id === c.subjectId),
      ),
  );
  const subjectFor = (pid?: string) =>
    catalog.chapters.find(
      (c) => c.id === catalog.points.find((p) => p.id === pid)?.chapterId,
    )?.subjectId;
  const [subjectId, setSubjectId] = useState(
    subjectFor(target.point?.id) || activeSubjects[0]?.id || "",
  );
  const [pointId, setPointId] = useState(
    target.point?.id || activePoints[0]?.id || "",
  );
  const point = catalog.points.find((p) => p.id === pointId);
  const [stateLevel, setStateLevel] = useState(
    point?.masteryBasis === "UNASSESSED"
      ? "UNASSESSED"
      : point?.masteryLevel || "A",
  );
  const [newError, setNewError] = useState(false);
  const [retestId, setRetestId] = useState(target.error?.id || "");
  const availableTests = assessments.filter(
    (a) => a.knowledge_point_id === pointId && !a.voided_at,
  );
  const availableErrors = errors.filter(
    (e) =>
      e.knowledge_point_id === pointId &&
      !e.voided_at &&
      e.resolution_status !== "RESOLVED",
  );
  const now = localInput(new Date(), timeZone),
    start = localInput(new Date(Date.now() - 30 * 60000), timeZone);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const bool = (value: FormDataEntryValue | null) =>
    value === "yes" ? true : value === "no" ? false : null;
  const errorFields = (e?: ErrorRow) => (
    <>
      <div className="form-grid">
        <label>
          错误类型
          <select name="errorType" defaultValue={e?.error_type || "UNKNOWN"}>
            {Object.entries(errorTypes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          错因依据
          <select
            name="causeStatus"
            defaultValue={e?.cause_status || "PENDING_EVIDENCE"}
          >
            {Object.entries(causeStatuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        错因与依据
        <textarea
          name="cause"
          rows={2}
          maxLength={4000}
          defaultValue={e?.cause || ""}
          placeholder="没有足够证据时可以留空"
        />
      </label>
      <label>
        订正与下一次要检查的地方
        <textarea
          name="correction"
          rows={2}
          maxLength={4000}
          defaultValue={e?.correction || ""}
        />
      </label>
      <label>
        同类错误标识 <span className="optional">选填</span>
        <input
          name="patternKey"
          maxLength={100}
          defaultValue={e?.pattern_key || ""}
          placeholder="例如：洛必达-遗漏未定式判断"
        />
        <span className="field-help">
          同知识点使用相同标识，才会合并计算重复出现次数。
        </span>
      </label>
    </>
  );
  const evidenceField = (
    <label>
      关联已有复测证据 <span className="optional">可多选</span>
      {availableTests.length ? (
        <select
          name="evidenceIds"
          multiple
          size={Math.min(Math.max(availableTests.length, 2), 5)}
        >
          {availableTests.map((a) => (
            <option key={a.id} value={a.id}>
              {localInput(new Date(a.occurred_at), timeZone).replace("T", " ")}{" "}
              · {results[a.result]} · {a.question_description.slice(0, 35)}
            </option>
          ))}
        </select>
      ) : (
        <span className="info-note">
          {target.action === "assessment"
            ? "暂无更早的复测记录，本次复测将自动作为证据。"
            : "暂无可关联的复测记录。请先记录复测，再返回确认等级。"}
        </span>
      )}
      <span className="field-help">
        {target.action === "assessment"
          ? "新复测自动作为本次证据。"
          : "请选择支持目标等级的复测记录。"}
        E 级需要两次合格复测，最新一次距此前学习或测试至少 7 个完整日。
      </span>
    </label>
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    const f = new FormData(event.currentTarget);
    const get = (key: string) => String(f.get(key) || "");
    const errorData = {
      type: get("errorType"),
      causeStatus: get("causeStatus"),
      cause: get("cause"),
      correction: get("correction"),
      patternKey: get("patternKey"),
    };
    let payload: Record<string, unknown> = { commandId, action: target.action };
    if (target.action === "session")
      payload = {
        ...payload,
        id,
        subjectId,
        startedLocal: get("startedLocal"),
        endedLocal: get("endedLocal"),
        durationMinutes: Number(get("durationMinutes")),
        content: get("content"),
        rawNote: get("rawNote"),
        points: f.getAll("points").map((pid) => ({
          id: String(pid),
          expectedVersion: catalog.points.find((p) => p.id === pid)!.version,
          activity: get("activity"),
        })),
      };
    if (target.action === "assessment" && point) {
      payload = {
        ...payload,
        id,
        pointId: point.id,
        expectedVersion: point.version,
        sessionId: get("sessionId") || null,
        occurredLocal: get("occurredLocal"),
        question: get("question"),
        questionRef: get("questionRef"),
        response: get("response"),
        result: get("result"),
        independent: bool(f.get("independent")),
        hintCount: get("hintCount") === "" ? null : Number(get("hintCount")),
        answerViewed: bool(f.get("answerViewed")),
        taskType: get("taskType"),
        difficulty: get("difficulty"),
        isNew: bool(f.get("isNew")),
        canExplain: bool(f.get("canExplain")),
        note: get("note"),
        retests: retestId
          ? [
              {
                errorId: retestId,
                expectedVersion: availableErrors.find((e) => e.id === retestId)!
                  .version,
                outcome: get("retestOutcome"),
                resolve: f.has("resolve"),
              },
            ]
          : [],
      };
      if (newError) payload.error = errorData;
      if (get("targetLevel"))
        payload.state = {
          targetLevel: get("targetLevel"),
          reason: get("reason"),
          evidenceIds: f.getAll("evidenceIds"),
        };
      if (get("forgetting")) payload.forgetting = get("forgetting") === "yes";
    }
    if (target.action === "state" && point)
      payload = {
        ...payload,
        pointId: point.id,
        expectedVersion: point.version,
        targetLevel: get("targetLevel"),
        mode: stateMode,
        reason: get("reason"),
        evidenceIds: stateMode === "EVIDENCE" ? f.getAll("evidenceIds") : [],
      };
    if (target.action === "error-correction")
      payload = {
        ...payload,
        id: target.error!.id,
        expectedVersion: target.error!.version,
        ...errorData,
      };
    if (target.action === "void")
      payload = {
        ...payload,
        entity: target.session
          ? "session"
          : target.assessment
            ? "assessment"
            : "error",
        id: target.session?.id || target.assessment?.id || target.error?.id,
        reason: get("reason"),
      };
    if (target.task && ["session", "assessment"].includes(target.action)) {
      payload.task = {
        id: target.task.id,
        expectedVersion: target.task.version,
        ...(nextMode
          ? {
              next: {
                id: nextId,
                mode: nextMode,
                ...(nextMode === "MANUAL"
                  ? { dueOn: get("nextDate"), reason: get("nextReason") }
                  : {}),
              },
            }
          : {}),
      };
    }
    try {
      const r = await fetch("/api/learning", {
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
      ref={dialog}
      className="modal learning-modal"
      aria-label={names[target.action]}
      onCancel={(e) => (busy ? e.preventDefault() : onClose())}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">记录事实，保留依据</span>
          <h2>{names[target.action]}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭对话框"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="field-help">
            时间按 {timeZone} 记录，未知证据不按“通过”处理。
          </p>
          {target.task && (
            <div className="info-note">
              正在完成：{target.task.point_name} · 原定 {target.task.due_on}
              。保存实际活动后才完成任务，失败结果也会保留。
            </div>
          )}
          {target.action === "session" && (
            <>
              <label>
                学习科目
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
                >
                  {activeSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="point-checks">
                <legend>涉及知识点（至少一个）</legend>
                {activePoints
                  .filter((p) => subjectFor(p.id) === subjectId)
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        name="points"
                        value={p.id}
                        defaultChecked={p.id === target.point?.id}
                      />
                      {p.name}
                    </label>
                  ))}
              </fieldset>
              <div className="form-grid">
                <label>
                  开始时间
                  <input
                    type="datetime-local"
                    name="startedLocal"
                    required
                    defaultValue={start}
                  />
                </label>
                <label>
                  结束时间
                  <input
                    type="datetime-local"
                    name="endedLocal"
                    required
                    defaultValue={now}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  实际学习分钟
                  <input
                    name="durationMinutes"
                    type="number"
                    min="1"
                    max="1440"
                    required
                    defaultValue="30"
                  />
                </label>
                <label>
                  活动类型
                  <select name="activity" defaultValue="LEARN">
                    <option value="LEARN">学习新内容</option>
                    <option value="REVIEW">复习已有内容</option>
                    <option value="TEST">测试活动（结果另记）</option>
                  </select>
                </label>
              </div>
              <label>
                本次学习内容
                <textarea name="content" rows={2} maxLength={4000} />
              </label>
              <label>
                原始记录与想法
                <textarea name="rawNote" rows={3} maxLength={4000} />
              </label>
              <p className="field-help">
                用时属于整次学习，不因关联多个知识点重复累计。单条日志不跨午夜。
              </p>
            </>
          )}
          {(target.action === "assessment" || target.action === "state") && (
            <label>
              知识点
              <select
                value={pointId}
                onChange={(e) => {
                  setPointId(e.target.value);
                  setRetestId("");
                }}
                disabled={!!target.point}
                required
              >
                {activePoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ·{" "}
                    {p.masteryBasis === "UNASSESSED"
                      ? "暂未评估"
                      : p.masteryLevel}
                  </option>
                ))}
              </select>
            </label>
          )}
          {target.action === "assessment" && (
            <>
              <div className="form-grid">
                <label>
                  测试发生时间
                  <input
                    type="datetime-local"
                    name="occurredLocal"
                    required
                    defaultValue={now}
                  />
                </label>
                <label>
                  关联学习日志
                  <select name="sessionId" defaultValue="">
                    <option value="">独立记录，不关联</option>
                    {sessions
                      .filter(
                        (s) =>
                          !s.voided_at &&
                          s.points.some((p) => p.id === pointId),
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {localInput(new Date(s.started_at), timeZone).replace(
                            "T",
                            " ",
                          )}{" "}
                          · {s.duration_minutes} 分钟
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label>
                题目 / 测试内容
                <textarea
                  name="question"
                  required
                  rows={3}
                  maxLength={4000}
                  placeholder="记录足以再次定位或复测的题目"
                />
              </label>
              <label>
                题目来源 <span className="optional">选填</span>
                <input
                  name="questionRef"
                  maxLength={4000}
                  placeholder="教材页码、题号或链接"
                />
              </label>
              <label>
                我的作答与思路
                <textarea
                  name="response"
                  rows={3}
                  maxLength={4000}
                  placeholder="保留实际过程，便于判断错因；暂时没有可以留空"
                />
              </label>
              <div className="form-grid">
                <label>
                  测试结果
                  <select name="result" defaultValue="UNASSESSED">
                    {Object.entries(results).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  任务类型
                  <select name="taskType" defaultValue="UNKNOWN">
                    {Object.entries(taskTypes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <Choice name="independent" label="是否独立完成" />
                <label>
                  提示次数
                  <input
                    name="hintCount"
                    type="number"
                    min="0"
                    max="1000"
                    placeholder="留空表示未知；0 表示无提示"
                  />
                </label>
                <Choice name="answerViewed" label="是否看过答案" />
                <Choice name="isNew" label="是否为新题" />
                <Choice name="canExplain" label="能否解释思路" />
                <label>
                  题目难度
                  <select name="difficulty" defaultValue="UNKNOWN">
                    <option value="UNKNOWN">未记录</option>
                    <option value="EASY">简单</option>
                    <option value="STANDARD">标准</option>
                    <option value="HARD">较难</option>
                  </select>
                </label>
              </div>
              <label>
                补充说明
                <textarea name="note" rows={2} maxLength={4000} />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={newError}
                  onChange={(e) => setNewError(e.target.checked)}
                />
                记录本次出现的错误
              </label>
              {newError && <div className="nested-fields">{errorFields()}</div>}
              <label>
                这次复测针对哪条已有错误
                <select
                  value={retestId}
                  onChange={(e) => setRetestId(e.target.value)}
                >
                  <option value="">不关联已有错误</option>
                  {availableErrors.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.question_description.slice(0, 45)} ·{" "}
                      {errorTypes[e.error_type]}
                    </option>
                  ))}
                </select>
              </label>
              {retestId && (
                <div className="nested-fields">
                  <label>
                    本条错误的复测结果
                    <select name="retestOutcome" defaultValue="UNASSESSED">
                      {Object.entries(results).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="resolve" />
                    确认本条错误已独立复测通过，标记解决
                  </label>
                </div>
              )}
              <details className="optional-section">
                <summary>可选：复测确认等级或遗忘标记</summary>
                <div className="nested-fields">
                  <label>
                    等级调整
                    <select name="targetLevel" defaultValue="">
                      <option value="">不调整当前等级</option>
                      {Object.entries(levels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k} · {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    调整原因
                    <textarea name="reason" rows={2} maxLength={1000} />
                  </label>
                  {evidenceField}
                  <label>
                    疑似遗忘
                    <select name="forgetting" defaultValue="">
                      <option value="">保持当前标记</option>
                      <option value="yes">标记疑似遗忘</option>
                      <option value="no">清除疑似遗忘标记</option>
                    </select>
                  </label>
                </div>
              </details>
            </>
          )}
          {target.action === "state" && (
            <>
              <label>
                调整方式
                <select
                  name="stateMode"
                  value={stateMode}
                  onChange={(e) => {
                    setStateMode(e.target.value);
                    if (
                      e.target.value === "EVIDENCE" &&
                      stateLevel === "UNASSESSED"
                    )
                      setStateLevel(point?.masteryLevel || "A");
                    setFailure("");
                  }}
                >
                  <option value="SELF_REPORTED">手动自评</option>
                  <option value="EVIDENCE">复测确认</option>
                </select>
              </label>
              <p className="field-help">
                {stateMode === "SELF_REPORTED"
                  ? "仅提到、尚未介绍或无法判断掌握情况时，选择暂未评估；也可自评 A–E，支持跨级升降。自评等级会单独标记。"
                  : "根据实际复测记录确认等级，保存后标记为复测证据。"}
              </p>
              <label>
                {stateMode === "SELF_REPORTED"
                  ? "自评掌握等级"
                  : "确认掌握等级"}
                <select
                  name="targetLevel"
                  value={stateLevel}
                  onChange={(e) => setStateLevel(e.target.value)}
                >
                  {stateMode === "SELF_REPORTED" && (
                    <option value="UNASSESSED">暂未评估</option>
                  )}
                  {Object.entries(levels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {k} · {v}
                    </option>
                  ))}
                </select>
              </label>
              {stateMode === "EVIDENCE" && evidenceField}
              <label>
                调整原因
                <textarea name="reason" rows={3} required maxLength={1000} />
              </label>
              {stateMode === "EVIDENCE" && (
                <p className="field-help">
                  可跨级调整。C 需要典型题独立通过；D
                  需要新变式或迁移题独立通过且能解释；E 需先达到 D
                  级并完成延迟复测。降低等级也需关联测试证据。
                </p>
              )}
            </>
          )}
          {target.action === "error-correction" && (
            <>
              <div className="info-note">
                {target.error?.question_description}
              </div>
              {errorFields(target.error)}
              <p className="field-help">
                订正只能进入等待复测，不能直接把错误标为解决。
              </p>
            </>
          )}
          {target.action === "void" && (
            <>
              <div className="archive-note">
                <p>
                  原记录和作废原因会保留，用时与有效测试统计将排除此记录。若有后续状态依赖，会提示先处理依赖。
                </p>
              </div>
              <label>
                作废原因
                <textarea name="reason" required rows={3} maxLength={1000} />
              </label>
            </>
          )}
          {target.task && (
            <div className="nested-fields">
              <label>
                下一次安排
                <select
                  value={nextMode}
                  onChange={(e) => setNextMode(e.target.value)}
                >
                  <option value="">本次不安排下一任务</option>
                  <option value="RULE">确认按本次记录和等级规则安排</option>
                  <option value="MANUAL">手动选日期与原因</option>
                </select>
              </label>
              {nextMode === "RULE" && (
                <p className="field-help">
                  依据本次记录保存后的状态：B/C/D/E 为活动后 2/5/14/30
                  天，失败或依赖提示为次日；疑似遗忘为今天。证据未知或 A
                  级请手动安排。保存时与复测、完成任务一起生效。
                </p>
              )}
              {nextMode === "MANUAL" && (
                <>
                  <label>
                    下次日期
                    <input
                      type="date"
                      name="nextDate"
                      defaultValue={now.slice(0, 10)}
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
            </div>
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
            onClick={onClose}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            disabled={busy}
            variant={target.action === "void" ? "destructive" : "default"}
          >
            {busy && <LoaderCircle size={15} className="spin" />}
            {busy
              ? "正在保存…"
              : target.action === "void"
                ? "确认作废"
                : "保存记录"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
