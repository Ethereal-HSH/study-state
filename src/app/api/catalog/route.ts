import { readCatalog } from "@/server/catalog";
import { failure } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(readCatalog(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
