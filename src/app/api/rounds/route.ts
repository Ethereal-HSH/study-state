import { z } from "zod";
import { AppError } from "@/server/catalog";
import { failure, readBody, sameOrigin } from "@/server/http";
import {
  createStudyRound,
  analyzeRoundImport,
  applyRoundImport,
  readRoundDraft,
  retryRoundImport,
} from "@/server/study-rounds";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.uuid().safeParse(id).success)
      throw new AppError(400, "记录编号无效");
    return Response.json(readRoundDraft(id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readBody(request, 1024 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError(400, "请求格式无效");
    const { action, ...input } = body;
    if (action === "create") return Response.json(createStudyRound(input));
    if (action === "analyze")
      return Response.json(await analyzeRoundImport(input));
    if (action === "apply") return Response.json(applyRoundImport(input));
    if (action === "retry") {
      const c = z
        .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
        .strict()
        .safeParse(input);
      if (!c.success) throw new AppError(400, "重试请求无效");
      return Response.json(
        await retryRoundImport(c.data.id, c.data.expectedVersion),
      );
    }
    throw new AppError(400, "不支持的轮次操作");
  } catch (error) {
    return failure(error);
  }
}
