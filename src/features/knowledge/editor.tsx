"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, LoaderCircle, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  levels,
  stages,
  type Catalog,
  type Subject,
  type Chapter,
  type Point,
} from "@/lib/models";
export type EditorTarget = {
  entity: "subject" | "chapter" | "point";
  action: "create" | "edit" | "archive";
  item?: Subject | Chapter | Point;
  parentId?: string;
};
const labels = { subject: "科目", chapter: "章节", point: "知识点" };
export function Editor({
  target,
  catalog,
  onClose,
  onSuccess,
}: {
  target: EditorTarget;
  catalog: Catalog;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  const [recordId] = useState(() => target.item?.id || crypto.randomUUID());
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="name"], textarea[name="reason"]',
      )
      ?.focus();
    return () => dialog?.close();
  }, []);
  const isPoint = target.entity === "point";
  const isArchive = target.action === "archive";
  const point = target.item as Point | undefined;
  const subjects = catalog.subjects.filter((s) => !s.archivedAt);
  const chapters = catalog.chapters.filter(
    (c) => !c.archivedAt && subjects.some((s) => s.id === c.subjectId),
  );
  const affectedChapters =
    target.entity === "subject"
      ? catalog.chapters.filter(
          (c) => c.subjectId === target.item?.id && !c.archivedAt,
        )
      : catalog.chapters.filter((c) => c.id === target.item?.id);
  const affectedPoints = catalog.points.filter(
    (p) =>
      !p.archivedAt &&
      (target.entity === "point"
        ? p.id === target.item?.id
        : affectedChapters.some((c) => c.id === p.chapterId)),
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const base = {
      commandId,
      id: recordId,
      entity: target.entity,
      action: target.action,
    };
    const payload = isArchive
      ? {
          ...base,
          expectedVersion: target.item!.version,
          reason: data.get("reason"),
        }
      : {
          ...base,
          name: data.get("name"),
          description: data.get("description"),
          importance: isPoint ? Number(data.get("importance")) : 3,
          learningStage: isPoint ? data.get("learningStage") : "NOT_STARTED",
          ...(target.action === "edit"
            ? { expectedVersion: target.item!.version }
            : {
                initialLevel: isPoint ? data.get("initialLevel") : "UNASSESSED",
                ...(target.entity !== "subject"
                  ? { parentId: data.get("parentId") }
                  : {}),
              }),
        };
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.refresh();
      onSuccess?.(result.message);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法保存，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={`${isArchive ? "归档" : target.action === "create" ? "新建" : "编辑"}${labels[target.entity]}`}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">
            {isArchive ? "保留记录，移出当前学习" : "整理你的知识结构"}
          </span>
          <h2>
            {isArchive ? "归档" : target.action === "create" ? "新建" : "编辑"}
            {labels[target.entity]}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭对话框"
          onClick={onClose}
          disabled={busy}
        >
          <X size={19} />
        </Button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          {isArchive ? (
            <>
              <div className="archive-note">
                <Archive size={23} />
                <div>
                  <strong>{target.item?.name}</strong>
                  <p>
                    将归档
                    {target.entity === "subject"
                      ? `此科目及 ${affectedChapters.length} 个章节、${affectedPoints.length} 个知识点`
                      : target.entity === "chapter"
                        ? `此章节及 ${affectedPoints.length} 个知识点`
                        : "此知识点"}
                    。关联的待处理任务会取消，历史仍可查阅。
                  </p>
                </div>
              </div>
              <label>
                归档原因
                <textarea
                  autoFocus
                  name="reason"
                  required
                  maxLength={1000}
                  placeholder="例如：调整备考范围，暂不继续学习"
                  rows={3}
                />
              </label>
            </>
          ) : (
            <>
              {target.action === "create" && target.entity !== "subject" && (
                <label>
                  {isPoint ? "所属章节" : "所属科目"}
                  <select
                    name="parentId"
                    defaultValue={target.parentId || ""}
                    required
                  >
                    <option value="" disabled>
                      请选择{isPoint ? "章节" : "科目"}
                    </option>
                    {isPoint
                      ? chapters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {subjects.find((s) => s.id === c.subjectId)?.name} /{" "}
                            {c.name}
                          </option>
                        ))
                      : subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                  </select>
                </label>
              )}
              <label>
                {labels[target.entity]}名称
                <input
                  autoFocus
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={target.item?.name || ""}
                  placeholder={
                    isPoint
                      ? "例如：洛必达法则"
                      : target.entity === "chapter"
                        ? "例如：极限"
                        : "例如：高等数学"
                  }
                />
              </label>
              <label>
                简短说明 <span className="optional">选填</span>
                <textarea
                  name="description"
                  maxLength={4000}
                  rows={3}
                  defaultValue={target.item?.description || ""}
                  placeholder="说明范围、学习重点，或教材位置"
                />
              </label>
              {isPoint && (
                <>
                  <div className="form-grid">
                    <label>
                      学习进度
                      <select
                        name="learningStage"
                        defaultValue={point?.learningStage || "NOT_STARTED"}
                      >
                        {Object.entries(stages).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      重要性
                      <select
                        name="importance"
                        defaultValue={point?.importance || 3}
                      >
                        {[1, 2, 3, 4, 5].map((x) => (
                          <option key={x} value={x}>
                            {x} ·{" "}
                            {["", "较低", "一般", "中等", "重要", "重点"][x]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {target.action === "create" ? (
                    <label>
                      初始自评
                      <select name="initialLevel" defaultValue="UNASSESSED">
                        <option value="UNASSESSED">暂未评估</option>
                        {Object.entries(levels)
                          .filter(([k]) => k !== "E")
                          .map(([k, v]) => (
                            <option key={k} value={k}>
                              {k} · {v}
                            </option>
                          ))}
                      </select>
                      <span className="field-help">
                        自评会单独标注，不等同于复测证据。E 级需要延迟复测支持。
                      </span>
                    </label>
                  ) : (
                    <p className="field-help">
                      编辑信息不改变掌握等级；可在“调整等级”中选择暂未评估、手动自评或复测确认。
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <div role="alert" className="error-message">
              {error}
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
            variant={isArchive ? "destructive" : "default"}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={16} />}{" "}
            {busy
              ? "正在保存…"
              : isArchive
                ? "确认归档"
                : "保存" + labels[target.entity]}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
