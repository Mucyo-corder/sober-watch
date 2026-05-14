import { useEffect, useState } from "react";
import { Clock, User, FileText, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { DashboardShell } from "@/components/DashboardShell";

interface AuditEntry {
  id: number;
  user_id: number;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: string;
  ip_address: string | null;
  created_at: string;
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("all");
  const [filterEntity, setFilterEntity] = useState<string>("all");

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams();
      if (filterAction !== "all") params.append("action", filterAction);
      if (filterEntity !== "all") params.append("entity_type", filterEntity);

      const res = await fetch(`${apiUrl("/api/audit")}?${params.toString()}`);
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filterAction, filterEntity]);

  const handleRefresh = () => {
    setLoading(true);
    fetchLogs();
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "user_login":
        return "text-green-600 bg-green-50";
      case "user_signup":
        return "text-blue-600 bg-blue-50";
      case "acknowledge_alert":
        return "text-purple-600 bg-purple-50";
      case "delete_log":
      case "delete_all_logs":
        return "text-red-600 bg-red-50";
      default:
        return "text-slate-600 bg-slate-50";
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case "user_login":
        return "Login";
      case "user_signup":
        return "Sign Up";
      case "acknowledge_alert":
        return "Acknowledge Alert";
      case "delete_log":
        return "Delete Log";
      case "delete_all_logs":
        return "Clear All Logs";
      default:
        return action;
    }
  };

  return (
    <DashboardShell
      activeNav="audit"
      connected
      breadcrumbs={
        <>
          <span className="font-medium text-foreground">SoberWatch</span>
          <span className="mx-2 text-muted-foreground/50">/</span>
          <span>Audit log</span>
        </>
      }
    >
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">System audit trail</h1>
            <p className="mt-1 text-sm text-muted-foreground">Review authenticated actions across the system</p>
          </div>
          <Button onClick={handleRefresh} variant="outline" size="sm" className="w-fit">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card className="p-6 shadow-sm">
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[200px] flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">Filter by action</label>
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="user_login">Login</SelectItem>
                  <SelectItem value="user_signup">Sign Up</SelectItem>
                  <SelectItem value="acknowledge_alert">Acknowledge Alert</SelectItem>
                  <SelectItem value="delete_log">Delete Log</SelectItem>
                  <SelectItem value="delete_all_logs">Clear All Logs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">Filter by entity</label>
              <Select value={filterEntity} onValueChange={setFilterEntity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                  <SelectItem value="log">Log</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading audit logs…</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-12 w-12 opacity-40" />
              <p className="text-sm">No audit logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Timestamp</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">User</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Entity</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Details</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">IP address</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                      <td className="p-4 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}
                        </div>
                      </td>
                      <td className="p-4 text-foreground">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          {log.user_email}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${getActionColor(log.action)}`}>
                          {getActionLabel(log.action)}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {log.entity_type && (
                          <span className="capitalize">
                            {log.entity_type}
                            {log.entity_id && ` #${log.entity_id}`}
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs truncate p-4 text-muted-foreground">{log.details}</td>
                      <td className="p-4 font-mono text-xs text-muted-foreground">{log.ip_address || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
