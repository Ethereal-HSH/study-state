"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="empty-state">
      <h1>暂时无法打开这个页面</h1>
      <p>
        请重试。若持续出现，请检查本地服务日志与数据库路径；不要删除数据库。
      </p>
      <Button onClick={reset}>重新加载</Button>
    </section>
  );
}
