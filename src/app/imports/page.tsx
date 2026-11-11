import { readCatalog } from "@/server/catalog";
import { readImport, readImports } from "@/server/imports";
import { codexAccount } from "@/server/ai/codex";
import { ImportWorkspace } from "@/features/imports/import-workspace";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function Imports({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM NOTES TO KNOWLEDGE</span>
          <h1>AI 录入</h1>
          <p>上传学习进度，整理到对应知识点，再确认保存。</p>
        </div>
      </div>
      <ImportWorkspace
        catalog={readCatalog()}
        history={readImports()}
        initialDraft={id ? readImport(id) : null}
        initialAccount={await codexAccount()}
        timeZone={process.env.APP_TIMEZONE || "Asia/Shanghai"}
      />
      <p className="info-note">
        第二轮等跨章节综合学习，请使用 <Link href="/rounds">分轮评估</Link>
        ：保留此前情况，按整体任务追加评估。
      </p>
    </>
  );
}
