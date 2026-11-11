import Link from "next/link";
export default function NotFound() {
  return (
    <section className="empty-state">
      <h1>没有找到这条记录</h1>
      <p>它可能不在当前数据库中。</p>
      <Link className="button button-primary" href="/knowledge">
        返回知识树
      </Link>
    </section>
  );
}
