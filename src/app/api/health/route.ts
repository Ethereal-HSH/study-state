export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    app: "study-state",
    version: "0.6.1",
    pid: process.pid,
  });
}
