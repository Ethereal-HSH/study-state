import { z } from "zod";
import { AppError } from "@/server/catalog";
import { buildSummary, writeSummary } from "@/server/summaries";
import { failure, readBody, sameOrigin } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const parsed = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("report"), filter: z.unknown() }).strict(),
        z
          .object({
            action: z.literal("narrative"),
            filter: z.unknown(),
            snapshotToken: z.string(),
          })
          .strict(),
      ])
      .safeParse(await readBody(request));
    if (!parsed.success) throw new AppError(400, "总结请求格式无效");
    const { action, ...input } = parsed.data;
    const result =
      action === "report"
        ? buildSummary(input.filter)
        : await writeSummary(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
