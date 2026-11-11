"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, LoaderCircle, Download, Plus } from "lucide-react";
import type { Catalog } from "@/lib/models";
import {
  roundPerformances,
  studyRoundMarkdown,
  verifiedRoundItemIds,
  type StudyRound,
  type RoundReview,
  type RoundDraft,
  type RoundItem,
  type RoundBaselinePoint,
} from "@/lib/round-models";
import { sourceDateCandidates } from "@/lib/import-dates";
import { localDay } from "@/lib/dates";
import { resolveSourceQuote } from "@/lib/source-quotes";
import { RoundReviewCard } from "./review-card";

type History = {
  id: string;
  round_id: string;
  status: RoundDraft["status"];
  created_at: string;
  file_name: string | null;
  overview: string | null;
}[];
function PointPicker({
  points,
  value,
  onChange,
  disabled,
  index,
}: {
  points: RoundBaselinePoint[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  index: number;
}) {
  const [query, setQuery] = useState("");
  const matches = points
    .filter((p) =>
      `${p.chapterName} ${p.name}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 40);
  return (
    <details className="round-picker">
      <summary>关联多个章节的知识点（已选{value.length}）</summary>
      <div className="round-links">
        {value.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(value.filter((x) => x !== id))}
          >
            {points.find((p) => p.id === id)?.name || id} ×
          </Button>
        ))}
      </div>
      <label>
        搜索知识点
        <input
          aria-label={`搜索关联知识点 ${index}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder="名称或章节，如 占空比、第三章"
        />
      </label>
      <div className="round-point-options">
        {matches.map((p) => (
          <label className="check-label" key={p.id}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.includes(p.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, p.id]
                    : value.filter((id) => id !== p.id),
                )
              }
            />
            {p.chapterName} / {p.name}
          </label>
        ))}
      </div>
      <p className="field-help">
        可关联多个知识点；最多显示40个匹配项，请搜索缩小范围。拿不准可以留空，整体任务仍会保存。
      </p>
    </details>
  );
}
export function RoundWorkspace({
  catalog,
  rounds,
  reviews,
  history,
  initialRoundId,
  initialDraft,
  today,
  timeZone,
}: {
  catalog: Catalog;
  rounds: StudyRound[];
  reviews: RoundReview[];
  history: History;
  initialRoundId: string | null;
  initialDraft: RoundDraft | null;
  today: string;
  timeZone: string;
}) {
  const router = useRouter(),
    previewRef = useRef<HTMLElement>(null);
  const [roundId, setRoundId] = useState(
    initialDraft?.roundId || initialRoundId || rounds[0]?.id || "",
  );
  const [subjectId, setSubjectId] = useState(
    catalog.subjects.find((s) => !s.archivedAt)?.id || "",
  );
  const [showCreate, setShowCreate] = useState(!rounds.length);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [rows, setRows] = useState<RoundItem[]>(
    initialDraft?.applied?.rows || initialDraft?.items || [],
  );
  const [selected, setSelected] = useState<string[]>(
    initialDraft ? verifiedRoundItemIds(initialDraft) : [],
  );
  const [overview, setOverview] = useState(initialDraft?.overview || "");
  const [learningDate, setLearningDate] = useState(
    initialDraft?.learningDate || "",
  );
  const [text, setText] = useState(initialDraft?.source.text || "");
  const [fileName, setFileName] = useState<string | null>(
    initialDraft?.source.fileName || null,
  );
  const [consent, setConsent] = useState(false);
  const [sourceId, setSourceId] = useState(() => crypto.randomUUID());
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const round = rounds.find((x) => x.id === roundId),
    saved = reviews.filter((x) => x.roundId === roundId),
    past = history.filter((x) => x.round_id === roundId);
  const editable = draft?.status === "READY";
  const quoteOK = (row: RoundItem) =>
    !!draft && resolveSourceQuote(draft.source.text, row.quote) !== null;
  const selectedNeedsQuote = rows.some(
    (x) => selected.includes(x.id) && !quoteOK(x),
  );
  const omitted =
    draft?.status === "APPLIED"
      ? draft.items.filter(
          (x) => !draft.applied?.rows.some((r) => r.id === x.id),
        )
      : [];
  const activeSubject =
    round &&
    catalog.subjects.find((s) => s.id === round.subjectId && !s.archivedAt);
  const nextNumber =
    Math.max(
      1,
      ...rounds.filter((x) => x.subjectId === subjectId).map((x) => x.number),
    ) + 1;
  useEffect(() => {
    if (draft && draft.status !== "RUNNING")
      previewRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [draft?.id, draft?.status]);
  useEffect(() => {
    if (draft?.status !== "RUNNING") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/rounds?id=${draft.id}`);
        if (response.ok) {
          const value = await response.json();
          if (!cancelled && value.status !== "RUNNING") load(value);
        }
      } catch {}
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [draft?.id, draft?.status]);
  async function request(input: object) {
    const r = await fetch("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "保存失败，请重试");
    return value;
  }
  function load(value: RoundDraft) {
    setDraft(value);
    setRoundId(value.roundId);
    setRows(value.applied?.rows || value.items);
    setSelected(verifiedRoundItemIds(value));
    setOverview(value.overview);
    setLearningDate(value.learningDate || "");
    setText(value.source.text);
    setFileName(value.source.fileName);
    setCommandId(crypto.randomUUID());
    setError("");
  }
  function reset() {
    setDraft(null);
    setRows([]);
    setSelected([]);
    setText("");
    setFileName(null);
    setConsent(false);
    setSourceId(crypto.randomUUID());
    setCommandId(crypto.randomUUID());
    setNotice("");
    setError("");
  }
  function update(id: string, patch: Partial<RoundItem>) {
    setRows(
      rows.map((x) =>
        x.id === id
          ? {
              ...x,
              ...patch,
              ...(patch.quote !== undefined
                ? {
                    quoteVerified:
                      !!draft &&
                      resolveSourceQuote(draft.source.text, patch.quote) !==
                        null,
                  }
                : {}),
            }
          : x,
      ),
    );
    setCommandId(crypto.randomUUID());
  }
  function evaluation(
    id: string,
    key: keyof RoundItem["evaluation"],
    value: string | null,
  ) {
    const row = rows.find((x) => x.id === id)!;
    update(row.id, { evaluation: { ...row.evaluation, [key]: value } });
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setError("");
    try {
      const value = await request({
        action: "create",
        commandId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        subjectId,
        number: Number(form.get("number")),
        name: form.get("name"),
        objective: form.get("objective"),
        startedOn: form.get("startedOn"),
      });
      reset();
      setRoundId(value.id);
      setShowCreate(false);
      setNotice("已创建本轮，并保留开始前的已有情况。");
      router.replace(`/rounds?roundId=${value.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function analyze(retry = false) {
    setBusy("ai");
    setError("");
    try {
      const value = await request(
        retry
          ? { action: "retry", id: draft!.id, expectedVersion: draft!.version }
          : {
              action: "analyze",
              id: sourceId,
              roundId,
              text,
              fileName,
              sendToGpt: consent,
            },
      );
      load(value);
      router.refresh();
      if (value.status === "FAILED")
        setError(value.error || "整理未完成，原文已保留。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function apply() {
    setBusy("save");
    setError("");
    try {
      await request({
        action: "apply",
        commandId,
        id: draft!.id,
        expectedVersion: draft!.version,
        learningDate: learningDate || null,
        overview,
        rows: rows.filter((x) => selected.includes(x.id)),
      });
      const r = await fetch(`/api/rounds?id=${draft!.id}`);
      load(await r.json());
      setNotice("已追加本轮综合评估，此前笔记、等级和复测记录保留。");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function open(id: string) {
    setBusy("open");
    setError("");
    try {
      const r = await fetch(`/api/rounds?id=${id}`);
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      load(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function download() {
    if (!round) return;
    const body = studyRoundMarkdown(
      round,
      reviews,
      past
        .filter((x) => x.status === "APPLIED")
        .map((x) => x.overview || "")
        .filter(Boolean),
    );
    const url = URL.createObjectURL(
      new Blob([body], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `第${round.number}轮-${round.name.replace(/[<>:"/\\|?*]/g, "_")}.md`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已导出本轮任务、评估和相关知识点的此前快照。");
  }
  return (
    <div className="round-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTED LEARNING</span>
          <h1>分轮评估</h1>
          <p>
            围绕整体主线记录综合任务，一条任务可关联多个章节；保留此前情况，再追加本轮评估。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => setShowCreate(!showCreate)}
        >
          <Plus size={16} />
          新建学习轮次
        </Button>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {showCreate && (
        <form className="card round-panel" onSubmit={create}>
          <h2>新建轮次并保留此前情况</h2>
          <div className="import-form-grid">
            <label>
              科目
              <select
                value={subjectId}
                disabled={!!busy}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                {catalog.subjects
                  .filter((s) => !s.archivedAt)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label key={`n-${subjectId}`}>
              轮次编号
              <input
                name="number"
                type="number"
                min={2}
                max={999}
                defaultValue={nextNumber}
                required
                disabled={!!busy}
              />
            </label>
            <label>
              轮次名称
              <input
                name="name"
                maxLength={100}
                defaultValue="整体结构与综合应用"
                required
                disabled={!!busy}
              />
            </label>
            <label>
              开始日期
              <input
                name="startedOn"
                type="date"
                defaultValue={today}
                max={today}
                required
                disabled={!!busy}
              />
            </label>
          </div>
          <label>
            本轮主线
            <textarea
              name="objective"
              maxLength={1500}
              rows={2}
              defaultValue="从输出需求反推电路，串联拓扑、通路、控制与波形；区分无提示表现、提示后完成与尚未验证。"
              required
              disabled={!!busy}
            />
          </label>
          <p className="field-help">
            保存创建本轮时的知识点、摘要与等级快照。不会把旧记录改写成新轮次，也不推定这是第一轮结束当天的状态。
          </p>
          <Button disabled={!!busy || !subjectId}>
            {busy === "create" && <LoaderCircle className="spin" size={16} />}
            创建轮次
          </Button>
        </form>
      )}
      {!!rounds.length && (
        <section className="card round-panel">
          <label>
            当前学习轮次
            <select
              value={roundId}
              disabled={!!busy}
              onChange={(e) => {
                reset();
                setRoundId(e.target.value);
                router.replace(`/rounds?roundId=${e.target.value}`);
              }}
            >
              {rounds.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.subjectName} · 第{r.number}轮 · {r.name}
                </option>
              ))}
            </select>
          </label>
          {round && (
            <>
              <p className="round-prose">
                <strong>主线：</strong>
                {round.objective}
              </p>
              <div className="round-metrics">
                <span>{saved.length} 条综合任务</span>
                <span>
                  {new Set(saved.flatMap((x) => x.pointIds)).size} 个关联知识点
                </span>
                <span>
                  {
                    new Set(
                      saved.flatMap((x) => x.points.map((p) => p.chapter)),
                    ).size
                  }{" "}
                  个涉及章节
                </span>
                <span>{round.baseline.points.length} 个开始前快照</span>
              </div>
              <p className="field-help">
                本轮未涉及或未测的知识点保留此前状态。提示后完成、原文建议等级不作为正式复测通过。
              </p>
              <Button variant="outline" onClick={download} disabled={!!busy}>
                <Download size={16} />
                导出本轮评估与此前对照
              </Button>
            </>
          )}
        </section>
      )}
      {round && (
        <section className="card round-panel">
          <div className="section-title between">
            <h2>追加本轮综合学习记录</h2>
            {draft && (
              <Button variant="outline" disabled={!!busy} onClick={reset}>
                开始新一份记录
              </Button>
            )}
          </div>
          <p>
            上传整段跨章节记录，按实际问题整理；不必拆回每章，也不重复新建知识点。
          </p>
          <label>
            本次学习记录原文
            <textarea
              name="roundSource"
              rows={8}
              value={text}
              maxLength={20000}
              disabled={!!busy}
              readOnly={!!draft}
              onChange={(e) => {
                setText(e.target.value);
                setSourceId(crypto.randomUUID());
                setConsent(false);
              }}
            />
          </label>
          <label className="round-file">
            上传 TXT / Markdown
            <input
              type="file"
              accept=".txt,.md,.markdown,text/plain"
              disabled={!!busy || !!draft}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  if (f.size > 100000)
                    throw new Error("文件过大，请保留本次学习记录后再上传。");
                  const value = await f.text();
                  if (value.length > 20000)
                    throw new Error("文字不能超过20000字。");
                  setText(value);
                  setFileName(f.name);
                  setSourceId(crypto.randomUUID());
                  setConsent(false);
                  setError("");
                } catch (error) {
                  setError((error as Error).message);
                }
                e.target.value = "";
              }}
            />
          </label>
          {fileName && <p className="field-help">文件：{fileName}</p>}
          {!draft && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!!busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                允许本次将上述原文和本科目目录的名称、编号发送给 OpenAI GPT 整理
              </label>
              <p className="field-help">
                只有点击下方按钮才发送；此前完整笔记与冻结快照留在本地。草稿需你核对后才保存本轮评估。
              </p>
              <Button
                disabled={!!busy || !text.trim() || !consent || !activeSubject}
                onClick={() => analyze()}
              >
                {busy === "ai" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                用 GPT 整理综合记录
              </Button>
            </>
          )}
          {draft?.status === "FAILED" && (
            <>
              <p className="error-message">{draft.error}</p>
              <Button
                disabled={!!busy || !activeSubject}
                onClick={() => analyze(true)}
              >
                重试这份整理
              </Button>
            </>
          )}
          {draft?.status === "RUNNING" && (
            <p role="status">正在整理，原文已保留。完成后可在本页继续核对。</p>
          )}
        </section>
      )}
      {draft && rows.length > 0 && (
        <section className="card round-panel" ref={previewRef}>
          <h2>
            {draft.status === "APPLIED"
              ? "已保存的本轮评估"
              : "核对综合任务与评估"}
          </h2>
          <label>
            整体主线与本次进展
            <textarea
              rows={4}
              maxLength={3000}
              value={overview}
              disabled={!editable || !!busy}
              onChange={(e) => {
                setOverview(e.target.value);
                setCommandId(crypto.randomUUID());
              }}
            />
          </label>
          {draft.warnings.map((x, i) => (
            <p className="info-note" key={i}>
              {x}
            </p>
          ))}
          {rows.map((row, index) => (
            <article className="round-edit-card" key={row.id}>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  disabled={!editable || !!busy}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? [...selected, row.id]
                        : selected.filter((x) => x !== row.id),
                    );
                    setCommandId(crypto.randomUUID());
                  }}
                />
                保存任务 {index + 1}
              </label>
              <label>
                任务原文依据（逐字摘录，可修正）
                <textarea
                  aria-label={`任务原文依据 ${index + 1}`}
                  rows={3}
                  value={row.quote}
                  maxLength={2000}
                  disabled={!editable || !!busy}
                  onChange={(e) => update(row.id, { quote: e.target.value })}
                />
              </label>
              <p className={quoteOK(row) ? "field-help" : "error-message"}>
                {quoteOK(row)
                  ? "摘录已在原文中找到。保存时采用原文排版。"
                  : "这段摘录暂未在原文中找到，不作为原文证据。请从上方原文复制相关段落修正后勾选，或先不保存此项。"}
              </p>
              <label>
                综合任务 / 问题
                <input
                  aria-label={`综合任务 ${index + 1}`}
                  value={row.title}
                  maxLength={150}
                  disabled={!editable || !!busy}
                  onChange={(e) => update(row.id, { title: e.target.value })}
                />
              </label>
              <label>
                本轮表现
                <select
                  aria-label={`本轮表现 ${index + 1}`}
                  value={row.evaluation.performance}
                  disabled={!editable || !!busy}
                  onChange={(e) =>
                    evaluation(row.id, "performance", e.target.value)
                  }
                >
                  {Object.entries(roundPerformances).map(([key, value]) => (
                    <option value={key} key={key}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                本轮情况摘要
                <textarea
                  rows={3}
                  value={row.summary}
                  maxLength={4000}
                  disabled={!editable || !!busy}
                  onChange={(e) => update(row.id, { summary: e.target.value })}
                />
              </label>
              <PointPicker
                points={draft.context}
                value={row.pointIds}
                index={index + 1}
                disabled={!editable || !!busy}
                onChange={(pointIds) => update(row.id, { pointIds })}
              />
              <details>
                <summary>核对首次作答、提示、订正与剩余验证</summary>
                <div className="import-form-grid">
                  {(
                    [
                      ["firstAnswer", "首次作答"],
                      ["assistance", "实际提示"],
                      ["correction", "订正表现"],
                      ["remaining", "尚待验证"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <textarea
                        rows={3}
                        value={row.evaluation[key] || ""}
                        maxLength={3000}
                        disabled={!editable || !!busy}
                        onChange={(e) =>
                          evaluation(row.id, key, e.target.value || null)
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  本轮原文建议等级（不改当前等级）
                  <select
                    value={row.evaluation.sourceLevel || ""}
                    disabled={!editable || !!busy}
                    onChange={(e) => {
                      const level = e.target.value;
                      update(row.id, {
                        evaluation: {
                          ...row.evaluation,
                          sourceLevel: (level ||
                            null) as RoundItem["evaluation"]["sourceLevel"],
                          sourceLevelQuote: level
                            ? row.evaluation.sourceLevelQuote
                            : null,
                        },
                      });
                    }}
                  >
                    <option value="">原文未明确 / 暂不采用</option>
                    {["UNASSESSED", "A", "B", "C", "D", "E"].map((x) => (
                      <option key={x} value={x}>
                        {x === "UNASSESSED" ? "本轮暂未评估" : x}
                      </option>
                    ))}
                  </select>
                </label>
                {row.evaluation.sourceLevel && (
                  <label>
                    等级原文摘录
                    <textarea
                      value={row.evaluation.sourceLevelQuote || ""}
                      maxLength={2000}
                      disabled={!editable || !!busy}
                      onChange={(e) =>
                        evaluation(
                          row.id,
                          "sourceLevelQuote",
                          e.target.value || null,
                        )
                      }
                    />
                  </label>
                )}
                <p className="field-help">
                  保留本轮原文的评级和提示条件；不与系统“C·基础独立完成”直接等同，更不自动覆盖第一轮。
                </p>
              </details>
            </article>
          ))}
          {editable && (
            <>
              <label>
                实际学习日期（请核对，可留空）
                <input
                  type="date"
                  max={today}
                  value={learningDate}
                  onChange={(e) => {
                    setLearningDate(e.target.value);
                    setCommandId(crypto.randomUUID());
                  }}
                />
              </label>
              {sourceDateCandidates(draft.source.text).length > 0 && (
                <label>
                  原文日期线索（需本人确认）
                  <select
                    value=""
                    onChange={(e) => {
                      setLearningDate(e.target.value);
                      setCommandId(crypto.randomUUID());
                    }}
                  >
                    <option value="">选择实际学习日期…</option>
                    {sourceDateCandidates(draft.source.text).map((x, i) => (
                      <option key={i} value={x.day}>
                        {x.day} · {x.quote}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="field-help">
                仅追加本轮任务、评估和关联关系；不覆盖旧笔记或等级，不创建正式通过、错误解决或已完成任务。
              </p>
              <p className="info-note">
                将保存 {selected.length}/{rows.length}{" "}
                条任务。未选中的项目保留在原文与生成草稿中，不写入本轮评估。
              </p>
              {selectedNeedsQuote && (
                <p className="error-message">
                  已选任务中仍有摘录未核对，请先修正或取消该项。
                </p>
              )}
              <Button
                disabled={!!busy || !selected.length || selectedNeedsQuote}
                onClick={apply}
              >
                {busy === "save" && <LoaderCircle className="spin" size={16} />}
                确认追加本轮评估
              </Button>
            </>
          )}
          {omitted.length > 0 && (
            <details>
              <summary>未保存的生成草稿项目（{omitted.length}）</summary>
              <p className="field-help">
                这些项目没有作为评估保存。原文与生成内容仍保留，可查看后另行录入。
              </p>
              {omitted.map((x) => (
                <article className="round-edit-card" key={x.id}>
                  <h3>{x.title}</h3>
                  <p>{x.summary}</p>
                  <p className="round-prose">
                    生成时拟引用（尚需核对）：{x.quote}
                  </p>
                </article>
              ))}
            </details>
          )}
        </section>
      )}
      {round && (
        <section className="card round-panel">
          <h2>整体学习记录与来源</h2>
          {!past.length && (
            <p>
              尚无本轮整理记录。第一轮和此前记录仍在学习总结与知识点历史中。
            </p>
          )}
          {past.map((x) => (
            <details key={x.id} className="round-history">
              <summary>
                {localDay(x.created_at, timeZone)} ·{" "}
                {x.file_name || "本轮学习记录"} ·{" "}
                {x.status === "APPLIED"
                  ? "已保存"
                  : x.status === "READY"
                    ? "待确认"
                    : x.status === "FAILED"
                      ? "整理失败"
                      : x.status === "RUNNING"
                        ? "正在整理"
                        : "已放弃"}
              </summary>
              {x.overview && <p className="round-prose">{x.overview}</p>}
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => open(x.id)}
              >
                打开原文与确认稿
              </Button>
            </details>
          ))}
        </section>
      )}
      {round && (
        <section className="card round-panel">
          <h2>按日期回看本轮任务与此前情况</h2>
          {!saved.length && (
            <p>
              确认保存后，综合任务会在这里出现；未涉及的知识点不会被标成没学或不会。
            </p>
          )}
          {[...new Set(saved.map((x) => x.day))]
            .sort((a, b) =>
              a === null ? 1 : b === null ? -1 : b.localeCompare(a),
            )
            .map((day) => (
              <section key={day || "undated"}>
                <h3 className="round-day">{day || "学习日期未登记"}</h3>
                {saved
                  .filter((x) => x.day === day)
                  .map((x) => (
                    <RoundReviewCard
                      key={x.id}
                      review={x}
                      round={round}
                      previous={reviews}
                    />
                  ))}
              </section>
            ))}
        </section>
      )}
      <p className="field-help">
        需要新增知识点或保存第一轮逐点笔记时，可使用
        <Link href="/imports">普通 AI 录入</Link>
        ；第二轮的综合任务留在此处，关联原来的知识点。
      </p>
    </div>
  );
}
