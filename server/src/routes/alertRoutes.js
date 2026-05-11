import express from "express";
import { checkAndSendAlert, sendGasAlertEmail, getThreshold, isEmailConfigured } from "../services/emailService.js";

const router = express.Router();

// POST /api/alert - Accept gas value and send email if above threshold
router.post("/alert", async (req, res) => {
  const { gasValue } = req.body ?? {};

  if (gasValue === undefined || gasValue === null) {
    return res.status(400).json({ error: "gasValue is required" });
  }

  const numValue = Number(gasValue);
  if (Number.isNaN(numValue)) {
    return res.status(400).json({ error: "gasValue must be a number" });
  }

  const result = await checkAndSendAlert(numValue);

  if (result.success) {
    return res.json({
      success: true,
      gasValue: numValue,
      threshold: getThreshold(),
      alertSent: result.alertSent !== false,
      message: result.alertSent === false ? result.reason : "Alert processed",
    });
  } else {
    return res.status(500).json({ error: result.error || "Failed to process alert" });
  }
});

// GET /api/alert/test - Send a test email immediately
router.get("/alert/test", async (req, res) => {
  const testValue = 999;
  const result = await sendGasAlertEmail(testValue);

  if (result.success) {
    return res.json({
      success: true,
      message: "Test email sent",
      testValue,
      recipient: process.env.ALERT_EMAIL || "mucyophanie3@gmail.com",
    });
  } else {
    return res.status(500).json({ error: result.error || "Failed to send test email" });
  }
});

// GET /api/alert/threshold - Get the current threshold value
router.get("/alert/threshold", (_req, res) => {
  return res.json({ threshold: getThreshold() });
});

// GET /api/alert/status - Check if email is configured
router.get("/alert/status", (_req, res) => {
  return res.json({ configured: isEmailConfigured() });
});

export default router;
