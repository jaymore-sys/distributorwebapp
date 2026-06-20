import express from "express";
import {
  createAppNotification,
  registerDeviceToken,
} from "./appNotifications.js";

export function createNotificationRouter() {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ ok: true, service: "crunzzo-notification-backend" });
  });

  router.post("/push/register-token", async (req, res) => {
    try {
      const result = await registerDeviceToken(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || "Unable to register push token.",
      });
    }
  });

  router.post("/push/send-test", async (req, res) => {
    try {
      const {
        section = "crunzzo",
        role,
        uid,
        regionId = "",
        title = "Test notification",
        body = "Your push notification setup is working.",
        targetPath,
        targetTab = "notifications",
        data = {},
      } = req.body || {};

      if (!role && !uid) {
        res.status(400).json({
          ok: false,
          error: "Provide role or uid for the test notification target.",
        });
        return;
      }

      const result = await createAppNotification({
        section,
        type: "test_push",
        title,
        body,
        severity: "info",
        targetRoles: role ? [role] : [],
        targetUids: uid ? [uid] : [],
        regionId,
        targetPath,
        targetTab,
        data,
        dedupeKey: `test_push:${section}:${role || uid}:${Date.now()}`,
        pushEnabled: true,
      });

      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || "Unable to send test notification.",
      });
    }
  });

  router.post("/app-notifications", async (req, res) => {
    try {
      const result = await createAppNotification(req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || "Unable to create notification.",
      });
    }
  });

  return router;
}

export default createNotificationRouter;
