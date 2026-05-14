import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const ALERT_EMAIL = (process.env.ALERT_EMAIL || "").trim();

if (!SMTP_USER || !SMTP_PASS) {
  console.error("❌ SMTP_USER or SMTP_PASS is missing in .env");
  console.error("   Set SMTP_PASS to your Gmail App Password (not your real password)");
  process.exit(1);
}

if (!ALERT_EMAIL) {
  console.error("❌ ALERT_EMAIL is missing in .env");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const TEST_VALUE = 999;

console.log(`\n📧 Sending test email...`);
console.log(`   From:  ${SMTP_USER}`);
console.log(`   To:    ${ALERT_EMAIL}`);
console.log(`   Value: ${TEST_VALUE}\n`);

try {
  const info = await transporter.sendMail({
    from: SMTP_USER,
    to: ALERT_EMAIL,
    subject: "🚨 ALCOHOL ALERT",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #fef2f2; border: 2px solid #fca5a5; border-radius: 12px; padding: 24px;">
          <h2 style="color: #dc2626; margin-top: 0;">🚨 GAS ALERT</h2>
          <p style="font-size: 16px; color: #1e293b;">
            Gas level is <strong>HIGH!</strong> Value: <strong style="color: #dc2626;">${TEST_VALUE}</strong>
          </p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">
            SoberWatch — Test Alert
          </p>
        </div>
      </div>
    `,
  });

  console.log(`✅ Email sent successfully!`);
  console.log(`   Message ID: ${info.messageId}`);
  process.exit(0);
} catch (err) {
  console.error("❌ Failed to send email:", err.message);
  process.exit(1);
}
