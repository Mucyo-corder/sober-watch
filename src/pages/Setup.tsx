import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Cpu } from "lucide-react";
import { getApiBaseUrl } from "@/lib/apiBase";
import { DashboardShell } from "@/components/DashboardShell";

const deviceApiBase = getApiBaseUrl() || "http://YOUR_PC_LAN_IP:4000";

const arduinoSketch = `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ===== CONFIGURATION =====
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Backend API endpoint
const char* API_BASE_URL = "${deviceApiBase}";

const char* DEVICE_ID = "gate-1";          // Unique per device
const int   MQ3_PIN   = 34;                 // Analog input
const unsigned long SEND_INTERVAL_MS = 5000;

// ===== END CONFIG =====

String classify(float level) {
  if (level >= 0.08) return "HIGH";
  if (level >= 0.04) return "WARNING";
  return "SAFE";
}

void setup() {
  Serial.begin(115200);
  pinMode(MQ3_PIN, INPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println(" connected");

  configTime(0, 0, "pool.ntp.org");
}

String isoTimestamp() {
  time_t now; time(&now);
  struct tm* t = gmtime(&now);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", t);
  return String(buf);
}

void loop() {
  // 1. Read sensor (calibrate this for your MQ-3)
  int raw = analogRead(MQ3_PIN);
  float voltage = raw * (3.3 / 4095.0);
  float alcoholLevel = voltage * 0.05;   // Replace with your calibration curve
  String status = classify(alcoholLevel);
  String timestamp = isoTimestamp();

  Serial.printf("Reading: %.3f -> %s\\n", alcoholLevel, status.c_str());

  // 2. POST to backend
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String(API_BASE_URL) + "/api/logs";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["device_id"]     = DEVICE_ID;
    doc["alcohol_level"] = alcoholLevel;
    doc["timestamp"]     = timestamp;

    String payload;
    serializeJson(doc, payload);

    int code = http.POST(payload);
    Serial.printf("HTTP %d\\n", code);
    http.end();
  }

  delay(SEND_INTERVAL_MS);
}`;

export default function Setup() {
  return (
    <DashboardShell
      activeNav="setup"
      connected
      breadcrumbs={
        <>
          <span className="font-medium text-foreground">SoberWatch</span>
          <span className="mx-2 text-muted-foreground/50">/</span>
          <span>Device setup</span>
        </>
      }
    >
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <div className="mx-auto w-full max-w-3xl space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Cpu className="h-4 w-4 text-primary" />
          <span>ESP32 &amp; sensor configuration</span>
        </div>

        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">ESP32 setup</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Flash your ESP32 with the sketch below. Each reading is POSTed directly to your backend API endpoint.
          </p>
        </div>

        <Card className="p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-foreground">1. Hardware</h2>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>ESP32 dev board (any variant with Wi-Fi)</li>
            <li>MQ-3 alcohol sensor (or compatible analog gas sensor)</li>
            <li>Wire <code className="font-mono text-foreground">AO</code> → ESP32 GPIO 34, <code className="font-mono text-foreground">VCC</code> → 5V, <code className="font-mono text-foreground">GND</code> → GND</li>
          </ul>
        </Card>

        <Card className="p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-foreground">2. Arduino libraries</h2>
          <p className="text-sm text-muted-foreground">
            Install via Library Manager: <strong>WiFi</strong>, <strong>HTTPClient</strong>,{" "}
            <strong>ArduinoJson</strong>.
          </p>
        </Card>

        <Card className="p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">3. Sketch</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(arduinoSketch);
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            The endpoint is pre-filled for this project. Just set your Wi-Fi
            credentials and the device ID.
          </p>
          <pre className="max-h-[480px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
            {arduinoSketch}
          </pre>
        </Card>

        <Card className="p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-foreground">4. Granting dashboard access</h2>
          <p className="text-sm text-muted-foreground">
            Users with <code className="font-mono text-foreground">role = 'admin'</code>{" "}
            in the PostgreSQL <code className="font-mono text-foreground">users</code>{" "}
            table can access the dashboard.
          </p>
        </Card>

        <Card className="p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-foreground">5. Data classification</h2>
          <ul className="text-sm space-y-1.5">
            <li><span className="inline-block w-2 h-2 rounded-full bg-status-safe mr-2 align-middle" /> SAFE: 0.00 – 0.03</li>
            <li><span className="inline-block w-2 h-2 rounded-full bg-status-warning mr-2 align-middle" /> WARNING: 0.04 – 0.07</li>
            <li><span className="inline-block w-2 h-2 rounded-full bg-status-high mr-2 align-middle" /> HIGH: 0.08 and above</li>
          </ul>
        </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
