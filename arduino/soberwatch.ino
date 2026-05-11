/*
  SoberWatch - IoT Alcohol Monitoring System
  ESP32 + MQ-3 Sensor Sketch

  Hardware:
    - ESP32 DevKit
    - MQ-3 Alcohol Sensor (AO -> GPIO 34, VCC -> 5V, GND -> GND)

  Required Libraries (install via Arduino Library Manager):
    - WiFi (built-in for ESP32)
    - HTTPClient (built-in for ESP32)
    - ArduinoJson by Benoit Blanchon

  Steps:
    1. Update WIFI_SSID and WIFI_PASSWORD below.
    2. Update API_BASE_URL to match your computer's IP and backend port.
    3. Change DEVICE_ID if you have multiple sensors.
    4. Upload to ESP32 and open Serial Monitor (115200 baud).
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ===================== CONFIGURATION =====================
// 1. Wi-Fi credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// 2. Backend API endpoint
//    Replace with your computer's local IP and the backend port.
//    Example: "http://192.168.0.213:4000"
const char* API_BASE_URL = "http://YOUR_COMPUTER_IP:4000";

// 3. Unique device identifier (use different names for multiple sensors)
const char* DEVICE_ID = "DEVICE-001";

// 4. Sensor pin (MQ-3 analog output -> ESP32 GPIO 34)
const int MQ3_PIN = 34;

// 5. How often to send readings (milliseconds)
const unsigned long SEND_INTERVAL_MS = 2000;
// =================== END CONFIGURATION ===================

// Calibration factor: tune this so 0.08 mg/L (legal US limit) reads correctly.
// Default assumes: raw * (3.3V / 4095) * 0.05
const float CALIBRATION_FACTOR = 0.05f;

void setup() {
  Serial.begin(115200);
  pinMode(MQ3_PIN, INPUT);

  // Connect to Wi-Fi
  Serial.print("[WiFi] Connecting to ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected");
  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.localIP());

  // Sync time for accurate timestamps
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[NTP] Waiting for time sync...");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" done");
}

// Build ISO 8601 UTC timestamp: 2024-01-15T14:30:00Z
String isoTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String("");
  }
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

void loop() {
  // 1. Read sensor
  int raw = analogRead(MQ3_PIN);

  // Convert raw ADC (0-4095 on ESP32 12-bit) to voltage, then to mg/L
  float voltage      = raw * (3.3f / 4095.0f);
  float alcoholLevel = voltage * CALIBRATION_FACTOR;

  // Optional: clamp to reasonable range to avoid noise spikes
  if (alcoholLevel < 0.0f) alcoholLevel = 0.0f;

  String timestamp = isoTimestamp();

  Serial.printf("[Sensor] Raw=%d  Voltage=%.3fV  Level=%.4f mg/L  Time=%s\n",
                raw, voltage, alcoholLevel, timestamp.c_str());

  // 2. POST reading to backend
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

    int httpCode = http.POST(payload);

    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
      Serial.println("[HTTP] Sent successfully (" + String(httpCode) + ")");
    } else if (httpCode > 0) {
      Serial.printf("[HTTP] Server returned %d: %s\n", httpCode, http.getString().c_str());
    } else {
      Serial.printf("[HTTP] Request failed: %s\n", http.errorToString(httpCode).c_str());
    }

    http.end();
  } else {
    Serial.println("[WiFi] Not connected, skipping POST");
  }

  delay(SEND_INTERVAL_MS);
}
