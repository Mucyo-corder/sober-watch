import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Clock, User, FileText, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

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
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("all");
  const [filterEntity, setFilterEntity] = useState<string>("all");

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams();
      if (filterAction !== "all") params.append("action", filterAction);
      if (filterEntity !== "all") params.append("entity_type", filterEntity);

      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/audit?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          },
        }
      );
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container max-w-7xl flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </span>
            <span className="font-semibold text-slate-900">Audit Log</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{user?.email}</span>
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-7xl py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">System Audit Trail</h1>
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <Card className="p-6 mb-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-slate-700 mb-1 block">Filter by Action</label>
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
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-slate-700 mb-1 block">Filter by Entity</label>
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

        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <FileText className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p>No audit logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Timestamp</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">User</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Action</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Entity</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Details</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-slate-50">
                      <td className="p-4 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-900">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {log.user_email}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {getActionLabel(log.action)}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {log.entity_type && (
                          <span className="capitalize">
                            {log.entity_type}
                            {log.entity_id && ` #${log.entity_id}`}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-xs truncate">{log.details}</td>
                      <td className="p-4 text-sm text-slate-500 font-mono">{log.ip_address || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
