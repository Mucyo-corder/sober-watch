import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity } from "lucide-react";
import { AlcoholStatus, statusColorClasses, formatAlcoholLevel, formatAlcoholPercentage } from "@/lib/alcohol";
import { format } from "date-fns";

interface PublicLog {
  device_id: string;
  alcohol_level: number;
  status: AlcoholStatus;
  timestamp: string;
}

export default function PublicView() {
  const [searchParams] = useSearchParams();
  const deviceParam = searchParams.get("device");
  const [logs, setLogs] = useState<PublicLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const url = new URL(`${import.meta.env.VITE_API_BASE_URL}/api/public/logs`);
        if (deviceParam) {
          url.searchParams.append("device", deviceParam);
        }
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        setLogs(data);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [deviceParam]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <header className="bg-white/80 backdrop-blur-lg border-b border-indigo-100 shadow-sm sticky top-0 z-40">
        <div className="container max-w-7xl flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="SoberWatch - IoT Alcohol Monitoring System" className="h-10 w-auto" />
            <h1 className="text-lg font-semibold text-slate-900">Public Dashboard</h1>
          </div>
          <div className="text-sm text-slate-500">
            {deviceParam ? `Device: ${deviceParam}` : "All Devices"}
          </div>
        </div>
      </header>

      <main className="container max-w-7xl py-8 px-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg shadow-indigo-100/50 border border-indigo-100/50">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <Activity className="w-4 h-4 text-blue-600" />
              </span>
              Recent Alcohol Readings
            </h2>
            <p className="text-sm text-slate-500 ml-10">
              {logs.length} {logs.length === 1 ? 'reading' : 'readings'} found
            </p>
          </div>

          <div className="space-y-3">
            {logs.length === 0 ? (
              <div className="text-center text-slate-400 py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                  <Activity className="w-8 h-8 text-slate-400" />
                </div>
                <p className="font-medium">No readings available</p>
              </div>
            ) : (
              logs.map((log, index) => {
                const colors = statusColorClasses(log.status);
                const percentage = Number(log.alcohol_level) * 100;
                return (
                  <div
                    key={index}
                    className={`rounded-xl p-5 border transition-all hover:shadow-lg ${
                      log.status === "DANGER"
                        ? "bg-gradient-to-r from-red-50 to-red-100/50 border-red-200 shadow-md shadow-red-100/50"
                        : log.status === "WARNING"
                        ? "bg-gradient-to-r from-orange-50 to-orange-100/50 border-orange-200 shadow-md shadow-orange-100/50"
                        : "bg-gradient-to-r from-green-50 to-green-100/50 border-green-200 shadow-md shadow-green-100/50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="font-bold text-slate-900 text-lg">{log.device_id}</div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          {format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")}
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-bold ${colors.badge}`}>
                        {log.status}
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-end justify-between">
                        <div>
                          <div className="text-xs text-slate-500">Alcohol Level</div>
                          <div className="text-2xl font-bold tabular-nums text-slate-900">
                            {formatAlcoholLevel(log.alcohol_level)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Concentration</div>
                          <div className="text-2xl font-bold tabular-nums" style={{ color: log.status === 'DANGER' ? '#dc2626' : log.status === 'WARNING' ? '#f97316' : '#16a34a' }}>
                            {formatAlcoholPercentage(log.alcohol_level)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${colors.progress}`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
