"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload,
  Sparkles,
  LoaderCircle,
  Check,
  RefreshCw,
  ArrowUpRight,
  FileText,
  ChevronRight,
} from "lucide-react";
import { localDay } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { stages, levels, bases, type Catalog } from "@/lib/models";
import { levelConfirmationReason } from "@/lib/import-levels";
import { listedLevels } from "@/lib/import-candidates";
import { sourceDateCandidates } from "@/lib/import-dates";
import { sourceChapterMatches } from "@/lib/import-chapters";
import {
  importStatuses,
  type ImportDraft,
  type ImportSource,
  type ReviewedItem,
} from "@/lib/import-models";

type History = {
  id: string;
  status: ImportDraft["status"];
  version: number;
  created_at: string;
  subject_name: string;
  file_name: string | null;
  error: string | null;
}[];
type Account = { connected: boolean; message: string; model: string };
const unassessedReason = "尚未确认掌握等级，暂列为暂未评估。";
function initialRows(draft: ImportDraft | null): ReviewedItem[] {
  if (!draft) return [];
  const reviewed = draft.applied as ImportDraft["applied"] & {
    reviewed?: { rows: ReviewedItem[] };
  };
  if (reviewed?.reviewed)
    return reviewed.reviewed.rows.map((r) => ({
      ...r,
      level: r.level || null,
      levelReason: r.levelReason || "",
    }));
  return draft.items.map((item) => {
    const point = draft.context.points.find((p) => p.id === item.pointId);
    return {
      id: item.id,
      selected: true,
      pointId: item.pointId,
      chapterId: item.chapterId,
      chapterName: item.chapterName || "",
      name: item.name,
      stage: item.stage,
      level: item.reportedLevel?.level || (point ? null : "UNASSESSED"),
      levelReason:
        levelConfirmationReason(item.reportedLevel) ||
        (point ? "" : unassessedReason),
      summary: point?.aiSummary
        ? `${point.aiSummary}\n\n【本次整理】\n${item.summary}`
        : item.summary,
    };
  });
}
export function ImportWorkspace({
  catalog,
  history,
  initialDraft,
  initialAccount,
  timeZone,
}: {
  catalog: Catalog;
  history: History;
  initialDraft: ImportDraft | null;
  initialAccount: Account;
  timeZone: string;
}) {
  const router = useRouter();
  const previewRef = useRef<HTMLElement>(null);
  const [account, setAccount] = useState(initialAccount);
  const [past, setPast] = useState(history);
  const [historyExpanded, setHistoryExpanded] = useState<
    Record<string, boolean>
  >({});
  const historyGroups = Array.from(
    past.reduce((groups, item) => {
      const day = localDay(item.created_at, timeZone);
      groups.set(day, [...(groups.get(day) || []), item]);
      return groups;
    }, new Map<string, History>()),
  ).sort(([a], [b]) => b.localeCompare(a));
  const historyGroupOpen = (day: string, items: History) =>
    historyExpanded[day] ??
    (day === historyGroups[0]?.[0] ||
      items.some((item) => item.id === draft?.id));
  const [draft, setDraft] = useState(initialDraft);
  const [rows, setRows] = useState(() => initialRows(initialDraft));
  const [subjectId, setSubjectId] = useState(
    catalog.subjects.find((s) => !s.archivedAt)?.id || "new",
  );
  const [newSubject, setNewSubject] = useState("");
  const [chapterScope, setChapterScope] = useState("auto");
  const [text, setText] = useState("");
  const subjectChapters = catalog.chapters.filter(
    (c) => c.subjectId === subjectId && !c.archivedAt,
  );
  const chapterPointCount = (id: string) =>
    catalog.points.filter((p) => p.chapterId === id && !p.archivedAt).length;
  const detectedChapter = sourceChapterMatches(text, subjectChapters);
  const useDetectedChapter = chapterScope === "auto" || chapterScope === "new";
  const scopeChapters =
    useDetectedChapter && detectedChapter.hint
      ? detectedChapter.matches
      : subjectChapters.filter(
          (c) =>
            chapterScope === "all" ||
            chapterScope === "auto" ||
            c.id === chapterScope,
        );
  const scopeCount =
    subjectId === "new"
      ? 0
      : scopeChapters.reduce((n, c) => n + chapterPointCount(c.id), 0);
  const scopeTooLarge = scopeCount > 300;
  const chapterAmbiguous =
    useDetectedChapter && detectedChapter.matches.length > 1;
  const [fileName, setFileName] = useState("");
  const [textFileName, setTextFileName] = useState<string | null>(null);
  const [attachment, setAttachment] =
    useState<ImportSource["attachment"]>(null);
  const [sourceId, setSourceId] = useState(() => crypto.randomUUID());
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [withSession, setWithSession] = useState(false);
  const [learningDate, setLearningDate] = useState(
    initialDraft?.learningDate || "",
  );
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [minutes, setMinutes] = useState("");
  const [activity, setActivity] = useState("LEARN");
  const [levelEdit, setLevelEdit] = useState(false);
  const editable = draft?.status === "READY";
  const levelsEditable = editable || levelEdit;
  useEffect(() => {
    if (draft && draft.status !== "RUNNING")
      previewRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [draft?.id, draft?.status]);
  useEffect(() => {
    if (draft?.status === "APPLIED" && subjectId === "new") {
      const subject = catalog.subjects.find(
        (s) => s.name === draft.source.subject.name && !s.archivedAt,
      );
      if (subject) setSubjectId(subject.id);
    }
  }, [catalog.subjects, draft?.status, draft?.source.subject.name, subjectId]);
  const format = (at: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(at));
  async function request(payload: object) {
    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "请求失败，请重试。");
    return result;
  }
  async function refreshHistory() {
    const response = await fetch("/api/imports", { cache: "no-store" });
    if (response.ok) setPast(await response.json());
  }
  function loadDraft(value: ImportDraft) {
    setDraft(value);
    setRows(initialRows(value));
    setLevelEdit(false);
    setCommandId(crypto.randomUUID());
    setWithSession(false);
    setLearningDate(value.learningDate || "");
    setStart("");
    setEnd("");
    setMinutes("");
  }
  useEffect(() => {
    if (draft?.status !== "RUNNING") return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/imports/${draft.id}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const d = await r.json();
          if (d.status !== "RUNNING") {
            loadDraft(d);
            await refreshHistory();
          }
        }
      } catch {
        /* A temporary outage does not erase the source. */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [draft?.id, draft?.status]);
  function updateRow(id: string, patch: Partial<ReviewedItem>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setCommandId(crypto.randomUUID());
    setError("");
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (/\.(txt|md|markdown)$/i.test(file.name)) {
        if (file.size > 100 * 1024)
          throw new Error("文字文件不能超过 100 KB。");
        let value: string;
        try {
          value = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer(),
          );
        } catch {
          throw new Error("请将文字文件保存为 UTF-8，或直接粘贴内容。");
        }
        if (value.length > 20000)
          throw new Error("学习进度不能超过 20,000 字，请分次整理。");
        setText(value);
        setAttachment(null);
        setTextFileName(file.name);
      } else if (
        ["image/png", "image/jpeg", "image/webp"].includes(file.type)
      ) {
        if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5 MB。");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("无法读取图片。"));
          reader.readAsDataURL(file);
        });
        setAttachment({
          name: file.name,
          mime: file.type as NonNullable<ImportSource["attachment"]>["mime"],
          base64: data,
        });
      } else
        throw new Error(
          "当前支持 TXT、Markdown、PNG、JPEG 和 WebP。PDF / Word 请先复制学习进度文字。",
        );
      setFileName(file.name);
      setSourceId(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy("analyze");
    try {
      const name =
        subjectId === "new"
          ? newSubject.trim()
          : catalog.subjects.find((s) => s.id === subjectId)?.name;
      if (!name) throw new Error("请填写科目名称。");
      if (scopeTooLarge)
        throw new Error(
          "请在原文写明本次章节（例如“依据：第七章课件”），或手动选择整理范围。",
        );
      if (chapterAmbiguous)
        throw new Error("同一章号对应多个目录，请手动选择章节。");
      const value = await request({
        action: "analyze",
        id: sourceId,
        subject: { id: subjectId === "new" ? null : subjectId, name },
        ...(chapterScope === "auto"
          ? { chapterMode: "AUTO" }
          : subjectId !== "new" && chapterScope !== "all"
            ? { chapterIds: chapterScope === "new" ? [] : [chapterScope] }
            : {}),
        text,
        textFileName,
        attachment,
      });
      loadDraft(value);
      if (value.status === "READY")
        setNotice("已生成整理草稿。请核对归属、原文和最终摘要，再确认保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      await refreshHistory().catch(() => {});
    }
  }
  async function open(id: string) {
    setBusy("open");
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/imports/${id}`, { cache: "no-store" });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      loadDraft(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function handle(action: "retry" | "discard" | "apply" | "levels") {
    if (!draft) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      if (action === "levels") {
        const selected = rows.filter((r) => r.selected && r.level);
        const result = await request({
          action,
          commandId,
          id: draft.id,
          expectedVersion: draft.version,
          rows: selected.map((r) => {
            const current = draft.levelReview?.find((p) => p.id === r.id);
            if (!current)
              throw new Error("无法定位已保存知识点，请重新打开这份历史。");
            return {
              id: r.id,
              pointId: current.pointId,
              expectedPointVersion: current.expectedPointVersion,
              level: r.level,
              reason: r.levelReason || "",
            };
          }),
        });
        const response = await fetch(`/api/imports/${draft.id}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("等级已保存，请刷新查看。");
        loadDraft(await response.json());
        setNotice(
          `已补充 ${result.pointIds.length} 个知识点的等级确认；原文、摘要和复测历史保留。`,
        );
        router.refresh();
      } else if (action === "apply") {
        const result = await request({
          action,
          commandId,
          id: draft.id,
          expectedVersion: draft.version,
          rows,
          learningDate: learningDate || null,
          session: withSession
            ? {
                startedLocal: start,
                endedLocal: end,
                durationMinutes: Number(minutes),
                activity,
              }
            : null,
        });
        setNotice(
          `已保存 ${result.pointIds.length} 个知识点的摘要、进度与所选等级${result.sessionId ? "，并记录一条实际学习日志" : ""}。`,
        );
        const r = await fetch(`/api/imports/${draft.id}`, {
          cache: "no-store",
        });
        loadDraft(await r.json());
        setSourceId(crypto.randomUUID());
        router.refresh();
      } else
        loadDraft(
          await request({
            action,
            id: draft.id,
            expectedVersion: draft.version,
          }),
        );
      await refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="import-workspace">
      <section className="import-account card">
        <div>
          <span
            className={`import-account-dot ${account.connected ? "connected" : ""}`}
          />
          <strong>{account.message}</strong>
          <p className="muted">使用 ChatGPT 账户的 Codex 额度 · 无需 API Key</p>
        </div>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            setBusy("account");
            try {
              const r = await fetch("/api/imports/account");
              setAccount(await r.json());
            } catch {
              setError("无法读取登录状态。");
            } finally {
              setBusy("");
            }
          }}
        >
          <RefreshCw size={15} />
          检查登录
        </Button>
      </section>
      {!account.connected && (
        <p className="notice">
          请在本机终端运行 <code>codex login</code>，用 ChatGPT
          完成登录后点击“检查登录”。知序不会读取或保存你的密码。
        </p>
      )}
      <div className="import-steps" aria-label="录入步骤">
        <span className={!draft ? "current" : ""}>1 · 上传进度</span>
        <span className={draft?.status === "READY" ? "current" : ""}>
          2 · 核对整理
        </span>
        <span className={draft?.status === "APPLIED" ? "current" : ""}>
          3 · 保存到知识树
        </span>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="import-layout">
        <form className="card import-source" onSubmit={analyze}>
          <div className="section-title">
            <Upload size={19} />
            <h2>这次学了什么</h2>
          </div>
          <label>
            整理到科目
            <select
              value={subjectId}
              disabled={!!busy}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setChapterScope("auto");
                setSourceId(crypto.randomUUID());
              }}
            >
              {catalog.subjects
                .filter((s) => !s.archivedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              <option value="new">新建一个科目…</option>
            </select>
          </label>
          {subjectId !== "new" && (
            <label>
              整理范围
              <select
                aria-label="整理范围"
                value={chapterScope}
                disabled={!!busy}
                onChange={(e) => {
                  setChapterScope(e.target.value);
                  setSourceId(crypto.randomUUID());
                  setError("");
                }}
              >
                <option value="auto">自动识别章节（按原文依据）</option>
                <option value="all">
                  全部章节（
                  {subjectChapters.reduce(
                    (n, c) => n + chapterPointCount(c.id),
                    0,
                  )}{" "}
                  个知识点）
                </option>
                {subjectChapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{chapterPointCount(c.id)} 个知识点）
                  </option>
                ))}
                <option value="new">新章节（尚未建立目录）</option>
              </select>
              <span
                className={
                  scopeTooLarge || chapterAmbiguous
                    ? "error-message"
                    : "field-help"
                }
              >
                {chapterAmbiguous
                  ? "同一章号对应多个目录，请手动选择章节。"
                  : useDetectedChapter && detectedChapter.hint
                    ? `已识别：${detectedChapter.matches[0]?.name || detectedChapter.hint.name}（${detectedChapter.matches.length ? "已有章节，自动归入" : "新章节，确认保存时自动创建"}）。依据：${detectedChapter.hint.quote}`
                    : scopeTooLarge
                      ? `当前科目有 ${scopeCount} 个知识点。请先粘贴或上传包含章节依据的原文，或手动选章；单次最多匹配 300 个。`
                      : `本次匹配 ${scopeCount} 个已有知识点。只发送所选范围的目录，原文仍完整保留。`}
              </span>
            </label>
          )}
          {subjectId === "new" && (
            <label>
              新科目名称
              <input
                maxLength={100}
                value={newSubject}
                disabled={!!busy}
                placeholder="例如：高等数学"
                onChange={(e) => {
                  setNewSubject(e.target.value);
                  setSourceId(crypto.randomUUID());
                }}
              />
            </label>
          )}
          <label>
            学习进度原文
            <textarea
              rows={7}
              maxLength={20000}
              value={text}
              disabled={!!busy}
              placeholder="例如：今天学到极限的运算法则，做了几道练习。洛必达法则还没学。可以附上笔记或学习进度截图。"
              onChange={(e) => {
                setText(e.target.value);
                setSourceId(crypto.randomUUID());
              }}
            />
          </label>
          <label className="import-upload">
            <Upload size={18} />
            <span>{fileName || "上传文字文件或学习进度截图"}</span>
            <input
              aria-label="上传学习进度文件"
              type="file"
              accept=".txt,.md,.markdown,image/png,image/jpeg,image/webp"
              disabled={!!busy}
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {attachment && (
            <div className="import-image">
              <img
                src={`data:${attachment.mime};base64,${attachment.base64}`}
                alt="待整理的学习进度截图"
              />
              <Button
                type="button"
                variant="ghost"
                disabled={!!busy}
                onClick={() => {
                  setAttachment(null);
                  setFileName("");
                  setSourceId(crypto.randomUUID());
                }}
              >
                移除图片
              </Button>
            </div>
          )}
          <p className="field-help">
            文字最多 20,000 字；图片最多 5 MB。PDF / Word
            目前请复制文字。原文会保存在本机，并与该科目的知识点目录一起发送给
            OpenAI。
          </p>
          <Button
            type="submit"
            disabled={
              !!busy ||
              scopeTooLarge ||
              chapterAmbiguous ||
              !account.connected ||
              (!text.trim() && !attachment)
            }
          >
            {busy === "analyze" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            {busy === "analyze" ? "GPT 正在整理…" : "用 GPT 整理"}
          </Button>
          <p className="field-help">
            生成草稿不会改动学习记录。整理通常需要几十秒，最多等待 3 分钟。
          </p>
        </form>
        <aside className="card import-history">
          <div className="section-title between">
            <FileText size={18} />
            <h2>整理历史</h2>
            {past.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const expand = !historyGroups.some(([day, items]) =>
                    historyGroupOpen(day, items),
                  );
                  setHistoryExpanded(
                    Object.fromEntries(
                      historyGroups.map(([day]) => [day, expand]),
                    ),
                  );
                }}
              >
                {historyGroups.some(([day, items]) =>
                  historyGroupOpen(day, items),
                )
                  ? "全部收起"
                  : "展开全部"}
              </Button>
            )}
          </div>
          <p className="muted">
            按录入日期分组，默认展开最近一天。原文与确认结果保留。
          </p>
          {!past.length && (
            <div className="import-history-empty">
              第一份学习进度，从这里开始。
            </div>
          )}
          <div className="import-history-list">
            {historyGroups.map(([day, items]) => (
              <section className="import-history-group" key={day}>
                <button
                  type="button"
                  className="import-history-day"
                  aria-expanded={historyGroupOpen(day, items)}
                  aria-controls={`history-${day}`}
                  onClick={() =>
                    setHistoryExpanded((prev) => ({
                      ...prev,
                      [day]: !historyGroupOpen(day, items),
                    }))
                  }
                >
                  <ChevronRight size={15} />
                  <strong>{day}</strong>
                  <span>{items.length} 条</span>
                </button>
                <div
                  id={`history-${day}`}
                  hidden={!historyGroupOpen(day, items)}
                >
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!!busy}
                      onClick={() => open(item.id)}
                      className={`import-history-row ${draft?.id === item.id ? "active" : ""}`}
                    >
                      <span>
                        <strong>{item.subject_name}</strong>
                        <small title={item.file_name || undefined}>
                          {new Intl.DateTimeFormat("zh-CN", {
                            timeZone,
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }).format(new Date(item.created_at))}
                          {item.file_name ? ` · ${item.file_name}` : ""}
                        </small>
                      </span>
                      <span className="tag">{importStatuses[item.status]}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
      </div>
      {draft && (
        <section
          ref={previewRef}
          className="card import-preview"
          aria-label="整理预览"
        >
          <div className="section-title between">
            <div>
              <span className="eyebrow">
                {draft.source.subject.name} · {importStatuses[draft.status]}
              </span>
              <h2>
                {draft.status === "APPLIED" ? "已确认保存" : "核对这份整理"}
              </h2>
            </div>
            <span className="muted">{format(draft.createdAt)}</span>
          </div>
          <details className="import-original">
            <summary>
              查看原始内容{draft.source.attachment ? "与截图" : ""}
            </summary>
            <pre>{draft.source.text || "（本次上传图片）"}</pre>
            {draft.source.attachment && (
              <img
                src={`/api/imports/${draft.id}/source`}
                alt={draft.source.attachment.name}
              />
            )}
          </details>
          {draft.error && (
            <p role="alert" className="error-message">
              {draft.error}
            </p>
          )}
          {draft.warnings.length > 0 && (
            <div className="import-warnings">
              <strong>
                {draft.status === "APPLIED" ? "首次整理时的提醒" : "需要留意"}
              </strong>
              {draft.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          {draft.status === "APPLIED" && (
            <div className="info-note">
              学习日期：{draft.learningDate || "未登记"}。
              {draft.applied?.sessionId
                ? "实际用时见关联学习日志。"
                : "未登记精确起止时间和用时；有日期的记录仍会进入相应日期的学习总结。"}
            </div>
          )}
          {draft.status === "APPLIED" &&
          !levelEdit &&
          draft.levelReview?.length &&
          (draft.items.some((i) => i.reportedLevel) ||
            listedLevels(draft.source.text).length > 0) ? (
            <div className="import-level-actions">
              <p className="field-help">
                原文含有等级建议，可核对后补充或调整等级，不必重新上传。若已有较新的评估，可逐项选择保留当前等级。
              </p>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  setRows(
                    initialRows(draft).map((r) => {
                      const suggestion = draft.items.find(
                        (i) => i.id === r.id,
                      )?.reportedLevel;
                      return {
                        ...r,
                        level: suggestion?.level || null,
                        levelReason: levelConfirmationReason(suggestion),
                      };
                    }),
                  );
                  setLevelEdit(true);
                  setCommandId(crypto.randomUUID());
                  setNotice("");
                  setError("");
                }}
              >
                补充原文等级
              </Button>
            </div>
          ) : null}
          {levelEdit && (
            <div className="info-note">
              正在补充等级：下面只保存勾选项目的等级与原因，不重复保存学习内容或用时。请核对当前状态，避免用较早建议替代较新的评估。
            </div>
          )}
          {draft.status === "RUNNING" && (
            <p className="notice">
              <LoaderCircle className="spin" size={16} /> GPT
              正在整理，完成后将显示草稿。刷新页面后也可从历史继续查看。
            </p>
          )}
          {draft.status === "FAILED" && (
            <Button disabled={!!busy} onClick={() => handle("retry")}>
              <RefreshCw size={16} />
              {busy === "retry" ? "正在重试…" : "重试这份原文"}
            </Button>
          )}
          {!rows.length && draft.status === "READY" && (
            <p className="notice">
              这份内容没有可录入的学习进度。请补充实际学习情况后重新上传。
            </p>
          )}
          {rows.map((row, index) => {
            const item = draft.items.find((i) => i.id === row.id)!;
            const captured = draft.context.points.find(
              (p) => p.id === row.pointId,
            );
            const chapterName = draft.context.chapters.find(
              (c) => c.id === captured?.chapterId,
            )?.name;
            return (
              <article
                key={row.id}
                className={`import-item ${row.selected ? "" : "unselected"}`}
              >
                <div className="import-item-heading">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={!levelsEditable || !!busy}
                      onChange={(e) =>
                        updateRow(row.id, { selected: e.target.checked })
                      }
                    />
                    <strong>
                      {index + 1}. {captured?.name || row.name}
                    </strong>
                  </label>
                  <span className="tag">
                    {row.pointId
                      ? "已有知识点"
                      : draft.status === "APPLIED"
                        ? "本次新建"
                        : "建议新建"}
                  </span>
                </div>
                <blockquote>“{item.quote}”</blockquote>
                <p className="muted">归属依据：{item.reason}</p>
                <div className="import-form-grid">
                  <label>
                    对应知识点
                    <select
                      aria-label={`对应知识点 ${index + 1}`}
                      value={row.pointId || "new"}
                      disabled={!editable || !!busy}
                      onChange={(e) => {
                        const p = draft.context.points.find(
                          (p) => p.id === e.target.value,
                        );
                        updateRow(row.id, {
                          pointId: p?.id || null,
                          chapterId: p?.chapterId || item.chapterId,
                          name: p?.name || item.name,
                          stage: item.stage,
                          level:
                            item.reportedLevel?.level ||
                            (p ? null : "UNASSESSED"),
                          levelReason:
                            levelConfirmationReason(item.reportedLevel) ||
                            (p ? "" : unassessedReason),
                          summary: p?.aiSummary
                            ? `${p.aiSummary}\n\n【本次整理】\n${item.summary}`
                            : item.summary,
                        });
                      }}
                    >
                      <option value="new">新建知识点</option>
                      {draft.context.points.map((p) => (
                        <option key={p.id} value={p.id}>
                          {
                            draft.context.chapters.find(
                              (c) => c.id === p.chapterId,
                            )?.name
                          }{" "}
                          / {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    学习进度
                    <select
                      aria-label={`学习进度 ${index + 1}`}
                      value={row.stage || "keep"}
                      disabled={!editable || !!busy}
                      onChange={(e) =>
                        updateRow(row.id, {
                          stage:
                            e.target.value === "keep"
                              ? null
                              : (e.target.value as ReviewedItem["stage"]),
                        })
                      }
                    >
                      <option value="keep">
                        {captured
                          ? `保留原进度（${stages[captured.learningStage]}）`
                          : "暂不确认（未开始）"}
                      </option>
                      {Object.entries(stages).map(([key, value]) => (
                        <option value={key} key={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="import-level">
                  <p className="field-help">
                    {(() => {
                      const current = draft.levelReview?.find(
                        (p) => p.id === row.id,
                      );
                      const basis =
                        current?.currentBasis || captured?.masteryBasis;
                      const level =
                        current?.currentLevel || captured?.masteryLevel;
                      return basis
                        ? `当前：${basis === "UNASSESSED" ? bases.UNASSESSED : `${level} · ${bases[basis]}`}。`
                        : "新知识点默认暂未评估。";
                    })()}
                    {item.reportedLevel
                      ? ` 原文建议：${item.reportedLevel.level === "UNASSESSED" ? "暂未评估" : item.reportedLevel.level}；“${item.reportedLevel.quote}”`
                      : " 原文没有可明确对应的等级，不自动推断。"}
                  </p>
                  <div className="import-form-grid">
                    <label>
                      {draft.status === "APPLIED" && !levelEdit
                        ? "最初保存的等级"
                        : "确认等级（用户自评）"}
                      <select
                        aria-label={`确认等级 ${index + 1}`}
                        value={
                          row.level ||
                          (!levelsEditable && draft.status === "APPLIED"
                            ? "unrecorded"
                            : (() => {
                                const current = draft.levelReview?.find(
                                  (p) => p.id === row.id,
                                );
                                const basis =
                                  current?.currentBasis ||
                                  captured?.masteryBasis;
                                return basis && basis !== "UNASSESSED"
                                  ? current?.currentLevel ||
                                      captured?.masteryLevel
                                  : "UNASSESSED";
                              })())
                        }
                        disabled={!levelsEditable || !!busy}
                        onChange={(e) => {
                          const level = e.target.value as NonNullable<
                            ReviewedItem["level"]
                          >;
                          updateRow(row.id, {
                            level,
                            levelReason:
                              level === "UNASSESSED"
                                ? unassessedReason
                                : level === item.reportedLevel?.level
                                  ? levelConfirmationReason(item.reportedLevel)
                                  : "本人核对学习情况后确认此等级。",
                          });
                        }}
                      >
                        {!levelsEditable &&
                          draft.status === "APPLIED" &&
                          !row.level && (
                            <option value="unrecorded">当时未录入等级</option>
                          )}
                        <option value="UNASSESSED">暂未评估</option>
                        {Object.entries(levels).map(([key, value]) => (
                          <option key={key} value={key}>
                            {key} · {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!!row.level && (
                      <label>
                        等级确认原因
                        <textarea
                          aria-label={`等级确认原因 ${index + 1}`}
                          rows={2}
                          maxLength={1000}
                          value={row.levelReason || ""}
                          disabled={!levelsEditable || !!busy}
                          onChange={(e) =>
                            updateRow(row.id, { levelReason: e.target.value })
                          }
                        />
                      </label>
                    )}
                  </div>
                  {levelsEditable && (
                    <p className="field-help">
                      未确认等级时选择“暂未评估”；已有等级未作调整时仍保留。
                      保存时采用你确认的等级，A–E
                      标记为用户自评；不生成复测通过、错误解决或任务完成。
                    </p>
                  )}
                </div>
                {levelsEditable && item.levelCandidate && (
                  <div className="notice">
                    <p>
                      GPT 建议对应这条原文等级（名称不同，尚未采用）：
                      {item.levelCandidate.quote}
                    </p>
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        updateRow(row.id, {
                          level: item.levelCandidate!.level,
                          levelReason: levelConfirmationReason(
                            item.levelCandidate,
                          ),
                        })
                      }
                    >
                      确认对应并采用此等级
                    </Button>
                  </div>
                )}
                {levelsEditable &&
                  listedLevels(draft.source.text).length > 0 && (
                    <label>
                      原文集中列出的等级（请确认对应知识点）
                      <select
                        aria-label={`原文等级候选 ${index + 1}`}
                        value=""
                        disabled={!!busy}
                        onChange={(e) => {
                          const candidate = listedLevels(draft.source.text)[
                            Number(e.target.value)
                          ];
                          if (candidate)
                            updateRow(row.id, {
                              level: candidate.level,
                              levelReason: levelConfirmationReason(candidate),
                            });
                        }}
                      >
                        <option value="">选择与本项对应的原文等级…</option>
                        {listedLevels(draft.source.text).map((x, i) => (
                          <option key={i} value={i}>
                            {x.quote}
                          </option>
                        ))}
                      </select>
                      <span className="field-help">
                        名称不同的候选需你确认归属；选择后仍可调整等级。
                      </span>
                    </label>
                  )}
                {editable && (
                  <div className="import-session">
                    {item.review && (
                      <p>
                        待复测建议：{item.review.action}
                        <br />
                        原文依据：{item.review.quote}
                      </p>
                    )}
                    <label className="check-label">
                      <input
                        type="checkbox"
                        aria-label={`安排复测 ${index + 1}`}
                        checked={!!row.reviewTask}
                        disabled={!!busy || !row.selected}
                        onChange={(e) =>
                          updateRow(row.id, {
                            reviewTask: e.target.checked
                              ? {
                                  dueOn: "",
                                  action: item.review?.action || "",
                                  quote: item.review?.quote || "",
                                }
                              : null,
                          })
                        }
                      />
                      确认安排一次复测
                    </label>
                    {row.reviewTask && (
                      <div className="import-form-grid">
                        <label>
                          复测日期
                          <input
                            aria-label={`复测日期 ${index + 1}`}
                            type="date"
                            value={row.reviewTask.dueOn}
                            disabled={!!busy}
                            onChange={(e) =>
                              updateRow(row.id, {
                                reviewTask: {
                                  ...row.reviewTask!,
                                  dueOn: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          具体检查内容
                          <textarea
                            aria-label={`复测内容 ${index + 1}`}
                            maxLength={500}
                            value={row.reviewTask.action}
                            disabled={!!busy}
                            onChange={(e) =>
                              updateRow(row.id, {
                                reviewTask: {
                                  ...row.reviewTask!,
                                  action: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          原文依据（逐字摘录）
                          <textarea
                            aria-label={`复测依据 ${index + 1}`}
                            maxLength={500}
                            value={row.reviewTask.quote}
                            disabled={!!busy}
                            onChange={(e) =>
                              updateRow(row.id, {
                                reviewTask: {
                                  ...row.reviewTask!,
                                  quote: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                    <p className="field-help">
                      默认不创建任务。勾选并选择今天或未来日期后，与本次录入一起保存到复习计划；已有待办时请先处理原任务。
                    </p>
                  </div>
                )}
                {draft.status === "APPLIED" && row.reviewTask && (
                  <div className="info-note">
                    <p>
                      本次已安排复测：{row.reviewTask.dueOn} ·{" "}
                      {row.reviewTask.action}
                    </p>
                    <p>原文依据：{row.reviewTask.quote}</p>
                    <Link href="/reviews">查看复习安排与当前任务状态</Link>
                  </div>
                )}
                {!row.pointId ? (
                  <div className="import-form-grid">
                    <label>
                      所属章节
                      <select
                        aria-label={`所属章节 ${index + 1}`}
                        value={row.chapterId || "new"}
                        disabled={!editable || !!busy}
                        onChange={(e) =>
                          updateRow(row.id, {
                            chapterId:
                              e.target.value === "new" ? null : e.target.value,
                          })
                        }
                      >
                        <option value="new">新建章节</option>
                        {draft.context.chapters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!row.chapterId && (
                      <label>
                        新章节名称
                        <input
                          aria-label={`新章节名称 ${index + 1}`}
                          maxLength={100}
                          value={row.chapterName}
                          disabled={!editable || !!busy}
                          onChange={(e) =>
                            updateRow(row.id, { chapterName: e.target.value })
                          }
                        />
                      </label>
                    )}
                    <label>
                      新知识点名称
                      <input
                        aria-label={`新知识点名称 ${index + 1}`}
                        maxLength={100}
                        value={row.name}
                        disabled={!editable || !!busy}
                        onChange={(e) =>
                          updateRow(row.id, { name: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="field-help">
                    保存到：{draft.source.subject.name} / {chapterName} /{" "}
                    {captured?.name}
                  </p>
                )}
                {captured?.aiSummary && editable && (
                  <details className="import-original">
                    <summary>查看此前摘要（已默认保留在下方）</summary>
                    <pre>{captured.aiSummary}</pre>
                  </details>
                )}
                <label>
                  确认后的完整摘要
                  <textarea
                    aria-label={`确认后的完整摘要 ${index + 1}`}
                    rows={4}
                    maxLength={10000}
                    value={row.summary}
                    disabled={!editable || !!busy}
                    onChange={(e) =>
                      updateRow(row.id, { summary: e.target.value })
                    }
                  />
                </label>
              </article>
            );
          })}
          {editable && rows.length > 0 && (
            <>
              <div className="import-session">
                <label>
                  学习日期
                  <input
                    type="date"
                    name="learningDate"
                    value={learningDate}
                    disabled={!!busy}
                    onChange={(e) => {
                      setLearningDate(e.target.value);
                      setCommandId(crypto.randomUUID());
                    }}
                  />
                </label>
                <p className="field-help">
                  原文明确标注的学习日期会自动带入，请核对；无法识别时可补填。用时未统计时，只保存日期与内容也会进入学习总结，不会估算分钟数。
                </p>
                {sourceDateCandidates(draft.source.text).length > 0 && (
                  <div className="notice">
                    <p>
                      原文日期线索：记录日期、对话日期不等于学习日期。跨日内容请按实际归属选择，不能确定可留空。
                    </p>
                    {sourceDateCandidates(draft.source.text).map((x, i) => (
                      <div key={i}>
                        <Button
                          variant="outline"
                          disabled={!!busy}
                          onClick={() => {
                            setLearningDate(x.day);
                            setCommandId(crypto.randomUUID());
                          }}
                        >
                          采用 {x.day} 作为学习日期
                        </Button>
                        <p>
                          {x.kind}：{x.quote}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={withSession}
                    disabled={!!busy}
                    onChange={(e) => {
                      setWithSession(e.target.checked);
                      setCommandId(crypto.randomUUID());
                    }}
                  />
                  同时记录这次实际学习的时间
                </label>
                <p className="field-help">
                  可选。只整理笔记时不必填写；关联多个知识点，用时只计一次。
                </p>
                {withSession && (
                  <div className="import-form-grid">
                    <label>
                      实际开始时间
                      <input
                        type="datetime-local"
                        value={start}
                        disabled={!!busy}
                        onChange={(e) => {
                          setStart(e.target.value);
                          setCommandId(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <label>
                      实际结束时间
                      <input
                        type="datetime-local"
                        value={end}
                        disabled={!!busy}
                        onChange={(e) => {
                          setEnd(e.target.value);
                          setCommandId(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <label>
                      实际学习分钟
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={minutes}
                        disabled={!!busy}
                        onChange={(e) => {
                          setMinutes(e.target.value);
                          setCommandId(crypto.randomUUID());
                        }}
                      />
                    </label>
                    <label>
                      活动类型
                      <select
                        value={activity}
                        disabled={!!busy}
                        onChange={(e) => {
                          setActivity(e.target.value);
                          setCommandId(crypto.randomUUID());
                        }}
                      >
                        <option value="LEARN">学习</option>
                        <option value="REVIEW">复习</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <div className="import-save">
                <p>
                  将保存 {rows.filter((r) => r.selected).length}{" "}
                  项摘要与学习进度，以及{" "}
                  {rows.filter((r) => r.selected && r.level).length}{" "}
                  项等级确认，并创建{" "}
                  {rows.filter((r) => r.selected && r.reviewTask).length}{" "}
                  项待复测任务。等级只记为用户自评，复测结果和任务完成状态需另行记录。
                </p>
                <Button
                  disabled={!!busy || !rows.some((r) => r.selected)}
                  onClick={() => handle("apply")}
                >
                  {busy === "apply" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  确认并保存
                </Button>
              </div>
            </>
          )}
          {levelEdit && (
            <div className="import-save">
              <p>
                将补充 {rows.filter((r) => r.selected && r.level).length}{" "}
                项等级确认。
              </p>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => loadDraft(draft)}
              >
                取消补充
              </Button>
              <Button
                disabled={!!busy || !rows.some((r) => r.selected && r.level)}
                onClick={() => handle("levels")}
              >
                {busy === "levels" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                保存所选等级
              </Button>
            </div>
          )}
          {["READY", "FAILED"].includes(draft.status) && (
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => handle("discard")}
            >
              放弃这份草稿，保留原文
            </Button>
          )}
          {draft.status === "APPLIED" && draft.applied && (
            <div className="import-saved-links">
              {draft.applied.pointIds.map((id, index) => (
                <Link key={id} href={`/knowledge/${id}`}>
                  {rows.filter((r) => r.selected)[index]?.name || "查看知识点"}
                  <ArrowUpRight size={15} />
                </Link>
              ))}
              {draft.applied.sessionId && (
                <Link href={`/sessions/${draft.applied.sessionId}`}>
                  查看学习日志
                  <ArrowUpRight size={15} />
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
