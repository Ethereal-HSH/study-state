"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  Network,
  Settings,
  ArrowUpRight,
  Database,
  NotebookPen,
  CircleAlert,
  CalendarDays,
  Sparkles,
  ClipboardList,
} from "lucide-react";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <span>
            知序<small>STUDY STATE</small>
          </span>
        </Link>
        <div className="workspace-label">我的学习空间</div>
        <nav aria-label="主导航">
          {[
            { href: "/", label: "今日概览", icon: LayoutDashboard },
            { href: "/knowledge", label: "知识树", icon: Network },
            { href: "/imports", label: "AI 录入", icon: Sparkles },
            { href: "/rounds", label: "分轮评估", icon: BookOpen },
            { href: "/sessions", label: "学习日志", icon: NotebookPen },
            { href: "/summaries", label: "学习总结", icon: ClipboardList },
            { href: "/reviews", label: "复习安排", icon: CalendarDays },
            { href: "/errors", label: "错误记录", icon: CircleAlert },
            { href: "/settings", label: "数据与设置", icon: Settings },
          ].map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">从理解，到独立完成</span>
          <p>
            让每一次进步，
            <br />
            都有迹可循。
          </p>
          <Link href="/knowledge">
            整理我的知识 <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="local-status">
          <span className="status-dot" />
          本地空间 <Database size={13} />
          <span className="version-label">v0.6.1</span>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>个人学习状态系统</span>
          <span className="topbar-right">
            <span className="status-dot" />
            数据保存在这台电脑
          </span>
        </header>
        <main>{children}</main>
        <footer>
          以能力的变化，记录学习的发生。<span>知序 · 本地版</span>
        </footer>
      </div>
    </div>
  );
}
