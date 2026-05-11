import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Download,
  Wifi,
  WifiOff,
  Cpu,
  Printer,
  LogOut,
  Trash2,
  History,
  Bell,
  Shield,
  Mail,
  Brain,
  RefreshCw,
  Plus,
  X,
  Send,
} from "lucide-react";
import { AlcoholStatus, statusColorClasses, formatAlcoholLevel, formatAlcoholPercentage } from "@/lib/alcohol";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
} from "recharts";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

interface AlcoholLog {
  id: number;
  device_id: string;
  alcohol_level: number;
  status: AlcoholStatus;
  timestamp: string;
}

const SINGLE_DEVICE_ID = "DEVICE-001";

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

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [logs, setLogs] = useState<AlcoholLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const [highAlertId, setHighAlertId] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [historyAlerts, setHistoryAlerts] = useState<any[]>([]);
  const [alertView, setAlertView] = useState<"active" | "history">("active");

  // Filters
  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTriggered, setSearchTriggered] = useState<number>(0);

  // Baseline auto-learning
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);

  // Email alert settings
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailDevice, setNewEmailDevice] = useState("all");
  const [newEmailTypes, setNewEmailTypes] = useState<string[]>(["WARNING", "DANGER"]);

  useEffect(() => {
    let mounted = true;
    const fetchLogs = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logs`);
        if (!response.ok) throw new Error("Failed to fetch");
        const data = (await response.json()) as AlcoholLog[];
        if (!mounted) return;
        setLogs((prev) => {
          if (prev.length > 0 && data.length > 0 && prev[0].id !== data[0].id) {
            const row = data[0];
            if (row.status === "DANGER") {
              setHighAlertId(row.id);
              toast.error(`DANGER alcohol detected on ${row.device_id} — ${formatAlcoholLevel(row.alcohol_level)} (${formatAlcoholPercentage(row.alcohol_level)})`, {
                duration: 2000,
              });
              // Auto-send gas alert email
              const gasValue = Math.round(Number(row.alcohol_level) * 10000);
              fetch(`${import.meta.env.VITE_API_BASE_URL}/api/alert`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gasValue }),
              }).catch(() => {});
            } else if (row.status === "WARNING") {
              toast.warning(`Warning level on ${row.device_id} — ${formatAlcoholLevel(row.alcohol_level)} (${formatAlcoholPercentage(row.alcohol_level)})`, { duration: 2000 });
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
          fetch(`${import.meta.env.VITE_API_BASE_URL}/api/alerts`),
          fetch(`${import.meta.env.VITE_API_BASE_URL}/api/alerts/history`),
        ]);
        if (activeRes.ok) setAlerts(await activeRes.json());
        if (historyRes.ok) setHistoryAlerts(await historyRes.json());
      } catch {
        /* ignore */
      }
    };

    const fetchBaselines = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/baselines`);
        if (res.ok) setBaselines(await res.json());
      } catch {
        /* ignore */
      }
    };

    const fetchNotifications = async () => {
      try {
        const [notifRes, statusRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_BASE_URL}/api/notifications`),
          fetch(`${import.meta.env.VITE_API_BASE_URL}/api/notifications/status`),
        ]);
        if (notifRes.ok) setNotifications(await notifRes.json());
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
    const intervalId = window.setInterval(() => {
      fetchLogs();
      fetchAlerts();
      fetchBaselines();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

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
  const latestStatusColor = latest ? statusColorClasses(latest.status) : null;

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
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logs/${id}`, { method: "DELETE" });
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
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logs`, { method: "DELETE" });
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
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/notifications`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ device_id: newEmailDevice, email: newEmail.trim(), alert_types: newEmailTypes }),
      });
      if (!res.ok) throw new Error("Failed to add notification");
      const setting = await res.json();
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
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/notifications/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete notification");
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast.success("Email alert removed");
    } catch {
      toast.error("Failed to remove email alert");
    }
  }

  async function handleToggleNotification(id: number, enabled: boolean) {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/notifications/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update notification");
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, enabled } : n)));
    } catch {
      toast.error("Failed to update notification");
    }
  }

  async function handleTestEmail() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/alert/test`);
      if (!res.ok) throw new Error("Failed to send test email");
      const data = await res.json();
      toast.success(`Test email sent to ${data.recipient || "configured email"}`);
    } catch {
      toast.error("Failed to send test email — check SMTP config");
    }
  }

  async function handleRecalculateBaselines() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/baselines/recalculate`, {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-indigo-100 shadow-sm sticky top-0 z-40">
        <div className="container max-w-7xl flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="SoberWatch - IoT Alcohol Monitoring System" className="h-10 w-auto" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-indigo-50">
              {realtimeOn ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="font-medium text-green-700">Live</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-slate-500">Offline</span>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => navigate("/setup")}>
              <Cpu className="w-4 h-4 mr-2" /> Device Setup
            </Button>
            <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => navigate("/audit")}>
              <Shield className="w-4 h-4 mr-2" /> Audit Log
            </Button>
            <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => { signOut(); navigate('/auth'); }}>
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-7xl py-8 px-6 space-y-8">
        {/* Alert History Search */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <Activity className="w-4 h-4 text-blue-600" />
              </span>
              Search Alerts by Date
            </h2>
            <p className="text-sm text-slate-500 ml-10">View historical alerts that occurred on a specific date</p>
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full border-indigo-200 focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full border-indigo-200 focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">Device</label>
              <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                <SelectTrigger className="w-full border-indigo-200 focus:border-blue-500 focus:ring-blue-500/20">
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
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30"
              onClick={() => setSearchTriggered(prev => prev + 1)}
            >
              Search
            </Button>
            {(deviceFilter !== "all" || dateFrom || dateTo) && (
              <Button
                variant="outline"
                size="sm"
                className="border-indigo-200 text-slate-600 hover:bg-indigo-50"
                onClick={() => {
                  setDeviceFilter("all");
                  setDateFrom("");
                  setDateTo("");
                  setSearchTriggered(prev => prev + 1);
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        {/* DANGER alert banner */}
        {latest && latest.status === "DANGER" && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-start gap-4 mb-4">
                <div className="mt-0.5">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-red-700">⚠️ DANGER ALCOHOL DETECTED</h3>
                   <p className="text-sm text-red-800 mt-1">
                     Device <strong>{latest.device_id}</strong> reported a level of{" "}
                     <strong>{formatAlcoholLevel(latest.alcohol_level)}</strong> ({formatAlcoholPercentage(latest.alcohol_level)}) at{" "}
                     {format(new Date(latest.timestamp), "PPpp")}
                   </p>
                </div>
              </div>
              
              {/* Alert Details */}
              <div className="bg-white rounded-lg p-4 mb-4 border border-red-100">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">Alert Details</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                   <div>
                     <div className="text-slate-500">Device ID</div>
                     <div className="font-semibold text-slate-900">{latest.device_id}</div>
                   </div>
                   <div>
                     <div className="text-slate-500">Alcohol Level</div>
                     <div className="font-semibold text-red-600">{formatAlcoholLevel(latest.alcohol_level)}</div>
                   </div>
                   <div>
                     <div className="text-slate-500">Concentration</div>
                     <div className="font-semibold text-red-600">{formatAlcoholPercentage(latest.alcohol_level)}</div>
                   </div>
                   <div>
                     <div className="text-slate-500">Timestamp</div>
                     <div className="font-semibold text-slate-900">{format(new Date(latest.timestamp), "HH:mm:ss")}</div>
                   </div>
                </div>
               </div>

               <div className="flex gap-3 mt-4">
                 <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100" onClick={() => setHighAlertId(null)}>
                   Acknowledge
                 </Button>
                 <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => generatePDF(latest)}>
                   <Printer className="w-4 h-4 mr-2" /> Export PDF Report
                 </Button>
               </div>
            </div>
          </div>
        )}

        {/* Status Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-green-100/50 border border-green-100 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center shadow-sm">
                  <div className="w-4 h-4 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                </div>
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Safe</h3>
              </div>
            </div>
            <div className="text-5xl font-bold text-green-600 tabular-nums">{stats.safe}</div>
            <p className="text-sm text-slate-500 mt-2">Total safe readings</p>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-yellow-100/50 border border-yellow-100 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-yellow-100 to-yellow-200 flex items-center justify-center shadow-sm">
                  <div className="w-4 h-4 rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/50" />
                </div>
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Warning</h3>
              </div>
            </div>
            <div className="text-5xl font-bold text-yellow-600 tabular-nums">{stats.warn}</div>
            <p className="text-sm text-slate-500 mt-2">Total warning readings</p>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-red-100/50 border border-red-100 relative overflow-hidden hover:shadow-xl transition-shadow">
            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-red-100 to-red-200 rounded-full -translate-y-1/2 translate-x-1/2 opacity-40" />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center shadow-sm">
                    <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">High Alerts</h3>
                </div>
              </div>
              <div className="text-5xl font-bold text-red-600 tabular-nums">{stats.high}</div>
              <p className="text-sm text-slate-500 mt-2">High-risk detections</p>
            </div>
          </div>
        </div>

        {/* Alerts Section */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                <Bell className="w-4 h-4 text-red-600" />
              </span>
              <h2 className="text-lg font-semibold text-slate-900">Alerts</h2>
            </div>
            <div className="flex gap-2">
              <button
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${alertView === "active" ? "bg-red-100 text-red-700" : "text-slate-500 hover:bg-slate-100"}`}
                onClick={() => setAlertView("active")}
              >
                Active ({alerts.length})
              </button>
              <button
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${alertView === "history" ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
                onClick={() => setAlertView("history")}
              >
                <History className="w-3.5 h-3.5 inline mr-1" />
                History ({historyAlerts.length})
              </button>
            </div>
          </div>

          {alertView === "active" ? (
            alerts.length === 0 ? (
              <div className="text-center text-slate-400 py-8">
                <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No active alerts in the last 10 minutes</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${alert.status === "DANGER" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${alert.status === "DANGER" ? "bg-red-500 animate-pulse" : "bg-orange-500"}`} />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{alert.device_id}</p>
                        <p className="text-xs text-slate-500">{formatAlcoholLevel(alert.alcohol_level)} — {alert.status}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{format(new Date(alert.created_at), "HH:mm:ss")}</p>
                      {alert.acknowledged && <span className="text-xs text-green-600">Acknowledged</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : historyAlerts.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-sm">No alert history yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {historyAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${alert.status === "DANGER" ? "bg-red-50/60 border-red-100" : "bg-orange-50/60 border-orange-100"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${alert.status === "DANGER" ? "bg-red-400" : "bg-orange-400"}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{alert.device_id}</p>
                      <p className="text-xs text-slate-500">{formatAlcoholLevel(alert.alcohol_level)} — {alert.status}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">{format(new Date(alert.created_at), "yyyy-MM-dd HH:mm")}</p>
                    <p className="text-xs text-slate-400">Archived {format(new Date(alert.archived_at), "HH:mm")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Baseline Auto-Learning & Email Alerts — side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Baseline Auto-Learning */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-purple-600" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Baseline Auto-Learning</h2>
                  <p className="text-xs text-slate-500">Per-device normal level profiles</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="border-purple-200 text-purple-700 hover:bg-purple-50" onClick={handleRecalculateBaselines}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Recalculate
              </Button>
            </div>

            {baselines.length === 0 ? (
              <div className="text-center text-slate-400 py-8">
                <Brain className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No baseline data yet</p>
                <p className="text-xs mt-1">Baselines build automatically as readings come in</p>
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
                    <div key={b.device_id} className={`p-4 rounded-xl border ${isAnomaly ? "bg-orange-50/60 border-orange-200" : "bg-slate-50/50 border-slate-200"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm text-slate-900">{b.device_id}</span>
                        {isAnomaly && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                            Anomaly ({deviation.toFixed(1)}σ)
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-slate-500">Mean</div>
                          <div className="font-semibold text-slate-800">{mean.toFixed(4)} mg/L</div>
                          <div className="text-slate-400">{meanPct}%</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Std Dev</div>
                          <div className="font-semibold text-slate-800">{stdDev.toFixed(4)}</div>
                          <div className="text-slate-400">{stdPct}%</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Samples</div>
                          <div className="font-semibold text-slate-800">{samples}</div>
                          <div className="text-slate-400">{samples < 5 ? "Learning" : "Stable"}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Threshold</div>
                          <div className="font-semibold text-slate-800">{threshold.toFixed(1)}σ</div>
                          <div className="text-slate-400">Deviation</div>
                        </div>
                      </div>
                      {/* Visual baseline range bar */}
                      <div className="mt-3">
                        <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                          {/* Normal range (mean ± 2σ) */}
                          <div
                            className="absolute h-full bg-green-200 rounded-full"
                            style={{
                              left: `${Math.max(0, 30 - 20)}%`,
                              width: `${Math.min(40, 100)}%`,
                            }}
                          />
                          {/* Mean indicator */}
                          <div
                            className="absolute h-full w-0.5 bg-green-600"
                            style={{ left: `${Math.min(50, 95)}%` }}
                          />
                          {/* Last reading indicator */}
                          <div
                            className={`absolute h-full w-1 rounded-full ${isAnomaly ? "bg-orange-500" : "bg-blue-500"}`}
                            style={{ left: `${Math.min(Math.max((lastReading / (mean + 3 * stdDev || 0.1)) * 100, 2), 98)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-blue-600" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Email Alerts</h2>
                  <p className="text-xs text-slate-500">Get notified when alerts trigger</p>
                </div>
              </div>
              {!emailConfigured ? (
                <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                  SMTP not configured
                </span>
              ) : (
                <Button variant="outline" size="sm" className="border-blue-200 text-blue-700 hover:bg-blue-50" onClick={handleTestEmail}>
                  <Send className="w-3.5 h-3.5 mr-1.5" /> Test Email
                </Button>
              )}
            </div>

            {/* Existing notification emails */}
            {notifications.length === 0 ? (
              <div className="text-center text-slate-400 py-6">
                <Mail className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No email alerts configured</p>
                <p className="text-xs mt-1">Add an email to receive alert notifications</p>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {notifications.map((n) => (
                  <div key={n.id} className={`flex items-center justify-between p-3 rounded-lg border ${n.enabled ? "bg-blue-50/50 border-blue-100" : "bg-slate-50 border-slate-200 opacity-60"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Switch
                        checked={n.enabled}
                        onCheckedChange={(checked) => handleToggleNotification(n.id, checked)}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{n.email}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">
                            {n.device_id === "all" ? "All devices" : n.device_id}
                          </span>
                          <span className="text-xs text-slate-400">•</span>
                          <div className="flex gap-1">
                            {n.alert_types.map((t) => (
                              <span
                                key={t}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  t === "DANGER"
                                    ? "bg-red-100 text-red-700"
                                    : t === "WARNING"
                                    ? "bg-orange-100 text-orange-700"
                                    : "bg-green-100 text-green-700"
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
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0 shrink-0"
                      onClick={() => handleDeleteNotification(n.id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new email dialog */}
            <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full border-blue-200 text-blue-700 hover:bg-blue-50">
                  <Plus className="w-4 h-4 mr-2" /> Add Email Alert
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Email Alert</DialogTitle>
                  <DialogDescription>
                    Configure email notifications for alcohol alerts. You can choose which devices and alert types to receive.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">Email Address</label>
                    <Input
                      type="email"
                      placeholder="admin@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="border-indigo-200 focus:border-blue-500 focus:ring-blue-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">Device</label>
                    <Select value={newEmailDevice} onValueChange={setNewEmailDevice}>
                      <SelectTrigger className="w-full border-indigo-200 focus:border-blue-500 focus:ring-blue-500/20">
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
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-2">Alert Types</label>
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
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            newEmailTypes.includes(type)
                              ? type === "DANGER"
                                ? "bg-red-100 text-red-700 border border-red-200"
                                : "bg-orange-100 text-orange-700 border border-orange-200"
                              : "bg-slate-100 text-slate-500 border border-slate-200"
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
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => {
                        handleAddNotification();
                        setEmailDialogOpen(false);
                      }}
                    >
                      Add Email
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Line Chart */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-blue-600" />
                </span>
                Alcohol Levels Over Time
              </h2>
              <p className="text-sm text-slate-500 ml-10">Last 60 readings</p>
            </div>
            <div className="h-72">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  No data to chart yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#64748b" domain={[0, "auto"]} />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.75rem",
                        fontSize: 12,
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      }}
                    />
                    <ReferenceLine y={0.02} stroke="#f97316" strokeDasharray="4 4" />
                    <ReferenceLine y={0.05} stroke="#ef4444" strokeDasharray="4 4" />
                    <Line
                      type="monotone"
                      dataKey="level"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#3b82f6" }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Bar Chart */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-purple-600" />
                </span>
                Incidents per Device
              </h2>
              <p className="text-sm text-slate-500 ml-10">High and warning alerts by device</p>
            </div>
            <div className="h-72">
              {deviceIncidentData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
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
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-indigo-600" />
                </span>
                Alert Report
              </h2>
              <p className="text-sm text-slate-500 ml-10">
                {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
                {(dateFrom || dateTo || deviceFilter !== "all") && " (filtered)"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="border-red-200 text-red-700 hover:bg-red-50" onClick={handleDeleteAll} disabled={!filtered.length}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete All
              </Button>
              <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={exportCSV} disabled={!filtered.length}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>

          {loadingLogs ? (
            <div className="text-center text-slate-400 py-12">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                <Activity className="w-8 h-8 text-slate-400" />
              </div>
              <p className="font-medium">No records match your filters</p>
              <p className="text-sm mt-1">Try adjusting your date range or device filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">#</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Timestamp</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Device</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Alcohol Level</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Concentration</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Severity</th>
                    <th className="text-left py-3 px-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((log, index) => {
                    const colors = statusColorClasses(log.status);
                    const percentage = Number(log.alcohol_level) * 100;
                    const statusLabel = log.status === "DANGER" ? "High" : log.status === "WARNING" ? "Elevated" : "Normal";
                    return (
                      <tr
                        key={log.id}
                        id={`log-row-${log.id}`}
                        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="py-3 px-3 text-slate-500 font-mono text-xs">{log.id}</td>
                        <td className="py-3 px-3 text-slate-700 font-mono text-xs">{format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")}</td>
                        <td className="py-3 px-3 text-slate-900 font-medium">{log.device_id}</td>
                        <td className="py-3 px-3 text-slate-900 font-mono">{formatAlcoholLevel(log.alcohol_level)}</td>
                        <td className="py-3 px-3 font-mono" style={{ color: log.status === 'DANGER' ? '#dc2626' : log.status === 'WARNING' ? '#f97316' : '#16a34a' }}>
                          {formatAlcoholPercentage(log.alcohol_level)}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${colors.badge}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-2 rounded-full ${colors.progress}`}
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{statusLabel}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                            onClick={() => handleDeleteLog(log.id)}
                          >
                            <Trash2 className="w-4 h-4" />
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
            <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold">200</span> of <span className="font-semibold">{filtered.length}</span> records
              </p>
              <p className="text-xs text-slate-500 mt-1">Export CSV to view all data</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
