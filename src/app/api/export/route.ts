import { getStore } from "@/server/db/client";
import { exportData } from "@/server/backup";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(exportData(getStore()), {
    headers: {
      "Content-Disposition": `attachment; filename="study-state-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
