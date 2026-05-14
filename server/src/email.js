import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "soberwatch@localhost";
/** Optional extra recipient when SMTP is configured (set in .env only; never hardcode) */
const DEFAULT_ALERT_EMAIL = (process.env.DEFAULT_ALERT_EMAIL || "").trim();

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
}

export function isEmailConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export async function sendAlertEmail(deviceId, alcoholLevel, status, baselineMean, baselineDeviation) {
  const transport = getTransporter();
  if (!transport) {
    console.log("📧 Email not configured — skipping alert email");
    return;
  }

  const emailSet = new Set();

  if (DEFAULT_ALERT_EMAIL) {
    emailSet.add(DEFAULT_ALERT_EMAIL);
  }

  // Also fetch enabled notification settings matching this device or 'all'
  try {
    const result = await pool.query(
      `SELECT email, alert_types FROM notification_settings
       WHERE enabled = TRUE AND (device_id = $1 OR device_id = 'all')`,
      [deviceId]
    );
    const matching = result.rows.filter((row) => {
      const types = row.alert_types || [];
      return types.includes(status);
    });
    matching.forEach((r) => emailSet.add(r.email));
  } catch {
    // Table may not exist yet — use default email only
  }

  if (emailSet.size === 0) {
    return;
  }

  const toList = [...emailSet].join(", ");
  const statusEmoji = status === "DANGER" ? "🔴" : "🟠";
  const levelFormatted = Number(alcoholLevel).toFixed(3);
  const percentage = (Number(alcoholLevel) * 100).toFixed(1);

  let baselineInfo = "";
  if (baselineMean !== null && baselineMean !== undefined) {
    const deviationTag = baselineDeviation !== null && baselineDeviation !== undefined
      ? ` (${baselineDeviation.toFixed(1)}σ above baseline)`
      : "";
    baselineInfo = `\n\n📊 Baseline Info:\n  Device average: ${Number(baselineMean).toFixed(3)} mg/L${deviationTag}`;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${status === "DANGER" ? "#fef2f2" : "#fff7ed"}; border: 2px solid ${status === "DANGER" ? "#fca5a5" : "#fdba74"}; border-radius: 12px; padding: 24px;">
        <h2 style="color: ${status === "DANGER" ? "#dc2626" : "#ea580c"}; margin-top: 0;">
          ${statusEmoji} ${status} Alert — SoberWatch
        </h2>
        <p style="font-size: 16px; color: #1e293b;">
          Device <strong>${deviceId}</strong> reported an alcohol level of
          <strong style="color: ${status === "DANGER" ? "#dc2626" : "#ea580c"};">${levelFormatted} mg/L (${percentage}%)</strong>
        </p>
        <table style="margin: 16px 0; border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Status</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: ${status === "DANGER" ? "#dc2626" : "#ea580c"};">${status}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Alcohol Level</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${levelFormatted} mg/L</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Concentration</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${percentage}%</td></tr>
          <tr><td style="padding: 8px; color: #64748b;">Time</td><td style="padding: 8px; font-weight: bold;">${new Date().toLocaleString()}</td></tr>
        </table>
        ${baselineMean ? `<p style="font-size: 14px; color: #475569; background: #f8fafc; padding: 12px; border-radius: 8px;">
          📊 Baseline: avg ${Number(baselineMean).toFixed(3)} mg/L${baselineDeviation ? ` | deviation: ${baselineDeviation.toFixed(1)}σ` : ""}
        </p>` : ""}
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">
          SoberWatch IoT Alcohol Monitoring System — Automated Alert
        </p>
      </div>
    </div>
  `;

  try {
    await transport.sendMail({
      from: EMAIL_FROM,
      to: toList,
      subject: `${statusEmoji} [SoberWatch] ${status} Alert — ${deviceId} (${levelFormatted} mg/L)`,
      html,
    });
    console.log(`📧 Alert email sent to: ${toList}`);
  } catch (err) {
    console.error("📧 Failed to send alert email:", err.message);
  }
}
