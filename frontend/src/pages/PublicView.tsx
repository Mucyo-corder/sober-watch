import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity } from "lucide-react";
import { AlcoholStatus, statusColorClasses, formatAlcoholLevel, formatAlcoholPercentage } from "@/lib/alcohol";
import { format } from "date-fns";
import { apiUrl } from "@/lib/apiBase";
import { Card } from "@/components/ui/card";

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
        const url = new URL(apiUrl("/api/public/logs"), window.location.origin);
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
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background">
        <div className="text-center">
          <Activity className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="container flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.svg" alt="SoberWatch - IoT Alcohol Monitoring System" className="h-9 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">Public view</h1>
              <p className="text-xs text-muted-foreground">Read-only sensor feed</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p className="text-xs text-muted-foreground sm:text-sm">
              {deviceParam ? <span className="font-mono">{deviceParam}</span> : "All devices"}
            </p>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <Card className="p-6 shadow-sm">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-primary">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">Recent readings</h2>
              <p className="text-sm text-muted-foreground">
                {logs.length} {logs.length === 1 ? "reading" : "readings"}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {logs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border bg-muted/50">
                  <Activity className="h-7 w-7 opacity-50" />
                </div>
                <p className="text-sm font-medium text-foreground">No readings available</p>
              </div>
            ) : (
              logs.map((log, index) => {
                const colors = statusColorClasses(log.status);
                const percentage = Number(log.alcohol_level) * 100;
                return (
                  <div
                    key={index}
                    className={`rounded-lg border p-4 transition-colors hover:bg-muted/30 ${
                      log.status === "DANGER"
                        ? "border-destructive/30 bg-destructive/[0.04]"
                        : log.status === "WARNING"
                          ? "border-amber-500/25 bg-amber-500/[0.04]"
                          : "border-border bg-card"
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-foreground">{log.device_id}</div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Activity className="h-3 w-3 shrink-0" />
                          {format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")}
                        </div>
                      </div>
                      <div className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${colors.badge}`}>
                        {log.status}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Alcohol level</div>
                          <div className="text-xl font-semibold tabular-nums text-foreground">
                            {formatAlcoholLevel(log.alcohol_level)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Concentration</div>
                          <div
                            className="text-xl font-semibold tabular-nums"
                            style={{
                              color:
                                log.status === "DANGER"
                                  ? "#dc2626"
                                  : log.status === "WARNING"
                                    ? "#f97316"
                                    : "#16a34a",
                            }}
                          >
                            {formatAlcoholPercentage(log.alcohol_level)}
                          </div>
                        </div>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${colors.progress}`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
