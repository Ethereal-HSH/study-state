import { z } from "zod";
import { AppError } from "@/server/catalog";
import {
  analyzeImport,
  applyImport,
  applyImportLevels,
  discardImport,
  readImports,
  retryImport,
} from "@/server/imports";
import { failure, readBody, sameOrigin } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(readImports(), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readBody(request, 10 * 1024 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError(400, "提交格式无效。");
    const { action, ...input } = body;
    if (action === "analyze") return Response.json(await analyzeImport(input));
    if (action === "apply") return Response.json(applyImport(input));
    if (action === "levels") return Response.json(applyImportLevels(input));
    const parsed = z
      .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new AppError(400, "记录编号或版本无效。");
    if (action === "retry")
      return Response.json(
        await retryImport(parsed.data.id, parsed.data.expectedVersion),
      );
    if (action === "discard")
      return Response.json(
        discardImport(parsed.data.id, parsed.data.expectedVersion),
      );
    throw new AppError(400, "不支持的整理操作。");
  } catch (e) {
    return failure(e);
  }
}
