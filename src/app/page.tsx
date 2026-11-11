import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Network,
  ScanLine,
  Plus,
  Compass,
  Clock,
  CalendarDays,
  CircleAlert,
} from "lucide-react";
import { readCatalog } from "@/server/catalog";
import { LevelBadge } from "@/components/level-badge";
import { levels } from "@/lib/models";
import { reviewWorkspaceData } from "@/server/review-data";
import { ReviewWorkspace } from "@/features/reviews/review-workspace";
import { localDay } from "@/lib/dates";
import { addDays } from "@/lib/review-policy";
import { getStore } from "@/server/db/client";
export const dynamic = "force-dynamic";
export default function Home() {
  const catalog = readCatalog();
  const data = reviewWorkspaceData();
  const activeIds = new Set(
    catalog.points.filter((p) => !p.archivedAt).map((p) => p.id),
  );
  const due = data.tasks.filter(
    (t) => t.status === "PENDING" && t.due_on <= data.today && !t.archived_at,
  );
  const minutes = data.sessions
    .filter(
      (s) =>
        !s.voided_at && localDay(s.started_at, data.timeZone) === data.today,
    )
    .reduce((n, s) => n + s.duration_minutes, 0);
  const openErrors = data.errors.filter(
    (e) =>
      !e.voided_at &&
      activeIds.has(e.knowledge_point_id) &&
      e.resolution_status !== "RESOLVED",
  );
  const risks = catalog.points
    .filter((p) => activeIds.has(p.id))
    .map((p) => ({
      point: p,
      errors: openErrors.filter((e) => e.knowledge_point_id === p.id).length,
      failures: data.assessments.filter(
        (a) =>
          a.knowledge_point_id === p.id &&
          !a.voided_at &&
          ["FAIL", "PARTIAL"].includes(a.result) &&
          localDay(a.occurred_at, data.timeZone) >= addDays(data.today, -13),
      ).length,
    }))
    .filter((x) => x.errors || x.failures || x.point.suspectedForgetting)
    .sort(
      (a, b) =>
        b.errors - a.errors ||
        b.failures - a.failures ||
        b.point.importance - a.point.importance,
    )
    .slice(0, 5);
  const changes = (
    getStore()
      .raw.prepare(
        "SELECT e.*,p.name AS point_name FROM knowledge_events e JOIN knowledge_points p ON p.id=e.knowledge_point_id WHERE e.event_type='STATE_CHANGED' AND p.archived_at IS NULL ORDER BY e.sequence DESC",
      )
      .all() as {
      id: string;
      knowledge_point_id: string;
      point_name: string;
      before_json: string | null;
      after_json: string | null;
      reason: string;
    }[]
  )
    .map((e) => ({
      ...e,
      before: e.before_json ? JSON.parse(e.before_json) : {},
      after: e.after_json ? JSON.parse(e.after_json) : {},
    }))
    .filter(
      (e) =>
        e.before.masteryLevel &&
        e.after.masteryLevel &&
        (e.before.masteryLevel !== e.after.masteryLevel ||
          (e.before.masteryBasis === "UNASSESSED") !==
            (e.after.masteryBasis === "UNASSESSED")),
    )
    .slice(0, 5);
  const subjects = catalog.subjects.filter((s) => !s.archivedAt);
  const chapters = catalog.chapters.filter((c) => !c.archivedAt);
  const points = catalog.points.filter((p) => !p.archivedAt);
  const unassessed = points.filter((p) => p.masteryBasis === "UNASSESSED");
  const recent = [...points]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const today = new Intl.DateTimeFormat("zh-CN", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{today}</span>
          <h1>今日概览</h1>
          <p>看清当前的位置，再决定下一步。</p>
        </div>
        <Link className="button button-outline" href="/knowledge">
          <Network size={17} />
          打开知识树
        </Link>
      </div>
      <section className="welcome-card">
        <div>
          <span className="eyebrow">一步一步，建立自己的知识地图</span>
          <h2>
            {points.length
              ? "让每一个“会了”，都有依据。"
              : "先从一个具体的知识点开始。"}
          </h2>
          <p>
            {points.length
              ? `你已整理 ${subjects.length} 个科目、${points.length} 个知识点。${unassessed.length ? `其中 ${unassessed.length} 个暂未评估，暂时不确定也没关系。` : "结合实际复测，逐步确认自己的状态。"}`
              : "把正在学习的内容按科目和章节整理，记录真实的起点，不急着给自己一个分数。"}
          </p>
          <Link href="/knowledge" className="button button-primary">
            {points.length ? "继续整理知识" : "建立我的知识树"}
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="map-illustration" aria-hidden="true">
          <div className="map-core">
            <BookOpen size={23} />
            <span>我的知识</span>
          </div>
          <div className="map-branch branch-one">
            <span className="mini-dot" />
            理解
          </div>
          <div className="map-branch branch-two">
            <span className="mini-dot" />
            独立完成
          </div>
          <div className="map-branch branch-three">
            <span className="mini-dot" />
            迁移应用
          </div>
        </div>
      </section>
      <div className="overview-stats">
        {[
          {
            title: "今日学习",
            value: minutes,
            unit: "分钟",
            icon: Clock,
          },
          {
            title: "到期任务",
            value: due.length,
            unit: "项",
            icon: CalendarDays,
          },
          {
            title: "待复测错误",
            value: openErrors.length,
            unit: "条",
            icon: CircleAlert,
          },
          {
            title: "暂未评估",
            value: unassessed.length,
            unit: "个",
            icon: ScanLine,
          },
        ].map(({ title, value, unit, icon: Icon }) => (
          <section className="card overview-stat" key={title}>
            <span className="stat-label">
              {title}
              <Icon size={17} />
            </span>
            <strong>
              {value}
              <small>{unit}</small>
            </strong>
          </section>
        ))}
      </div>
      <ReviewWorkspace {...data} mode="today" />
      <div className="dashboard-grid dashboard-evidence">
        <section className="card recent-card">
          <div className="section-title between">
            <h2>需要关注的知识点</h2>
            <Link href="/errors">
              查看错误
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {risks.length ? (
            <div className="recent-list">
              {risks.map((x) => (
                <Link href={`/knowledge/${x.point.id}`} key={x.point.id}>
                  <span className="recent-name">
                    <strong>{x.point.name}</strong>
                    <small>
                      未解决错误 {x.errors} 条 · 近 14 天未完全通过 {x.failures}{" "}
                      次{x.point.suspectedForgetting ? " · 疑似遗忘" : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">目前没有已记录的风险证据。</p>
          )}
        </section>
        <section className="card recent-card">
          <div className="section-title">
            <h2>最近等级变化</h2>
          </div>
          {changes.length ? (
            <div className="recent-list">
              {changes.map((e) => (
                <Link href={`/knowledge/${e.knowledge_point_id}`} key={e.id}>
                  <span className="recent-name">
                    <strong>
                      {e.point_name} ·{" "}
                      {e.before.masteryBasis === "UNASSESSED"
                        ? "暂未评估"
                        : e.before.masteryLevel}{" "}
                      →{" "}
                      {e.after.masteryBasis === "UNASSESSED"
                        ? "暂未评估"
                        : e.after.masteryLevel}
                    </strong>
                    <small>{e.reason}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">确认等级变更后，会在这里显示依据。</p>
          )}
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="card recent-card">
          <div className="section-title between">
            <h2>最近整理</h2>
            <Link href="/knowledge">
              查看全部 <ArrowUpRight size={14} />
            </Link>
          </div>
          {recent.length ? (
            <div className="recent-list">
              {recent.map((p) => (
                <Link href={`/knowledge/${p.id}`} key={p.id}>
                  <span className="recent-icon">
                    <BookOpen size={18} />
                  </span>
                  <span className="recent-name">
                    <strong>{p.name}</strong>
                    <small>
                      {chapters.find((c) => c.id === p.chapterId)?.name}
                    </small>
                  </span>
                  <LevelBadge
                    level={p.masteryLevel}
                    unassessed={p.masteryBasis === "UNASSESSED"}
                  />
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <Compass size={32} />
              <h3>你的学习记录，会从这里生长</h3>
              <p>添加知识点后，就能在这里快速回到它的状态与历史。</p>
              <Link href="/knowledge">
                <Plus size={15} />
                添加知识点
              </Link>
            </div>
          )}
        </section>
        <section className="card distribution-card">
          <div className="section-title">
            <h2>掌握状态分布</h2>
          </div>
          <p className="muted">区分初始自评与实际复测证据。</p>
          {Object.entries(levels).map(([key, label]) => {
            const count = points.filter(
              (p) => p.masteryLevel === key && p.masteryBasis !== "UNASSESSED",
            ).length;
            return (
              <div className="distribution-row" key={key}>
                <span className={`legend-letter level-${key}`}>{key}</span>
                <span>{label}</span>
                <div className="bar-track">
                  <span
                    style={{
                      width: `${points.length ? (count / points.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
          <p className="distribution-note">
            暂未评估 {unassessed.length} 个，未计入等级分布。
            <br />
            当前有复测证据的知识点：
            {points.filter((p) => p.masteryBasis === "EVIDENCE").length} 个。
          </p>
        </section>
      </div>
    </>
  );
}
