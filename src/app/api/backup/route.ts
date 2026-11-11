import { getStore } from "@/server/db/client";
import { createBackup } from "@/server/backup";
import { sameOrigin, failure } from "@/server/http";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const file = await createBackup(getStore());
    return new Response(await readFile(file), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
