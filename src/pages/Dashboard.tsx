import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Download,
  Printer,
  Trash2,
  History,
  Bell,
  Mail,
  Brain,
  RefreshCw,
  Plus,
  X,
  Send,
  FileText,
  BarChart3,
} from "lucide-react";
import { AlcoholStatus, statusColorClasses, formatAlcoholLevel, formatAlcoholPercentage } from "@/lib/alcohol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { apiUrl } from "@/lib/apiBase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DashboardShell, type ShellNavId } from "@/components/DashboardShell";

interface AlcoholLog {
  id: number;
  device_id: string;
  alcohol_level: number;
  status: AlcoholStatus;
  timestamp: string;
}

interface Baseline {
  device_id: string;
  mean_level: number;
  std_dev: number;
  sample_count: number;
  last_reading: number;
  deviation_threshold: number;
  updated_at: string;
}

interface NotificationSetting {
  id: number;
  device_id: string;
  email: string;
  alert_types: string[];
  enabled: boolean;
  created_at: string;
}

interface StatusBucket {
  SAFE: number;
  WARNING: number;
  DANGER: number;
  total: number;
}

/** Shape used by the report cards (weekly API or monthly data normalized to this). */
interface ReportDashboardData {
  overall: StatusBucket;
  perDevice: Record<string, StatusBucket>;
}

interface MonthlyReportApiResponse {
  year: number;
  perMonth: Record<string, { devices: Record<string, StatusBucket>; overall: StatusBucket }>;
}

function normalizeMonthlyReportForDashboard(data: MonthlyReportApiResponse): ReportDashboardData {
  const overall: StatusBucket = { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 };
  const perDevice: Record<string, StatusBucket> = {};
  for (const monthData of Object.values(data.perMonth)) {
    overall.SAFE += monthData.overall.SAFE;
    overall.WARNING += monthData.overall.WARNING;
    overall.DANGER += monthData.overall.DANGER;
    overall.total += monthData.overall.total;
    for (const [dev, counts] of Object.entries(monthData.devices)) {
      if (!perDevice[dev]) {
        perDevice[dev] = { SAFE: 0, WARNING: 0, DANGER: 0, total: 0 };
      }
      perDevice[dev].SAFE += counts.SAFE;
      perDevice[dev].WARNING += counts.WARNING;
      perDevice[dev].DANGER += counts.DANGER;
      perDevice[dev].total += counts.total;
    }
  }
  return { overall, perDevice };
}

interface AlcoholAlertRow {
  id: number;
  device_id: string;
  alcohol_level: number;
  status: AlcoholStatus;
  acknowledged?: boolean;
  created_at: string;
  archived_at?: string;
}

/** Normalize API rows so id/enabled/alert_types work with React state and PATCH/DELETE. */
function normalizeNotificationRow(raw: NotificationSetting): NotificationSetting {
  const id = Number(raw.id);
  const types = Array.isArray(raw.alert_types) ? raw.alert_types : ["WARNING", "DANGER"];
  return {
    ...raw,
    id: Number.isFinite(id) ? id : 0,
    alert_types: types,
    enabled: raw.enabled !== false,
  };
}

