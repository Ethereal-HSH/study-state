import { AppError } from "./catalog";
export function sameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN || "http://127.0.0.1:4318";
  if (request.headers.get("origin") !== expected)
    throw new AppError(403, "仅允许从本地应用提交");
  if (
    !(request.headers.get("content-type") || "").startsWith("application/json")
  )
    throw new AppError(415, "需要 JSON 格式");
}
export async function readBody(request: Request, limit = 64 * 1024) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError(413, "提交内容过长");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "没有提交内容");
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError(413, "提交内容过长");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "无法读取提交内容");
  }
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  return Response.json(
    { error: "保存或读取失败，请重试；原数据不会被部分覆盖。" },
    { status: 500 },
  );
}
