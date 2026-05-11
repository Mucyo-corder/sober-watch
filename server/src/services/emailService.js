import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "soberwatch@localhost";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "mucyophanie3@gmail.com";

const GAS_THRESHOLD = 300;

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("📧 Email not configured: missing SMTP credentials");
    return null;
  }
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
  return !!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS;
}

export async function sendGasAlertEmail(gasValue) {
  const transport = getTransporter();
  if (!transport) {
    console.error("📧 Cannot send email: SMTP not configured");
    return { success: false, error: "SMTP not configured" };
  }

  const subject = "🚨 GAS ALERT";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #fef2f2; border: 2px solid #fca5a5; border-radius: 12px; padding: 24px;">
        <h2 style="color: #dc2626; margin-top: 0;">🚨 GAS ALERT</h2>
        <p style="font-size: 16px; color: #1e293b;">
          Gas level is <strong>HIGH!</strong> Value: <strong style="color: #dc2626;">${gasValue}</strong>
        </p>
        <table style="margin: 16px 0; border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Gas Value</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #dc2626;">${gasValue}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Threshold</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${GAS_THRESHOLD}</td></tr>
          <tr><td style="padding: 8px; color: #64748b;">Time</td><td style="padding: 8px; font-weight: bold;">${new Date().toLocaleString()}</td></tr>
        </table>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">
          SoberWatch IoT Gas Monitoring System — Automated Alert
        </p>
      </div>
    </div>
  `;

  try {
    await transport.sendMail({
      from: EMAIL_FROM,
      to: ALERT_EMAIL,
      subject,
      html,
    });
    console.log(`📧 Gas alert email sent to: ${ALERT_EMAIL} (value: ${gasValue})`);
    return { success: true };
  } catch (err) {
    console.error("📧 Failed to send gas alert email:", err.message);
    return { success: false, error: err.message };
  }
}

export async function checkAndSendAlert(gasValue) {
  if (gasValue > GAS_THRESHOLD) {
    return await sendGasAlertEmail(gasValue);
  }
  return { success: true, alertSent: false, reason: "Gas value below threshold" };
}

export function getThreshold() {
  return GAS_THRESHOLD;
}
