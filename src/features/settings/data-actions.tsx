"use client";
import { useState } from "react";
import { Download, Database, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
export function DataActions() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function backup() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        r.headers
          .get("content-disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || "study-backup.sqlite";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("备份已生成；应用 backups 文件夹也保留了一份。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="data-actions">
        <Button onClick={backup} disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Database size={16} />
          )}{" "}
          {busy ? "正在备份…" : "创建并下载备份"}
        </Button>
        <a className="button button-outline" href="/api/export" download>
          <Download size={16} />
          导出完整 JSON
        </a>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </>
  );
}