function parseApiErrorText(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { detail?: string; error?: string };
    return j.detail || j.error || text || `HTTP ${status}`;
  } catch {
    return text || `HTTP ${status}`;
  }
}

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const section = useMemo(() => {
    const s = searchParams.get("section");
    if (s === "reports" || s === "alerts" || s === "devices") return s;
    return "home";
  }, [searchParams]);

  const [logs, setLogs] = useState<AlcoholLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const [highAlertId, setHighAlertId] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<AlcoholAlertRow[]>([]);
  const [historyAlerts, setHistoryAlerts] = useState<AlcoholAlertRow[]>([]);
  const [alertView, setAlertView] = useState<"active" | "history">("active");

  // Report state
  const [reportPeriod, setReportPeriod] = useState<"weekly" | "monthly">("weekly");
  const [reportYear, setReportYear] = useState<number>(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState<number>(new Date().getMonth() + 1);
  const [reportDevice, setReportDevice] = useState<string>("all");
  const [reportData, setReportData] = useState<ReportDashboardData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Filters
  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTriggered, setSearchTriggered] = useState<number>(0);

  // Report state setters inside component to avoid hook issues
  // Already defined above

  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);

  // Email alert settings
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailDevice, setNewEmailDevice] = useState("all");
  const [newEmailTypes, setNewEmailTypes] = useState<string[]>(["WARNING", "DANGER"]);
  const [trendChartKind, setTrendChartKind] = useState<"line" | "bar">("line");

  /** Background poll passes `false` so the button / spinner are not stuck loading. */
  const fetchReport = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadingReport(true);
    try {
      const params = new URLSearchParams();
      params.append("year", String(reportYear));
      if (reportPeriod === "weekly") {
        params.append("month", String(reportMonth));
      }
      if (reportDevice !== "all") {
        params.append("device", reportDevice);
      }
      const res = await fetch(apiUrl(`/api/reports/${reportPeriod}?${params.toString()}`));
      if (res.ok) {
        const raw = (await res.json()) as ReportDashboardData | MonthlyReportApiResponse;
        if (reportPeriod === "weekly") {
          setReportData(raw as ReportDashboardData);
        } else {
          setReportData(normalizeMonthlyReportForDashboard(raw as MonthlyReportApiResponse));
        }
      }
    } catch {
      /* ignore */
    } finally {
      if (showLoading) setLoadingReport(false);
    }
  }, [reportYear, reportMonth, reportPeriod, reportDevice]);

  useEffect(() => {
    let mounted = true;
    const fetchLogs = async () => {
      try {
        const response = await fetch(apiUrl("/api/logs"));
        if (!response.ok) throw new Error("Failed to fetch");
        const data = (await response.json()) as AlcoholLog[];
        if (!mounted) return;
        setLogs((prev) => {
          if (prev.length > 0 && data.length > 0 && prev[0].id !== data[0].id) {
            const row = data[0];
            if (row.status === "DANGER") {
              setHighAlertId(row.id);
              toast.error(
                `DANGER alcohol detected on ${row.device_id} — ${formatAlcoholLevel(row.alcohol_level)} (${formatAlcoholPercentage(row.alcohol_level)})`,
                { duration: 2000 }
              );
              // Auto-send gas alert email
              const gasValue = Math.round(Number(row.alcohol_level) * 10000);
              fetch(apiUrl("/api/alert"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gasValue }),
              }).catch(() => {});
            } else if (row.status === "WARNING") {
              toast.warning(
                `Warning level on ${row.device_id} — ${formatAlcoholLevel(row.alcohol_level)} (${formatAlcoholPercentage(row.alcohol_level)})`,
                { duration: 2000 }
              );
            }
          }
          return data.length > 0 ? data.slice(0, 500) : prev;
        });
        setRealtimeOn(true);
      } catch {
        if (mounted) {
          setRealtimeOn(false);
        }
      } finally {
        if (mounted) setLoadingLogs(false);
      }
    };


    const fetchAlerts = async () => {
      try {
        const [activeRes, historyRes] = await Promise.all([
          fetch(apiUrl("/api/alerts")),
          fetch(apiUrl("/api/alerts/history")),
        ]);
        if (activeRes.ok) setAlerts((await activeRes.json()) as AlcoholAlertRow[]);
        if (historyRes.ok) setHistoryAlerts((await historyRes.json()) as AlcoholAlertRow[]);
      } catch {
        /* ignore */
      }
    };

    const fetchBaselines = async () => {
      try {
        const res = await fetch(apiUrl("/api/baselines"));
        if (res.ok) setBaselines(await res.json());
      } catch {
        /* ignore */
      }
    };

     const fetchNotifications = async () => {
       try {
         const [notifRes, statusRes] = await Promise.all([
           fetch(apiUrl("/api/notifications")),
           fetch(apiUrl("/api/notifications/status")),
         ]);
         if (notifRes.ok) {
           const rows = (await notifRes.json()) as NotificationSetting[];
           setNotifications(rows.map(normalizeNotificationRow));
         }
         if (statusRes.ok) {
           const data = await statusRes.json();
           setEmailConfigured(data.configured);
         }
       } catch {
         /* ignore */
       }
     };

     fetchLogs();
     fetchAlerts();
     fetchBaselines();
     fetchNotifications();
     fetchReport();
     const intervalId = window.setInterval(() => {
       fetchLogs();
       fetchAlerts();
       fetchBaselines();
       fetchNotifications();
       fetchReport();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [fetchReport]);

  const shellNav: ShellNavId = useMemo(() => {
    if (section === "alerts") return "alerts";
    if (section === "reports") return "reports";
    if (section === "devices") return "devices";
    return "dashboard";
  }, [section]);

  const crumbLabel =
    section === "reports" ? "Reports" : section === "alerts" ? "Alerts" : section === "devices" ? "Devices" : "Dashboard";

  const devices = useMemo(
    () => Array.from(new Set(logs.map((l) => l.device_id))).sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (deviceFilter !== "all" && l.device_id !== deviceFilter) return false;
      const logDate = new Date(l.timestamp);
      const logDateStr = format(logDate, 'yyyy-MM-dd');
      
      if (dateFrom && logDateStr < dateFrom) return false;
      if (dateTo && logDateStr > dateTo) return false;
      return true;
    });
  }, [logs, deviceFilter, dateFrom, dateTo, searchTriggered]);

  const latest = filtered[0];

  const stats = useMemo(() => {
    const total = filtered.length;
    const danger = filtered.filter((l) => l.status === "DANGER").length;
    const warn = filtered.filter((l) => l.status === "WARNING").length;
    const safe = filtered.filter((l) => l.status === "SAFE").length;
    return { total, high: danger, warn, safe };
  }, [filtered]);

  const chartData = useMemo(() => {
    return [...filtered]
      .slice(0, 60)
      .reverse()
      .map((l) => ({
        time: format(new Date(l.timestamp), "HH:mm:ss"),
        level: Number(l.alcohol_level),
        bacPct: Number(l.alcohol_level) * 100,
        device: l.device_id,
      }));
  }, [filtered]);

  const deviceIncidentData = useMemo(() => {
    const incidents = devices.map((device) => {
      const deviceLogs = filtered.filter((l) => l.device_id === device);
      return {
        device,
        high: deviceLogs.filter((l) => l.status === "DANGER").length,
        warning: deviceLogs.filter((l) => l.status === "WARNING").length,
        total: deviceLogs.length,
      };
    });
    return incidents;
  }, [filtered, devices]);

  function exportCSV() {
    const header = ["timestamp", "device_id", "alcohol_level", "status"];
    const rows = filtered.map((l) => [
      l.timestamp,
      l.device_id,
      l.alcohol_level,
      l.status,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alcohol-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteLog(id: number) {
    if (!confirm("Are you sure you want to delete this log?")) return;
    try {
      const response = await fetch(apiUrl(`/api/logs/${id}`), { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete log");
      setLogs((prev) => prev.filter((l) => l.id !== id));
      toast.success("Log deleted");
    } catch (err) {
      toast.error("Failed to delete log");
    }
  }

  async function handleDeleteAll() {
    if (!confirm("Are you sure you want to delete ALL logs? This cannot be undone.")) return;
    try {
      const response = await fetch(apiUrl("/api/logs"), { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to clear logs");
      setLogs([]);
      toast.success("All logs deleted");
    } catch (err) {
      toast.error("Failed to clear logs");
    }
  }

  const authHeaders = () => ({
    "Content-Type": "application/json",
  });

  async function handleAddNotification() {
    if (!newEmail.trim()) {
      toast.error("Email address is required");
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/notifications"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ device_id: newEmailDevice, email: newEmail.trim(), alert_types: newEmailTypes }),
      });
      const text = await res.text();
      if (!res.ok) {
        toast.error(parseApiErrorText(text, res.status));
        return;
      }
      const setting = normalizeNotificationRow(JSON.parse(text) as NotificationSetting);
      setNotifications((prev) => [...prev, setting]);
      setNewEmail("");
      setNewEmailDevice("all");
      setNewEmailTypes(["WARNING", "DANGER"]);
      toast.success("Email alert added");
    } catch {
      toast.error("Failed to add email alert");
    }
  }

  async function handleDeleteNotification(id: number) {
    try {
      const res = await fetch(apiUrl(`/api/notifications/${id}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
      const text = await res.text();
      if (!res.ok) {
        toast.error(parseApiErrorText(text, res.status));
        return;
      }
      setNotifications((prev) => prev.filter((n) => Number(n.id) !== Number(id)));
      toast.success("Email alert removed");
    } catch {
      toast.error("Failed to remove email alert");
    }
  }

  async function handleToggleNotification(id: number, enabled: boolean) {
    try {
      const res = await fetch(apiUrl(`/api/notifications/${id}`), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
      });
      const text = await res.text();
      if (!res.ok) {
        toast.error(parseApiErrorText(text, res.status));
        return;
      }
      const updated = normalizeNotificationRow(JSON.parse(text) as NotificationSetting);
      setNotifications((prev) => prev.map((n) => (Number(n.id) === Number(id) ? updated : n)));
    } catch {
      toast.error("Failed to update notification");
    }
  }

  async function handleTestEmail() {
    try {
      const res = await fetch(apiUrl("/api/alert/test"));
      if (!res.ok) throw new Error("Failed to send test email");
      const data = await res.json();
      toast.success(`Test email sent to ${data.recipient || "configured email"}`);
    } catch {
      toast.error("Failed to send test email — check SMTP config");
    }
  }

  async function handleRecalculateBaselines() {
    try {
      const res = await fetch(apiUrl("/api/baselines/recalculate"), {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to recalculate baselines");
      const data = await res.json();
      setBaselines(data.baselines);
      toast.success(`Baselines recalculated for ${data.baselines.length} device(s)`);
    } catch {
      toast.error("Failed to recalculate baselines");
    }
  }

  // Generate PDF report for latest HIGH alert
  async function generatePDF(latestLog: AlcoholLog) {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = 20;

      // Header
      doc.setFontSize(22);
      doc.setTextColor(239, 68, 68); // red-600
      doc.text("⚠️ HIGH ALCOHOL DETECTED", margin, y);
      y += 12;

      doc.setFontSize(12);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Alcohol Monitoring System — Alert Report generated ${format(new Date(), "PPpp")}`, margin, y);
      y += 20;

      // Alert Details Box
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(239, 68, 68);
      doc.setLineWidth(0.5);
      doc.rect(margin, y - 5, contentWidth, 35, "FD");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text("Device ID:", margin + 5, y);
      doc.setFont("helvetica", "bold");
      doc.text(latestLog.device_id, margin + 40, y);
      doc.setFont("helvetica", "normal");
      y += 8;
      doc.text("Alcohol Level:", margin + 5, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(239, 68, 68);
      doc.text(`${Number(latestLog.alcohol_level).toFixed(3)} mg/L BAC`, margin + 40, y);
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "normal");
      y += 8;
      doc.text("Status:", margin + 5, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(239, 68, 68);
      doc.text("HIGH", margin + 40, y);
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "normal");
      y += 8;
      doc.text("Timestamp:", margin + 5, y);
      doc.setFont("helvetica", "bold");
      doc.text(format(new Date(latestLog.timestamp), "PPpp"), margin + 40, y);
      y += 12;

      // Legal limit reference line
      doc.setDrawColor(245, 158, 11); // yellow-500
      doc.setLineWidth(0.5);
      doc.line(margin, y + 2, pageWidth - margin, y + 2);
      doc.setFontSize(10);
      doc.setTextColor(245, 158, 11);
      doc.text("Legal limit: 0.080 mg/L BAC (US standard)", margin, y + 8);
      y += 20;

      // Footer
      y += 20;
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(`Report ID: ${latestLog.id}-${Date.now()} | SoberWatch IoT System`, margin, y);
      doc.text("This report is automatically generated and is valid only when presented with a matching database record.", margin, y + 6);

      // Save PDF
      const filename = `soberwatch-report-${latestLog.id}-${format(new Date(latestLog.timestamp), "yyyy-MM-dd")}.pdf`;
      doc.save(filename);
      toast.success("PDF report downloaded");
    } catch (err) {
      console.error("PDF generation error:", err);
      toast.error("Failed to generate PDF");
    }
  }

  const trendReadingsCount = chartData.length;
  const primaryStroke = "#38bdf8";
  const chartAccent2 = "#a78bfa";
  const gaugeTrack = "rgba(15, 23, 42, 0.08)";
  const latestBacPct = latest ? Math.min(Math.max(Number(latest.alcohol_level) * 100, 0), 100) : 0;
  const latestGaugeRest = Math.max(0, 100 - latestBacPct);
  const latestArcColor =
    latest?.status === "DANGER" ? "#f87171" : latest?.status === "WARNING" ? "#fb923c" : "#4ade80";
  const tooltipGlass: CSSProperties = {
    background: "rgba(255, 255, 255, 0.92)",
    border: "1px solid rgba(148,163,184,0.35)",
    borderRadius: 12,
    fontSize: 12,
    backdropFilter: "blur(12px)",
    boxShadow: "0 12px 40px -8px rgba(15, 23, 42, 0.12)",
  };

  return (
    <DashboardShell
      activeNav={shellNav}
      connected={realtimeOn}
      alertCount={alerts.length}
      breadcrumbs={
        <>
          <span className="font-medium text-foreground">SoberWatch</span>
          <span className="mx-2 opacity-50">/</span>
          <span>{crumbLabel}</span>
        </>
      }
    >
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
          {section === "home" && (
            <>
        <div>
          <h1 className="bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 bg-clip-text text-2xl font-semibold tracking-tight text-transparent md:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time alcohol monitoring · {stats.total} {stats.total === 1 ? "reading" : "readings"}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="luxury-kpi-shell">
            <div className="h-1 bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.35)]" />
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{stats.total}</p>
              <p className="mt-2 text-xs text-muted-foreground">Updated live</p>
            </div>
          </div>
          <div className="luxury-kpi-shell">
            <div className="h-1 bg-gradient-to-r from-sky-400 to-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.35)]" />
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Safe</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-emerald-600">{stats.safe}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {stats.total > 0 ? ((stats.safe / stats.total) * 100).toFixed(0) : "0"}% of total
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_12px_rgba(52,211,153,0.4)] transition-all"
                  style={{ width: `${stats.total ? (stats.safe / stats.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="luxury-kpi-shell">
            <div className="h-1 bg-gradient-to-r from-violet-500 to-fuchsia-400 shadow-[0_0_20px_rgba(167,139,250,0.35)]" />
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Warnings</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-amber-600">{stats.warn}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {stats.total > 0 ? ((stats.warn / stats.total) * 100).toFixed(0) : "0"}% of total
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400 transition-all"
                  style={{ width: `${stats.total ? (stats.warn / stats.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="luxury-kpi-shell">
            <div className="h-1 bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_20px_rgba(248,113,113,0.35)]" />
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Danger</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-destructive">{stats.high}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {stats.total > 0 ? ((stats.high / stats.total) * 100).toFixed(0) : "0"}% of total
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-destructive transition-all"
                  style={{ width: `${stats.total ? (stats.high / stats.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="luxury-glass-panel">
            <h2 className="text-base font-semibold text-foreground">Latest reading</h2>
            {latest ? (
              <>
                <div className="relative mx-auto mt-4 h-[220px] w-full max-w-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        <filter id="arcGlow" x="-40%" y="-40%" width="180%" height="180%">
                          <feGaussianBlur stdDeviation="3" result="b" />
                          <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <Pie
                        data={[
                          { name: "level", value: latestBacPct },
                          { name: "rest", value: latestGaugeRest },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={96}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="none"
                      >
                        <Cell fill={latestArcColor} filter="url(#arcGlow)" />
                        <Cell fill={gaugeTrack} />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2">
                    <span className="text-3xl font-semibold tabular-nums text-foreground">
                      {(Number(latest.alcohol_level) * 100).toFixed(1)}%
                    </span>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">BAC</span>
                    <span className="mt-1 text-[10px] text-muted-foreground">{latest.device_id}</span>
                  </div>
                </div>
                <div className="mt-4 flex justify-center">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                      latest.status === "DANGER"
                        ? "bg-red-100 text-red-800"
                        : latest.status === "WARNING"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {latest.status}
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-8 text-center text-sm text-muted-foreground">No readings yet</p>
            )}
          </div>

          <div className="luxury-glass-panel">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Alcohol level trend</h2>
                <p className="text-sm text-muted-foreground">
                  Last {trendReadingsCount} readings · BAC %
                </p>
              </div>
              <div className="inline-flex shrink-0 rounded-xl border border-slate-200/80 bg-slate-900/[0.035] p-0.5">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-300 ${
                    trendChartKind === "line"
                      ? "bg-white text-slate-900 shadow-md"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setTrendChartKind("line")}
                >
                  Line
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-300 ${
                    trendChartKind === "bar"
                      ? "bg-white text-slate-900 shadow-md"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setTrendChartKind("bar")}
                >
                  Bar
                </button>
              </div>
            </div>
            <div className="mt-4 h-64">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No data to chart yet.
                </div>
              ) : trendChartKind === "line" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bacFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={primaryStroke} stopOpacity={0.38} />
                        <stop offset="45%" stopColor={chartAccent2} stopOpacity={0.14} />
                        <stop offset="100%" stopColor={primaryStroke} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted-foreground/15" vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[0, "auto"]} />
                    <Tooltip contentStyle={tooltipGlass} formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "BAC"]} />
                    <ReferenceLine y={2} stroke="#fb923c" strokeDasharray="4 4" strokeOpacity={0.85} />
                    <ReferenceLine y={5} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.85} />
                    <Area
                      type="monotone"
                      dataKey="bacPct"
                      stroke={primaryStroke}
                      strokeWidth={2.5}
                      fill="url(#bacFill)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: "#fbbf24", filter: "drop-shadow(0 0 6px rgba(251,191,36,0.8))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bacBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted-foreground/15" vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[0, "auto"]} />
                    <Tooltip contentStyle={tooltipGlass} formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "BAC"]} />
                    <ReferenceLine y={2} stroke="#fb923c" strokeDasharray="4 4" strokeOpacity={0.85} />
                    <ReferenceLine y={5} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.85} />
                    <Bar dataKey="bacPct" fill="url(#bacBar)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

            {latest && latest.status === "DANGER" && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 shadow-sm">
                  <div className="mb-5 flex items-start gap-4">
                    <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-background text-destructive">
                      <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="mb-2 text-lg font-semibold tracking-tight text-destructive">Danger: alcohol threshold exceeded</h3>
                      <p className="text-sm text-foreground/90">
                        Device <strong>{latest.device_id}</strong> reported a level of{" "}
                        <strong>{formatAlcoholLevel(latest.alcohol_level)}</strong> ({formatAlcoholPercentage(latest.alcohol_level)}) at{" "}
                        {format(new Date(latest.timestamp), "PPpp")}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 rounded-lg border border-border bg-background p-5">
                    <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted text-destructive">
                        <FileText className="h-3.5 w-3.5" />
                      </div>
                      Alert details
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4 md:gap-4">
                      <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Device ID</div>
                        <div className="mt-1 font-semibold text-foreground">{latest.device_id}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Alcohol level</div>
                        <div className="mt-1 font-semibold text-destructive">{formatAlcoholLevel(latest.alcohol_level)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Concentration</div>
                        <div className="mt-1 font-semibold text-destructive">{formatAlcoholPercentage(latest.alcohol_level)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timestamp</div>
                        <div className="mt-1 font-semibold text-foreground">{format(new Date(latest.timestamp), "HH:mm:ss")}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setHighAlertId(null)}>
                      Acknowledge
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => generatePDF(latest)}>
                      <Printer className="mr-2 h-4 w-4" /> Export PDF
                    </Button>
                  </div>
                </div>
              </div>
            )}

            </>
          )}

          {section === "reports" && (
          <div className="luxury-glass-panel">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Reports</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Weekly and monthly monitoring summaries</p>
                </div>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
                <Button
                  variant={reportPeriod === "weekly" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-md shadow-none"
                  onClick={() => setReportPeriod("weekly")}
                >
                  Weekly
                </Button>
                <Button
                  variant={reportPeriod === "monthly" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-md shadow-none"
                  onClick={() => setReportPeriod("monthly")}
                >
                  Monthly
                </Button>
              </div>
            </div>

{/* Report Controls */}
            <div className="mb-6 flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[150px]">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Year</label>
                <div className="relative">
                  <Input
                    type="number"
                    value={reportYear}
                    onChange={(e) => setReportYear(Number(e.target.value))}
                    min={2020}
                    max={2100}
                    className="w-full bg-background"
                  />
                </div>
              </div>
              {reportPeriod === "weekly" && (
                <div className="flex-1 min-w-[150px]">
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Month</label>
                  <Select value={String(reportMonth)} onValueChange={(v) => setReportMonth(Number(v))}>
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {new Date(2026, m - 1).toLocaleString("default", { month: "long" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex-1 min-w-[150px]">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Device</label>
                <Select value={reportDevice} onValueChange={setReportDevice}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All devices</SelectItem>
                    {devices.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
             <Button size="sm" onClick={() => void fetchReport(true)} disabled={loadingReport}>
               {loadingReport ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Generate report"}
             </Button>
            </div>

{/* Report Results */}
            {reportData && (
              <div className="space-y-6">
                {/* Overall Summary */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="luxury-glass-panel border-l-4 border-l-emerald-500 !p-5">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Safe readings</div>
                    <div className="text-3xl font-semibold tabular-nums text-emerald-700">{reportData.overall.SAFE}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {reportData.overall.total > 0
                        ? ((reportData.overall.SAFE / reportData.overall.total) * 100).toFixed(1)
                        : "0"}% of total
                    </div>
                  </div>
                  <div className="luxury-glass-panel border-l-4 border-l-amber-500 !p-5">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Warning</div>
                    <div className="text-3xl font-semibold tabular-nums text-amber-700">{reportData.overall.WARNING}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {reportData.overall.total > 0
                        ? ((reportData.overall.WARNING / reportData.overall.total) * 100).toFixed(1)
                        : "0"}% of total
                    </div>
                  </div>
                  <div className="luxury-glass-panel border-l-4 border-l-destructive !p-5">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Danger</div>
                    <div className="text-3xl font-semibold tabular-nums text-destructive">{reportData.overall.DANGER}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {reportData.overall.total > 0
                        ? ((reportData.overall.DANGER / reportData.overall.total) * 100).toFixed(1)
                        : "0"}% of total
                    </div>
                  </div>
                  <div className="luxury-glass-panel border-l-4 border-l-slate-300 !p-5">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Total readings</div>
                    <div className="text-3xl font-semibold tabular-nums text-foreground">{reportData.overall.total}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Selected period</div>
                  </div>
                </div>

               {/* Per-Device Breakdown */}
               {Object.entries(reportData.perDevice).length > 0 && (
                 <div>
                   <h3 className="mb-3 text-sm font-semibold text-foreground">Per-device breakdown</h3>
                   <div className="overflow-x-auto rounded-lg border">
                     <table className="w-full text-sm">
                       <thead>
                         <tr className="border-b bg-muted/50">
                           <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Device</th>
                           <th className="px-3 py-2.5 text-right font-medium text-emerald-700">Safe</th>
                           <th className="px-3 py-2.5 text-right font-medium text-amber-700">Warning</th>
                           <th className="px-3 py-2.5 text-right font-medium text-destructive">Danger</th>
                           <th className="px-3 py-2.5 text-right font-medium text-foreground">Total</th>
                         </tr>
                       </thead>
                       <tbody>
                         {Object.entries(reportData.perDevice).map(([device, stats]) => (
                           <tr key={device} className="border-b border-border last:border-0 hover:bg-muted/30">
                             <td className="px-3 py-2.5 font-medium text-foreground">{device}</td>
                             <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{stats.SAFE}</td>
                             <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{stats.WARNING}</td>
                             <td className="px-3 py-2.5 text-right tabular-nums text-destructive">{stats.DANGER}</td>
                             <td className="px-3 py-2.5 text-right font-medium tabular-nums text-muted-foreground">{stats.total}</td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>
               )}
             </div>
           )}

           {loadingReport && (
             <div className="py-8 text-center text-muted-foreground">
               <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
               <p className="text-sm">Generating report…</p>
             </div>
           )}

           {!loadingReport && reportData && Object.keys(reportData.perDevice).length === 0 && (
             <div className="py-8 text-center text-muted-foreground">
               <BarChart3 className="mx-auto mb-2 h-8 w-8 opacity-40" />
               <p className="text-sm">No log data for the selected period</p>
             </div>
           )}
         </div>
          )}

          {section === "devices" && (
            <>
{/* Alert History Search */}
          <div className="luxury-glass-panel">
           <div className="mb-5">
             <div className="flex items-start gap-3">
               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                 <Activity className="h-5 w-5" />
               </div>
               <div>
                 <h2 className="text-lg font-semibold tracking-tight text-foreground">Search logs by date</h2>
                 <p className="mt-1 text-sm text-muted-foreground">Filter the table and charts by date range and device</p>
               </div>
             </div>
           </div>
           <div className="flex flex-wrap items-end gap-4">
             <div className="min-w-[180px] flex-1">
               <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">From date</label>
               <Input
                 type="date"
                 value={dateFrom}
                 onChange={(e) => setDateFrom(e.target.value)}
                 className="w-full bg-background"
               />
             </div>
             <div className="min-w-[180px] flex-1">
               <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">To date</label>
               <Input
                 type="date"
                 value={dateTo}
                 onChange={(e) => setDateTo(e.target.value)}
                 className="w-full bg-background"
               />
             </div>
             <div className="min-w-[180px] flex-1">
               <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Device</label>
               <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                 <SelectTrigger className="w-full bg-background">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">All devices</SelectItem>
                   {devices.map((d) => (
                     <SelectItem key={d} value={d}>
                       {d}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
             <Button size="sm" onClick={() => setSearchTriggered((prev) => prev + 1)}>
               Search
             </Button>
             {(deviceFilter !== "all" || dateFrom || dateTo) && (
               <Button
                 variant="outline"
                 size="sm"
                 onClick={() => {
                   setDeviceFilter("all");
                   setDateFrom("");
                   setDateTo("");
                   setSearchTriggered((prev) => prev + 1);
                 }}
               >
                 Clear filters
               </Button>
             )}
           </div>
         </div>

{/* Baseline Auto-Learning & Email Alerts — side by side */}
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           {/* Baseline Auto-Learning */}
           <div className="luxury-glass-panel">
             <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
               <div className="flex items-start gap-3">
                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                   <Brain className="h-5 w-5" />
                 </div>
                 <div>
                   <h2 className="text-lg font-semibold tracking-tight text-foreground">Baseline auto-learning</h2>
                   <p className="mt-0.5 text-sm text-muted-foreground">Per-device normal level profiles</p>
                 </div>
               </div>
               <Button variant="outline" size="sm" onClick={handleRecalculateBaselines}>
                 <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Recalculate
               </Button>
             </div>

{baselines.length === 0 ? (
               <div className="py-10 text-center text-muted-foreground">
                 <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-muted/50">
                   <Brain className="h-7 w-7 opacity-50" />
                 </div>
                 <p className="text-sm font-medium text-foreground">No baseline data yet</p>
                 <p className="mt-1 text-xs">Baselines build automatically as readings arrive</p>
               </div>
             ) : (
               <div className="space-y-3">
                 {baselines.map((b) => {
                   const mean = Number(b.mean_level);
                   const stdDev = Number(b.std_dev);
                   const samples = Number(b.sample_count);
                   const threshold = Number(b.deviation_threshold);
                   const lastReading = Number(b.last_reading);
                   const deviation = stdDev > 0 ? (lastReading - mean) / stdDev : 0;
                   const isAnomaly = deviation >= threshold;
                   const meanPct = (mean * 100).toFixed(2);
                   const stdPct = (stdDev * 100).toFixed(3);

                   return (
                     <div
                       key={b.device_id}
                       className={`rounded-lg border p-4 ${
                         isAnomaly ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border bg-muted/20"
                       }`}
                     >
                       <div className="mb-3 flex items-center justify-between gap-2">
                         <span className="text-sm font-semibold text-foreground">{b.device_id}</span>
                         {isAnomaly && (
                           <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                             Anomaly ({deviation.toFixed(1)}σ)
                           </span>
                         )}
                       </div>
                       <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                         <div className="rounded-md border border-border bg-background p-2.5">
                           <div className="text-muted-foreground">Mean</div>
                           <div className="font-semibold text-foreground">{mean.toFixed(4)} mg/L</div>
                           <div className="text-muted-foreground">{meanPct}%</div>
                         </div>
                         <div className="rounded-md border border-border bg-background p-2.5">
                           <div className="text-muted-foreground">Std dev</div>
                           <div className="font-semibold text-foreground">{stdDev.toFixed(4)}</div>
                           <div className="text-muted-foreground">{stdPct}%</div>
                         </div>
                         <div className="rounded-md border border-border bg-background p-2.5">
                           <div className="text-muted-foreground">Samples</div>
                           <div className="font-semibold text-foreground">{samples}</div>
                           <div className="text-muted-foreground">{samples < 5 ? "Learning" : "Stable"}</div>
                         </div>
                         <div className="rounded-md border border-border bg-background p-2.5">
                           <div className="text-muted-foreground">Threshold</div>
                           <div className="font-semibold text-foreground">{threshold.toFixed(1)}σ</div>
                           <div className="text-muted-foreground">Deviation</div>
                         </div>
                       </div>
                       {/* Visual baseline range bar */}
                       <div className="mt-4">
                         <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                           {/* Normal range (mean ± 2σ) */}
                           <div
                             className="absolute h-full rounded-full bg-emerald-200/80"
                             style={{
                               left: `${Math.max(0, 30 - 20)}%`,
                               width: `${Math.min(40, 100)}%`,
                             }}
                           />
                           {/* Mean indicator */}
                           <div
                             className="absolute h-full w-px bg-emerald-700"
                             style={{ left: `${Math.min(50, 95)}%` }}
                           />
                           {/* Last reading indicator */}
                           <div
                             className={`absolute h-full w-1.5 rounded-full ${isAnomaly ? "bg-amber-500" : "bg-primary"}`}
                             style={{ left: `${Math.min(Math.max((lastReading / (mean + 3 * stdDev || 0.1)) * 100, 2), 98)}%` }}
                           />
                         </div>
                         <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                           <span>0</span>
                           <span>Mean</span>
                           <span>+3σ</span>
                         </div>
                       </div>
                     </div>
                   );
                 })}
               </div>
             )}
           </div>

{/* Email Alert Settings */}
           <div className="luxury-glass-panel">
             <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
               <div className="flex items-start gap-3">
                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                   <Mail className="h-5 w-5" />
                 </div>
                 <div>
                   <h2 className="text-lg font-semibold tracking-tight text-foreground">Email alerts</h2>
                   <p className="mt-0.5 text-sm text-muted-foreground">Notifications when alerts trigger</p>
                 </div>
               </div>
               {!emailConfigured ? (
                 <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                   SMTP not configured
                 </span>
               ) : (
                 <Button variant="outline" size="sm" onClick={handleTestEmail}>
                   <Send className="mr-1.5 h-3.5 w-3.5" /> Test email
                 </Button>
               )}
             </div>

            {/* Existing notification emails */}
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Mail className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm font-medium text-foreground">No email alerts configured</p>
                <p className="mt-1 text-xs">Add a recipient to receive notifications</p>
              </div>
            ) : (
              <div className="mb-4 space-y-2">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      n.enabled ? "border-border bg-background" : "border-border/80 bg-muted/30 opacity-70"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Switch
                        checked={n.enabled}
                        onCheckedChange={(checked) => handleToggleNotification(n.id, checked)}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{n.email}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {n.device_id === "all" ? "All devices" : n.device_id}
                          </span>
                          <span className="text-xs text-muted-foreground/60" aria-hidden>
                            ·
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {n.alert_types.map((t) => (
                              <span
                                key={t}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  t === "DANGER"
                                    ? "bg-destructive/10 text-destructive"
                                    : t === "WARNING"
                                      ? "bg-amber-500/15 text-amber-800"
                                      : "bg-emerald-500/10 text-emerald-800"
                                }`}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteNotification(n.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new email dialog */}
            <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Plus className="mr-2 h-4 w-4" /> Add email alert
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add email alert</DialogTitle>
                  <DialogDescription>
                    Choose devices and alert types for this recipient.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Email address
                    </label>
                    <Input
                      type="email"
                      placeholder="admin@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Device</label>
                    <Select value={newEmailDevice} onValueChange={setNewEmailDevice}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All devices</SelectItem>
                        {devices.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Alert types
                    </label>
                    <div className="flex gap-2">
                      {["WARNING", "DANGER"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() =>
                            setNewEmailTypes((prev) =>
                              prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
                            )
                          }
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                            newEmailTypes.includes(type)
                              ? type === "DANGER"
                                ? "border-destructive/30 bg-destructive/10 text-destructive"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-900"
                              : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setEmailDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        handleAddNotification();
                        setEmailDialogOpen(false);
                      }}
                    >
                      Add email
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Devices — incidents by device */}
        <div id="devices" className="scroll-mt-24">
          <div className="luxury-glass-panel">
            <div className="mb-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-foreground">Incidents per device</h2>
                  <p className="text-sm text-muted-foreground">High and warning counts by device</p>
                </div>
              </div>
            </div>
            <div className="h-72">
              {deviceIncidentData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No device data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deviceIncidentData} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="device" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.75rem",
                        fontSize: 12,
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      }}
                    />
                    <Bar dataKey="high" fill="#ef4444" radius={[4, 4, 0, 0]} name="High" />
                    <Bar dataKey="warning" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Warning" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Alert Report Table */}
           <div className="luxury-glass-panel">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">Reading log</h2>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "record" : "records"}
                  {(dateFrom || dateTo || deviceFilter !== "all") && " (filtered)"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleDeleteAll} disabled={!filtered.length}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete all
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>

          {loadingLogs ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-muted/50">
                <Activity className="h-7 w-7 opacity-50" />
              </div>
              <p className="font-medium text-foreground">No records match your filters</p>
              <p className="mt-1 text-sm">Try adjusting the date range or device</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">#</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Timestamp</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Device</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Alcohol level</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Concentration</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Severity</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((log) => {
                    const colors = statusColorClasses(log.status);
                    const percentage = Number(log.alcohol_level) * 100;
                    const statusLabel = log.status === "DANGER" ? "High" : log.status === "WARNING" ? "Elevated" : "Normal";
                    return (
                      <tr
                        key={log.id}
                        id={`log-row-${log.id}`}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{log.id}</td>
                        <td className="px-3 py-3 font-mono text-xs text-foreground">{format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")}</td>
                        <td className="px-3 py-3 font-medium text-foreground">{log.device_id}</td>
                        <td className="px-3 py-3 font-mono text-foreground">{formatAlcoholLevel(log.alcohol_level)}</td>
                        <td className="px-3 py-3 font-mono" style={{ color: log.status === 'DANGER' ? '#dc2626' : log.status === 'WARNING' ? '#f97316' : '#16a34a' }}>
                          {formatAlcoholPercentage(log.alcohol_level)}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors.badge}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-2 rounded-full ${colors.progress}`}
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{statusLabel}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDeleteLog(log.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 200 && (
            <div className="mt-4 rounded-lg border bg-muted/30 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-semibold text-foreground">200</span> of{" "}
                <span className="font-semibold text-foreground">{filtered.length}</span> records
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Export CSV to view all rows</p>
            </div>
          )}
        </div>
            </>
          )}

          {section === "alerts" && (
            <>
              <div className="luxury-glass-panel">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-destructive">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight text-foreground">Alerts</h2>
                      <p className="text-sm text-muted-foreground">Recent system alerts</p>
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        alertView === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setAlertView("active")}
                    >
                      Active ({alerts.length})
                    </button>
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        alertView === "history" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setAlertView("history")}
                    >
                      <History className="h-3.5 w-3.5" />
                      History ({historyAlerts.length})
                    </button>
                  </div>
                </div>

                {alertView === "active" ? (
                  alerts.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-muted/50">
                        <Bell className="h-7 w-7 opacity-50" />
                      </div>
                      <p className="text-sm font-medium">No active alerts in the last 10 minutes</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`flex items-center justify-between rounded-lg border p-4 ${
                            alert.status === "DANGER"
                              ? "border-destructive/25 bg-destructive/5"
                              : "border-amber-500/25 bg-amber-500/[0.06]"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                alert.status === "DANGER" ? "animate-pulse bg-destructive" : "bg-amber-500"
                              }`}
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">{alert.device_id}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatAlcoholLevel(alert.alcohol_level)} — {alert.status}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">{format(new Date(alert.created_at), "HH:mm:ss")}</p>
                            {alert.acknowledged && <span className="text-xs font-medium text-emerald-600">Acknowledged</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : historyAlerts.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-muted/50">
                      <History className="h-7 w-7 opacity-50" />
                    </div>
                    <p className="text-sm font-medium">No alert history yet</p>
                  </div>
                ) : (
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {historyAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`flex items-center justify-between rounded-lg border p-4 ${
                          alert.status === "DANGER" ? "border-destructive/20 bg-destructive/[0.04]" : "border-amber-500/20 bg-amber-500/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 shrink-0 rounded-full ${alert.status === "DANGER" ? "bg-destructive" : "bg-amber-500"}`} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{alert.device_id}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatAlcoholLevel(alert.alcohol_level)} — {alert.status}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">{format(new Date(alert.created_at), "yyyy-MM-dd HH:mm")}</p>
                          <p className="text-xs text-muted-foreground/80">Archived {format(new Date(alert.archived_at), "HH:mm")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </DashboardShell>
  );
}
