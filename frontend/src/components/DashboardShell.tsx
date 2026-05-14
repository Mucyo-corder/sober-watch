import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, AlertTriangle, FileText, BarChart3, Smartphone, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { CosmicBackground } from "@/components/CosmicBackground";

export type ShellNavId = "dashboard" | "alerts" | "audit" | "reports" | "devices" | "setup";

const navActive =
  "bg-slate-900/[0.06] text-slate-900 shadow-sm ring-1 ring-slate-200/80";
const navIdle = "text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900";

function navClass(active: boolean) {
  return cn(
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300",
    active ? navActive : navIdle
  );
}

function NavItem({
  to,
  hash,
  search,
  icon: Icon,
  label,
  active,
  badge,
}: {
  to: string;
  hash?: string;
  search?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const dest = search
    ? ({ pathname: to, search } as const)
    : hash
      ? ({ pathname: to, hash: hash.replace(/^#/, "") } as const)
      : to;
  return (
    <Link to={dest} className={navClass(active)}>
      <Icon className="h-5 w-5 shrink-0 opacity-85" />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/90 px-1.5 text-[10px] font-semibold text-white shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function NavHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 first:mt-0">
      {children}
    </p>
  );
}

export function DashboardShell({
  activeNav,
  breadcrumbs,
  connected,
  alertCount = 0,
  children,
}: {
  activeNav: ShellNavId;
  breadcrumbs: ReactNode;
  connected: boolean;
  alertCount?: number;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const initials =
    user?.email
      ?.split("@")[0]
      ?.slice(0, 2)
      .toUpperCase() || "AD";

  const alertBadge = alertCount > 0 ? alertCount : undefined;

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background text-slate-900">
      <CosmicBackground />
      <div className="relative z-10 flex h-full min-h-0 w-full flex-row">
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200/70 bg-white/40 px-3 py-6 backdrop-blur-2xl">
          <Link to="/" className="mb-8 flex items-center gap-3 px-2 transition-opacity hover:opacity-90">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 text-sm font-bold text-white shadow-md">
              SW
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold tracking-tight text-slate-900">SoberWatch</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">IoT monitor</p>
            </div>
          </Link>

          <nav className="flex flex-1 flex-col">
            <NavHeading>Overview</NavHeading>
            <NavItem to="/" icon={LayoutGrid} label="Dashboard" active={activeNav === "dashboard"} />
            <NavItem
              to="/"
              search="?section=alerts"
              icon={AlertTriangle}
              label="Alerts"
              active={activeNav === "alerts"}
              badge={alertBadge}
            />
            <NavItem to="/audit" icon={FileText} label="Audit log" active={activeNav === "audit"} />

            <NavHeading>Analysis</NavHeading>
            <NavItem to="/" search="?section=reports" icon={BarChart3} label="Reports" active={activeNav === "reports"} />
            <NavItem to="/" search="?section=devices" icon={Smartphone} label="Devices" active={activeNav === "devices"} />

            <NavHeading>System</NavHeading>
            <NavItem to="/setup" icon={Settings} label="Device setup" active={activeNav === "setup"} />
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200/60 bg-white/45 px-6 backdrop-blur-xl">
            <div className="min-w-0 text-sm text-slate-600">{breadcrumbs}</div>
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "flex items-center gap-2 text-sm font-medium",
                  connected ? "text-emerald-600" : "text-slate-500"
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full transition-shadow duration-500",
                    connected
                      ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]"
                      : "bg-slate-400/60"
                  )}
                />
                {connected ? "Connected" : "Disconnected"}
              </div>
              <div className="h-6 w-px bg-slate-200" aria-hidden />
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-xs font-semibold text-teal-700 shadow-sm"
                title={user?.email ?? "Operator"}
              >
                {initials}
              </div>
            </div>
          </header>

          <main className="relative min-h-0 flex-1 scroll-pt-20 overflow-y-auto overscroll-contain bg-transparent p-6 pb-10 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
