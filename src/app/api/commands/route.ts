import { executeCommand } from "@/server/catalog";
import { sameOrigin, readBody, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return Response.json(executeCommand(await readBody(request)));
  } catch (error) {
    return failure(error);
  }
}
