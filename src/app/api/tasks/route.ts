import { executeTask } from "@/server/tasks";
import { sameOrigin, readBody, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return Response.json(executeTask(await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
