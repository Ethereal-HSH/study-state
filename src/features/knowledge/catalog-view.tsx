"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  ChevronRight,
  FolderOpen,
  BookOpen,
  Network,
  MoreHorizontal,
  Archive,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/level-badge";
import { Editor, type EditorTarget } from "./editor";
import { bases, levels, stages, type Catalog } from "@/lib/models";
export function CatalogView({ catalog }: { catalog: Catalog }) {
  const [selection, setSelection] = useState<{
    type: "all" | "subject" | "chapter";
    id?: string;
  }>({ type: "all" });
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState("");
  const subjects = catalog.subjects.filter((x) => archived || !x.archivedAt);
  const chapters = catalog.chapters.filter((x) => archived || !x.archivedAt);
  const points = catalog.points
    .filter(
      (x) =>
        (archived ? !!x.archivedAt : !x.archivedAt) &&
        (selection.type === "all" ||
          (selection.type === "chapter" && x.chapterId === selection.id) ||
          (selection.type === "subject" &&
            chapters.some(
              (c) => c.id === x.chapterId && c.subjectId === selection.id,
            ))),
    )
    .filter(
      (x) =>
        (!level ||
          (level === "UNASSESSED"
            ? x.masteryBasis === "UNASSESSED"
            : x.masteryBasis !== "UNASSESSED" && x.masteryLevel === level)) &&
        (!search ||
          `${x.name} ${x.description || ""}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
  const selected =
    selection.type === "subject"
      ? catalog.subjects.find((x) => x.id === selection.id)
      : selection.type === "chapter"
        ? catalog.chapters.find((x) => x.id === selection.id)
        : null;
  const activeSubjects = catalog.subjects.filter((x) => !x.archivedAt);
  const activeChapters = catalog.chapters.filter((x) => !x.archivedAt);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE MAP</span>
          <h1>知识树</h1>
          <p>把知识放在合适的位置，看清每一步的状态。</p>
        </div>
        <Button
          onClick={() => setEditor({ entity: "subject", action: "create" })}
          variant="outline"
        >
          <Plus size={17} />
          新建科目
        </Button>
      </div>
      {notice && (
        <div role="status" className="notice">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      <div className="knowledge-layout">
        <section className="tree-panel">
          <div className="panel-heading">
            <span>知识目录</span>
            <span>{activeSubjects.length} 科目</span>
          </div>
          <button
            className={`tree-all ${selection.type === "all" ? "selected" : ""}`}
            onClick={() => setSelection({ type: "all" })}
          >
            <Network size={17} />
            全部知识点
            <span>{catalog.points.filter((p) => !p.archivedAt).length}</span>
          </button>
          <div className="tree-groups">
            {subjects.map((subject) => (
              <div className="tree-group" key={subject.id}>
                <button
                  className={`tree-subject ${selection.id === subject.id ? "selected" : ""}`}
                  onClick={() =>
                    setSelection({ type: "subject", id: subject.id })
                  }
                >
                  <BookOpen size={16} />
                  <span>{subject.name}</span>
                  {subject.archivedAt && <Archive size={12} />}
                </button>
                {chapters
                  .filter((c) => c.subjectId === subject.id)
                  .map((chapter) => (
                    <button
                      className={`tree-chapter ${selection.id === chapter.id ? "selected" : ""}`}
                      key={chapter.id}
                      onClick={() =>
                        setSelection({ type: "chapter", id: chapter.id })
                      }
                    >
                      <span className="branch-line" />
                      <FolderOpen size={14} />
                      <span>{chapter.name}</span>
                      <small>
                        {
                          catalog.points.filter(
                            (p) =>
                              p.chapterId === chapter.id &&
                              (archived ? !!p.archivedAt : !p.archivedAt),
                          ).length
                        }
                      </small>
                    </button>
                  ))}
              </div>
            ))}
            {subjects.length === 0 && (
              <p className="tree-hint">
                从一个科目开始，
                <br />
                慢慢建立你的知识地图。
              </p>
            )}
          </div>
          <Button
            className="add-chapter"
            variant="ghost"
            disabled={!activeSubjects.length}
            onClick={() =>
              setEditor({
                entity: "chapter",
                action: "create",
                parentId:
                  selection.type === "subject" && !selected?.archivedAt
                    ? selection.id
                    : activeSubjects[0]?.id,
              })
            }
          >
            <Plus size={15} />
            添加章节
          </Button>
        </section>
        <section className="knowledge-content">
          <div className="content-heading">
            <div>
              <span className="eyebrow">
                {archived ? "ARCHIVED" : "YOUR KNOWLEDGE"}
              </span>
              <h2>
                {selected?.name || "全部知识点"}{" "}
                <span className="count">{points.length}</span>
              </h2>
            </div>
            <div className="actions">
              {selected && !selected.archivedAt && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditor({
                        entity: selection.type as "subject" | "chapter",
                        action: "edit",
                        item: selected,
                      })
                    }
                  >
                    编辑{selection.type === "subject" ? "科目" : "章节"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`归档${selected.name}`}
                    onClick={() =>
                      setEditor({
                        entity: selection.type as "subject" | "chapter",
                        action: "archive",
                        item: selected,
                      })
                    }
                  >
                    <Archive size={16} />
                  </Button>
                </>
              )}
              <Button
                disabled={!activeChapters.length}
                onClick={() =>
                  setEditor({
                    entity: "point",
                    action: "create",
                    parentId:
                      selection.type === "chapter" && !selected?.archivedAt
                        ? selection.id
                        : selection.type === "subject"
                          ? activeChapters.find(
                              (c) => c.subjectId === selection.id,
                            )?.id
                          : activeChapters[0]?.id,
                  })
                }
              >
                <Plus size={16} />
                新建知识点
              </Button>
            </div>
          </div>
          <div className="filters">
            <div className="search-input">
              <Search size={17} />
              <input
                aria-label="搜索知识点"
                placeholder="搜索知识点或说明…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="筛选掌握等级"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">全部等级</option>
              <option value="UNASSESSED">暂未评估</option>
              {Object.entries(levels).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} · {v}
                </option>
              ))}
            </select>
            <label className="archive-toggle">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setSelection({ type: "all" });
                }}
              />
              已归档
            </label>
          </div>
          {points.length ? (
            <div className="table-scroll">
              <table className="knowledge-table">
                <thead>
                  <tr>
                    <th>知识点</th>
                    <th>掌握状态</th>
                    <th>学习进度</th>
                    <th>重要性</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => {
                    const chapter = catalog.chapters.find(
                      (c) => c.id === point.chapterId,
                    );
                    const subject = catalog.subjects.find(
                      (s) => s.id === chapter?.subjectId,
                    );
                    return (
                      <tr key={point.id}>
                        <td>
                          <Link
                            className="point-link"
                            href={`/knowledge/${point.id}`}
                          >
                            {point.name}
                            <ArrowUpRight size={14} />
                          </Link>
                          <small>
                            {subject?.name}
                            <ChevronRight size={10} />
                            {chapter?.name}
                          </small>
                        </td>
                        <td>
                          <LevelBadge
                            level={point.masteryLevel}
                            unassessed={point.masteryBasis === "UNASSESSED"}
                          />
                          <small>{bases[point.masteryBasis]}</small>
                        </td>
                        <td>
                          <span
                            className={`stage stage-${point.learningStage}`}
                          >
                            {point.archivedAt
                              ? "已归档"
                              : stages[point.learningStage]}
                          </span>
                        </td>
                        <td>
                          <span
                            className="importance"
                            aria-label={`重要性 ${point.importance}，满分 5`}
                          >
                            {[1, 2, 3, 4, 5].map((i) => (
                              <i
                                key={i}
                                className={
                                  i <= point.importance ? "filled" : ""
                                }
                              />
                            ))}
                          </span>
                        </td>
                        <td>
                          <Link
                            aria-label={`查看${point.name}`}
                            className="row-open"
                            href={`/knowledge/${point.id}`}
                          >
                            <ChevronRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <Network size={30} />
              </div>
              <h3>
                {search || level
                  ? "没有匹配的知识点"
                  : archived
                    ? "暂无归档记录"
                    : "给学习建立一个起点"}
              </h3>
              <p>
                {search || level
                  ? "试试调整关键词或等级筛选。"
                  : archived
                    ? "归档后的内容会保留在这里。"
                    : !activeSubjects.length
                      ? "先创建一个科目，再按章节添加知识点。"
                      : !activeChapters.length
                        ? "科目已经准备好了，接下来添加第一个章节。"
                        : "从一个具体知识点开始，暂时不确定掌握程度也没关系。"}
              </p>
              {!search && !level && !archived && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditor({
                      entity: !activeSubjects.length
                        ? "subject"
                        : !activeChapters.length
                          ? "chapter"
                          : "point",
                      action: "create",
                      parentId: !activeChapters.length
                        ? activeSubjects[0]?.id
                        : activeChapters[0]?.id,
                    })
                  }
                >
                  <Plus size={16} />
                  {!activeSubjects.length
                    ? "创建第一个科目"
                    : !activeChapters.length
                      ? "添加第一个章节"
                      : "添加第一个知识点"}
                </Button>
              )}
            </div>
          )}
          <div className="table-footer">
            <span>等级描述能力，进度描述学到了哪里。</span>
            <span>A — E</span>
          </div>
        </section>
      </div>
      <div className="level-legend">
        <div>
          <span className="legend-letter level-unassessed">—</span>
          <span>暂未评估</span>
        </div>
        {Object.entries(levels).map(([k, v]) => (
          <div key={k}>
            <span className={`legend-letter level-${k}`}>{k}</span>
            <span>{v}</span>
          </div>
        ))}
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
