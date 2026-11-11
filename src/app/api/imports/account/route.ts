import { codexAccount } from "@/server/ai/codex";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await codexAccount(), {
    headers: { "Cache-Control": "no-store" },
  });
}
