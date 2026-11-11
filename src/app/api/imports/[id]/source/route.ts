import { originalAttachment } from "@/server/imports";
import { AppError } from "@/server/catalog";
import { failure } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const file = originalAttachment((await params).id);
    if (!file) throw new AppError(404, "此记录没有图片附件。");
    return new Response(Buffer.from(file.base64, "base64"), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
