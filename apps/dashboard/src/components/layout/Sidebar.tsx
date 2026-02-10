"use client";

import { clsx } from "clsx";
import {
  Brain,
  DollarSign,
  GitPullRequest,
  LayoutDashboard,
  MessageSquare,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: MessageSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/github", label: "GitHub", icon: GitPullRequest },
  { href: "/costs", label: "Costs", icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-56 h-screen fixed left-0 top-0 flex flex-col border-r"
      style={{ backgroundColor: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="px-4 py-5 border-b" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Fern Observatory
        </h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          Agent Observability
        </p>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors"
              )}
              style={{
                backgroundColor: isActive ? "var(--bg-hover)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
