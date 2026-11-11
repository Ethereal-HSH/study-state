"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Download,
  Copy,
  Sparkles,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/level-badge";
import { bases, stages, type Catalog } from "@/lib/models";
import { results, resolutions } from "@/lib/learning-models";
import { addDays } from "@/lib/review-policy";
import {
  summaryMarkdown,
  narrativeMarkdown,
  summaryDays,
  summaryRecordTitle,
  summaryCoverage,
  type StudySummary,
  type SummaryFilter,
} from "@/lib/summary-models";

export function SummaryWorkspace({
  catalog,
  initialReport,
}: {
  catalog: Catalog;
  initialReport: StudySummary;
}) {
  const [filter, setFilter] = useState(initialReport.filter);
  const [report, setReport] = useState(initialReport);
  const [draft, setDraft] = useState("");
  const [coverage, setCoverage] = useState<ReturnType<
    typeof summaryCoverage
  > | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(filter) !== JSON.stringify(report.filter);
  const chapters = catalog.chapters.filter(
    (x) => !filter.subjectId || x.subjectId === filter.subjectId,
  );
  const set = (patch: Partial<SummaryFilter>) => {
    setFilter({ ...filter, ...patch });
    setError("");
    setNotice("");
  };
  async function request(input: object) {
    const r = await fetch("/api/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "总结生成失败，请重试");
    return data;
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy("report");
    setError("");
    setNotice("");
    try {
      const next = await request({ action: "report", filter });
      setReport(next);
      setDraft("");
      setCoverage(null);
      setNotice("已生成事实汇总，学习数据未改动。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function summarize() {
    setBusy("ai");
    setError("");
    setNotice("");
    try {
      const value = await request({
        action: "narrative",
        filter: report.filter,
        snapshotToken: report.snapshotToken,
      });
      setDraft(narrativeMarkdown(value, report));
      const check = summaryCoverage(value, report);
      setCoverage(check);
      setNotice(
        check.missing.length
          ? `草稿已生成，但有 ${check.missing.length} 条记录尚未按日期展开，请核对遗漏。`
          : "GPT 总结草稿已生成，已附记录覆盖清单，可核对并编辑后导出。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const output = () => summaryMarkdown(report) + (draft ? "\n\n" + draft : "");
  const draftOutput = () =>
    [
      "# 学习总结草稿",
      "",
      `范围：${report.scope}`,
      `日期：${report.filter.from || "不限起始"} 至 ${report.filter.to || "不限结束"}（${report.timeZone}）`,
      "",
      draft,
    ].join("\n");
  async function copy(onlyDraft = false) {
    try {
      await navigator.clipboard.writeText(onlyDraft ? draftOutput() : output());
      setNotice(
        onlyDraft ? "已复制当前编辑后的草稿。" : "已复制事实汇总与当前草稿。",
      );
    } catch {
      setError("复制失败，请使用导出 Markdown。");
    }
  }
  function download(onlyDraft = false, format: "md" | "txt" = "md") {
    setError("");
    try {
      const content = onlyDraft ? draftOutput() : output();
      const url = URL.createObjectURL(
        new Blob([content], {
          type:
            format === "md"
              ? "text/markdown;charset=utf-8"
              : "text/plain;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      const scope = report.scope
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .slice(0, 80);
      anchor.href = url;
      anchor.download = `${onlyDraft ? "学习总结草稿" : "学习总结"}-${scope}-${report.filter.from || "全部"}-${report.filter.to || report.today}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Keep the blob available until the browser has begun handling the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `已发起${onlyDraft ? "当前草稿" : "完整总结"}的 ${format.toUpperCase()} 导出，请在浏览器下载位置查看。`,
      );
    } catch {
      setError("导出失败，请尝试复制草稿或更换浏览器后重试。");
    }
  }
  const count = report.stats;
  return (
    <div className="summary-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARNING REFLECTION</span>
          <h1>学习总结</h1>
          <p>选择一段时间或一个章节，回看实际记录与尚待确认的部分。</p>
        </div>
        <ClipboardList size={30} />
      </div>
      <form className="card summary-filters" onSubmit={generate}>
        <fieldset disabled={!!busy}>
          <legend>总结范围</legend>
          <div className="summary-presets">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ from: report.today, to: report.today })}
            >
              今天
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({ from: addDays(report.today, -6), to: report.today })
              }
            >
              近 7 天
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({ from: addDays(report.today, -29), to: report.today })
              }
            >
              近 30 天
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ from: null, to: null })}
            >
              全部时间
            </Button>
          </div>
          <div className="summary-filter-grid">
            <label>
              开始日期
              <input
                type="date"
                name="from"
                value={filter.from || ""}
                onChange={(e) => set({ from: e.target.value || null })}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                name="to"
                value={filter.to || ""}
                onChange={(e) => set({ to: e.target.value || null })}
              />
            </label>
            <label>
              科目
              <select
                name="subjectId"
                value={filter.subjectId || ""}
                onChange={(e) =>
                  set({ subjectId: e.target.value || null, chapterId: null })
                }
              >
                <option value="">全部科目</option>
                {catalog.subjects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.archivedAt ? "（归档）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              章节
              <select
                name="chapterId"
                value={filter.chapterId || ""}
                onChange={(e) => set({ chapterId: e.target.value || null })}
              >
                <option value="">全部章节</option>
                {chapters.map((x) => (
                  <option key={x.id} value={x.id}>
                    {catalog.subjects.find((s) => s.id === x.subjectId)?.name} /{" "}
                    {x.name}
                    {x.archivedAt ? "（归档）" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="summary-filter-footer">
            <p className="field-help">
              日期可留空。只选日期、只选章节或组合筛选都可以。
            </p>
            <Button disabled={!!busy}>
              {busy === "report" && <LoaderCircle className="spin" size={16} />}
              生成事实汇总
            </Button>
          </div>
        </fieldset>
      </form>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {dirty && (
        <div className="info-note">
          范围已更改，下面仍为上一次汇总。请点击“生成事实汇总”更新。
        </div>
      )}
      <section className="card summary-report">
        <div className="summary-section-heading">
          <div>
            <h2>{report.scope}</h2>
            <p>
              {report.filter.from || "不限起始"} 至{" "}
              {report.filter.to || "不限结束"} · {report.timeZone}
            </p>
          </div>
          <div className="summary-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dirty || !!busy}
              onClick={() => copy()}
            >
              <Copy size={15} />
              复制总结
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dirty || !!busy}
              onClick={() => download()}
            >
              <Download size={15} />
              导出 Markdown
            </Button>
          </div>
        </div>
        <h3>所选时段的实际记录</h3>
        <div className="summary-stats">
          {[
            [
              "已登记用时",
              count.minutes || (count.unmeasuredRecords ? "未登记" : 0),
              count.minutes || !count.unmeasuredRecords ? "分钟" : "",
            ],
            [
              "学习记录",
              count.sessions + count.importedRecords + count.reviewRecords,
              "条",
            ],
            ["有记录的知识点", count.recordedPoints, "个"],
            ["复测", count.assessments, "次"],
          ].map(([label, value, unit]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>
                {value}
                <small>{unit}</small>
              </strong>
            </div>
          ))}
        </div>
        <p className="summary-result-line">
          复测通过 {count.pass}，部分完成 {count.partial}，未通过 {count.fail}
          ，尚未判定 {count.unassessedTests}；其中明确独立通过{" "}
          {count.independentPass} 次。新增错误 {count.newErrors} 条，完成任务{" "}
          {count.completedTasks} 项，等级或评估状态调整 {count.gradeChanges}{" "}
          次。
        </p>
        {count.reviewRecords > 0 && (
          <p className="info-note">
            含 {count.reviewRecords}{" "}
            条分轮综合评估，按整体任务计数；保留原有笔记与等级，不计作正式独立通过。
          </p>
        )}
        {count.unmeasuredRecords > 0 && (
          <div className="info-note">
            另有 {count.unmeasuredRecords}{" "}
            条已确认的学习内容记录，用时未统计或未登记；已按学习日期纳入内容总结，不视为零分钟学习，也不估算时长。
          </div>
        )}
        {count.sharedSessions > 0 && (
          <div className="info-note">
            包含 {count.sharedSessions}{" "}
            条跨范围日志，展示整条日志用时；无法按章节拆分，不可将各章节用时相加。
          </div>
        )}
        {!count.recordedPoints && (
          <div className="info-note">
            所选时段没有有效活动或等级调整记录。目录中的知识点和摘要不能证明这段时间已经学习或掌握。
          </div>
        )}
        <div className="summary-current">
          <h3>当前状态</h3>
          <p className="field-help">
            截至生成时，包含归档内容；与所选时段的实际记录分别展示。
          </p>
          <p>
            目录 {report.current.points} 个知识点（归档{" "}
            {report.current.archived}）；暂未评估{" "}
            {report.current.distribution.UNASSESSED}，用户自评{" "}
            {report.current.selfReported}，复测证据确认{" "}
            {report.current.evidence}。
          </p>
          <p>
            未开始 {report.current.stages.NOT_STARTED}，学习中{" "}
            {report.current.stages.IN_PROGRESS}，已学过{" "}
            {report.current.stages.COVERED}。当前待处理错误{" "}
            {report.current.openErrors} 条，待办 {report.current.pendingTasks}{" "}
            项，其中逾期 {report.current.overdueTasks} 项。
          </p>
        </div>
        <details open>
          <summary>按学习日期查看整理内容与复测</summary>
          <div className="summary-records">
            {!report.sessions.length &&
              !report.importedRecords.length &&
              !report.reviewRecords.length && <p>本范围暂无有效学习记录。</p>}
            {summaryDays(report).map((day) => (
              <section className="summary-day" key={day || "undated"}>
                <h4>{day || "学习日期未登记"}</h4>
                {report.reviewRecords
                  .filter((x) => x.day === day)
                  .map((x) => (
                    <article key={x.id}>
                      <Link
                        href={`/rounds?roundId=${x.roundId}&draftId=${x.importId}`}
                      >
                        第{x.roundNumber}轮 · {x.title}
                      </Link>
                      <p>{x.content}</p>
                      {x.shared && (
                        <p>
                          跨章节综合任务，保留完整上下文；不将整条表现分摊给各章。
                        </p>
                      )}
                    </article>
                  ))}
                {report.importedRecords
                  .filter((x) => x.day === day)
                  .map((x) => (
                    <article key={x.id}>
                      <Link href={`/imports?id=${x.id}`}>
                        {summaryRecordTitle(x)} · 用时未登记
                      </Link>
                      <p>原文录入，本人确认；不等同于独立复测。</p>
                      <p>{x.content}</p>
                    </article>
                  ))}
                {report.sessions
                  .filter((x) => x.day === day)
                  .map((x) => (
                    <article key={x.id}>
                      <Link href={`/sessions/${x.id}`}>
                        学习日志 · {x.minutes} 分钟 · {x.pointNames.join("、")}
                      </Link>
                      <p>
                        {x.content || "未填写学习内容"}
                        {x.shared ? "（跨范围日志）" : ""}
                      </p>
                    </article>
                  ))}
                {report.assessments
                  .filter((x) => x.day === day)
                  .map((x) => (
                    <article key={x.id}>
                      <Link href={`/knowledge/${x.pointId}`}>
                        复测 · {x.pointName} · {results[x.result]}
                        {x.independentPass
                          ? " · 明确独立通过"
                          : " · 独立通过未确认"}
                      </Link>
                      <p>{x.question}</p>
                    </article>
                  ))}
              </section>
            ))}
            {!report.assessments.length && (
              <p>
                本范围未单独登记结构化复测；原文中的局部作答表现仍保留，不能据此确认整章掌握。
              </p>
            )}
          </div>
        </details>
        <details>
          <summary>当前知识点状态（{report.points.length}）</summary>
          <div className="summary-points">
            {report.points.map((x) => (
              <article key={x.id}>
                <Link href={`/knowledge/${x.id}`}>
                  {x.name}
                  {x.archived ? "（归档）" : ""}
                </Link>
                <span>
                  {x.subject} / {x.chapter}
                </span>
                <LevelBadge
                  level={x.level}
                  unassessed={x.basis === "UNASSESSED"}
                />
                <small>
                  {bases[x.basis]} · {stages[x.stage]}
                </small>
                {x.summary && <p>当前摘要（非本期完成证明）：{x.summary}</p>}
              </article>
            ))}
          </div>
        </details>
        <details>
          <summary>错误与后续待办</summary>
          <div className="summary-records">
            {!report.errors.length && <p>暂无本期新增或当前待处理错误。</p>}
            {report.errors.map((x) => (
              <article key={x.id}>
                <Link href={`/knowledge/${x.pointId}`}>
                  {x.pointName} · 当前{resolutions[x.status]} ·{" "}
                  {x.inPeriod ? "本期记录" : "较早记录"}
                </Link>
                <p>{x.question}</p>
              </article>
            ))}
            {report.tasks
              .filter((x) => x.status === "PENDING")
              .map((x) => (
                <article key={x.id}>
                  <Link href={`/knowledge/${x.pointId}`}>
                    待办 {x.dueOn} · {x.pointName}
                  </Link>
                </article>
              ))}
          </div>
        </details>
        <details>
          <summary>等级与评估状态变化（{report.changes.length}）</summary>
          <div className="summary-records">
            {report.changes.map((x) => (
              <article key={x.id}>
                <Link href={`/knowledge/${x.pointId}`}>
                  {x.day} · {x.pointName}：{x.before} → {x.after}
                </Link>
                <p>{x.reason}</p>
              </article>
            ))}
          </div>
        </details>
      </section>
      <section className="card summary-ai">
        <div className="summary-section-heading">
          <div>
            <h2>GPT 总结草稿</h2>
            <p>
              使用现有 ChatGPT
              账户，只发送上述范围的记录和当前状态。草稿可编辑，不修改等级、错题或任务。
            </p>
          </div>
          <Button
            type="button"
            disabled={dirty || !!busy || !report.current.points}
            onClick={summarize}
          >
            {busy === "ai" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {busy === "ai"
              ? "正在总结…"
              : draft
                ? "重新生成草稿"
                : "用 GPT 总结"}
          </Button>
        </div>
        {draft ? (
          <>
            {coverage && (
              <div className="info-note">
                <p>
                  生成时记录引用覆盖：{coverage.covered}/{coverage.total}。
                  只检查学习记录是否在相应日期下被引用，不保证每个知识点都已充分展开；编辑草稿后请重新核对内容。
                </p>
                {coverage.missing.length > 0 && (
                  <details>
                    <summary>
                      尚未展开的记录（{coverage.missing.length}）
                    </summary>
                    <ul>
                      {coverage.missing.map((x) => (
                        <li key={x.ref}>
                          {x.day || "学习日期未登记"} · {x.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <label>
              可编辑总结草稿
              <textarea
                name="summaryDraft"
                rows={16}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <div className="summary-draft-footer">
              <p className="field-help">
                导出当前编辑后的草稿，并附上范围与日期。需要事实记录和草稿合并版时，可使用上方“导出
                Markdown”。
              </p>
              <div className="summary-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy || !draft.trim()}
                  onClick={() => copy(true)}
                >
                  <Copy size={15} />
                  复制草稿
                </Button>
                <Button
                  type="button"
                  disabled={!!busy || !draft.trim()}
                  onClick={() => download(true)}
                >
                  <Download size={15} />
                  导出草稿 Markdown
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy || !draft.trim()}
                  onClick={() => download(true, "txt")}
                >
                  <Download size={15} />
                  导出草稿 TXT
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="field-help">
            事实汇总无需 AI
            即可查看与导出。点击生成后会使用账户额度，通常需要几十秒。草稿请核对，刷新页面不会保留未导出的编辑。
          </p>
        )}
      </section>
      <details className="summary-notes">
        <summary>统计说明</summary>
        <ul>
          {report.notes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
