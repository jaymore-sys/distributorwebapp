# Backend Push Notification Setup

The main Node.js backend is not present in this React/Vite repo. Add the code below to your real backend, then deploy that backend before expecting phone push notifications to work.

## Install

```bash
npm install firebase-admin express
```

## Environment Variables

Keep Firebase Admin credentials only on the backend.

```bash
FIREBASE_SERVICE_ACCOUNT_CRUNZZO_JSON='{"type":"service_account",...}'
FIREBASE_SERVICE_ACCOUNT_BOUNCE_JSON='{"type":"service_account",...}'
FIREBASE_SERVICE_ACCOUNT_VALENCIA_JSON='{"type":"service_account",...}'
```

You can use base64-encoded JSON in the same variables. If you prefer files:

```bash
GOOGLE_APPLICATION_CREDENTIALS_CRUNZZO=/secure/path/crunzzo-service-account.json
GOOGLE_APPLICATION_CREDENTIALS_BOUNCE=/secure/path/bounce-service-account.json
GOOGLE_APPLICATION_CREDENTIALS_VALENCIA=/secure/path/valencia-service-account.json
```

## firebaseAdmin.js

```js
import fs from "node:fs";
import admin from "firebase-admin";

const SECTION_KEYS = ["crunzzo", "bounce", "valencia"];

function normalizeSection(section = "crunzzo") {
  return SECTION_KEYS.includes(section) ? section : "crunzzo";
}

function getEnvNames(section) {
  const upper = section.toUpperCase().replace(/-/g, "_");
  return {
    json: [
      `FIREBASE_SERVICE_ACCOUNT_${upper}_JSON`,
      `${upper}_FIREBASE_SERVICE_ACCOUNT_JSON`,
      "FIREBASE_SERVICE_ACCOUNT_JSON",
    ],
    path: [
      `GOOGLE_APPLICATION_CREDENTIALS_${upper}`,
      `${upper}_GOOGLE_APPLICATION_CREDENTIALS`,
      "GOOGLE_APPLICATION_CREDENTIALS",
    ],
  };
}

function parseServiceAccount(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const decoded = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(decoded);
}

function loadServiceAccount(section) {
  const names = getEnvNames(section);
  for (const name of names.json) {
    if (process.env[name]) return parseServiceAccount(process.env[name]);
  }
  for (const name of names.path) {
    if (process.env[name] && fs.existsSync(process.env[name])) {
      return JSON.parse(fs.readFileSync(process.env[name], "utf8"));
    }
  }
  return null;
}

export function getFirebaseAdmin(section = "crunzzo") {
  const sectionKey = normalizeSection(section);
  const appName = `admin-${sectionKey}`;
  const existing = admin.apps.find((app) => app?.name === appName);
  if (existing) {
    return { admin, db: admin.firestore(existing), messaging: admin.messaging(existing) };
  }

  const serviceAccount = loadServiceAccount(sectionKey);
  const app = admin.initializeApp(
    {
      credential: serviceAccount
        ? admin.credential.cert(serviceAccount)
        : admin.credential.applicationDefault(),
    },
    appName
  );

  return { admin, db: admin.firestore(app), messaging: admin.messaging(app) };
}

export { admin };
```

## appNotifications.js

```js
import crypto from "node:crypto";
import { admin, getFirebaseAdmin } from "./firebaseAdmin.js";

const APP_NOTIFICATIONS = "app_notifications";
const DEVICE_TOKENS = "device_tokens";
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

const VALID_ROLES = new Set(["admin", "super_stockist", "distributor", "retailer"]);
const VALID_SECTIONS = new Set(["crunzzo", "bounce", "valencia"]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "danger"]);

const clean = (value) => String(value || "").trim();
const array = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);
const stringData = (data = {}) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );

function validatePayload(payload) {
  const section = clean(payload.section || "crunzzo");
  const targetRoles = array(payload.targetRoles).filter((role) => VALID_ROLES.has(role));
  const targetUids = array(payload.targetUids);

  if (!VALID_SECTIONS.has(section)) throw new Error("Invalid section.");
  if (!payload.type || !payload.title || !payload.body) throw new Error("type, title, and body are required.");
  if (!targetRoles.length && !targetUids.length) throw new Error("targetRoles or targetUids is required.");

  return {
    section,
    type: clean(payload.type),
    title: clean(payload.title),
    body: clean(payload.body),
    severity: VALID_SEVERITIES.has(payload.severity) ? payload.severity : "info",
    targetRoles,
    targetUids,
    regionId: clean(payload.regionId),
    entityType: clean(payload.entityType),
    entityId: clean(payload.entityId),
    targetPath: clean(payload.targetPath),
    targetTab: clean(payload.targetTab),
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
    dedupeKey: clean(payload.dedupeKey),
    createdBy: clean(payload.createdBy),
    pushEnabled: payload.pushEnabled !== false,
  };
}

function tokenDocId({ uid, platform, token }) {
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
  return `${uid}_${platform}_${hash}`;
}

export async function registerDeviceToken(payload) {
  const uid = clean(payload.uid);
  const role = clean(payload.role);
  const section = clean(payload.section || "crunzzo");
  const regionId = clean(payload.regionId);
  const token = clean(payload.token);
  const platform = clean(payload.platform);

  if (!uid || !VALID_ROLES.has(role) || !VALID_SECTIONS.has(section) || !token) {
    throw new Error("uid, role, section, and token are required.");
  }
  if (!["android", "ios"].includes(platform)) throw new Error("platform must be android or ios.");

  const { db } = getFirebaseAdmin(section);
  const ref = db.collection(DEVICE_TOKENS).doc(tokenDocId({ uid, platform, token }));
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await ref.get();

  await ref.set(
    {
      uid,
      role,
      section,
      regionId,
      token,
      platform,
      active: true,
      ...(existing.exists ? {} : { createdAt: now }),
      updatedAt: now,
      lastSeenAt: now,
    },
    { merge: true }
  );

  return { id: ref.id, updated: existing.exists };
}

async function deactivateInvalidTokens(db, docs) {
  if (!docs.length) return;
  const batch = db.batch();
  docs.forEach((docSnap) => {
    batch.set(
      docSnap.ref,
      {
        active: false,
        disabledAt: admin.firestore.FieldValue.serverTimestamp(),
        disabledReason: "fcm_token_invalid",
      },
      { merge: true }
    );
  });
  await batch.commit();
}

export async function sendPushToTokens({ section = "crunzzo", tokens = [], tokenDocs = [], title, body, data = {} }) {
  const { db, messaging } = getFirebaseAdmin(section);
  const entries = Array.from(
    new Map(
      tokens
        .map((token, index) => ({ token: clean(token), docSnap: tokenDocs[index] || null }))
        .filter((entry) => entry.token)
        .map((entry) => [entry.token, entry])
    ).values()
  );

  if (!entries.length) return { status: "no_tokens", successCount: 0, failureCount: 0, tokenCount: 0 };

  let successCount = 0;
  let failureCount = 0;
  const invalidDocs = [];

  for (let i = 0; i < entries.length; i += 500) {
    const batchEntries = entries.slice(i, i + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batchEntries.map((entry) => entry.token),
      notification: { title, body },
      data: stringData(data),
      android: {
        priority: "high",
        notification: { channelId: "high_importance", sound: "default" },
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    });

    successCount += result.successCount;
    failureCount += result.failureCount;
    result.responses.forEach((response, index) => {
      if (!response.success && INVALID_TOKEN_CODES.has(response.error?.code) && batchEntries[index].docSnap) {
        invalidDocs.push(batchEntries[index].docSnap);
      }
    });
  }

  await deactivateInvalidTokens(db, invalidDocs);
  return { status: failureCount ? "partial_failure" : "sent", successCount, failureCount, tokenCount: entries.length };
}

async function matchingTokenDocs({ section, role = "", uid = "", regionId = "" }) {
  const { db } = getFirebaseAdmin(section);
  const snapshot = await db.collection(DEVICE_TOKENS).where("active", "==", true).get();
  return snapshot.docs.filter((docSnap) => {
    const token = docSnap.data();
    if (token.section !== section) return false;
    if (role && token.role !== role) return false;
    if (uid && token.uid !== uid) return false;
    if (regionId && token.regionId !== regionId) return false;
    return true;
  });
}

export async function sendPushToRole({ section = "crunzzo", role, regionId = "", title, body, data = {} }) {
  const docs = await matchingTokenDocs({ section, role, regionId });
  return sendPushToTokens({ section, tokens: docs.map((doc) => doc.data().token), tokenDocs: docs, title, body, data });
}

export async function sendPushToUser({ section = "crunzzo", uid, title, body, data = {} }) {
  const docs = await matchingTokenDocs({ section, uid });
  return sendPushToTokens({ section, tokens: docs.map((doc) => doc.data().token), tokenDocs: docs, title, body, data });
}

export async function createAppNotification(payload) {
  const item = validatePayload(payload);
  const { db } = getFirebaseAdmin(item.section);

  if (item.dedupeKey) {
    const existing = await db.collection(APP_NOTIFICATIONS).where("dedupeKey", "==", item.dedupeKey).limit(1).get();
    const sameSection = existing.docs.find((doc) => doc.data().section === item.section);
    if (sameSection) return { id: sameSection.id, duplicate: true, pushStatus: sameSection.data().pushStatus || "deduped" };
  }

  const ref = db.collection(APP_NOTIFICATIONS).doc();
  const doc = {
    ...item,
    data: item.data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    pushStatus: item.pushEnabled ? "pending" : "disabled",
    readBy: {},
    viewedBy: {},
  };
  await ref.set(doc);

  if (!item.pushEnabled) return { id: ref.id, pushStatus: "disabled" };

  const tokenDocs = await matchingTokenDocs({ section: item.section, regionId: item.regionId });
  const targeted = tokenDocs.filter((docSnap) => {
    const token = docSnap.data();
    return item.targetRoles.includes(token.role) || item.targetUids.includes(token.uid);
  });

  const pushResult = await sendPushToTokens({
    section: item.section,
    tokens: targeted.map((docSnap) => docSnap.data().token),
    tokenDocs: targeted,
    title: item.title,
    body: item.body,
    data: {
      ...item.data,
      type: item.type,
      section: item.section,
      notificationId: ref.id,
      targetPath: item.targetPath,
      targetTab: item.targetTab,
      entityType: item.entityType,
      entityId: item.entityId,
    },
  });

  await ref.set(
    {
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushStatus: pushResult.status,
      pushResult,
    },
    { merge: true }
  );

  return { id: ref.id, pushStatus: pushResult.status, pushResult };
}
```

## pushRoutes.js

```js
import express from "express";
import { createAppNotification, registerDeviceToken } from "./appNotifications.js";

export function createNotificationRouter() {
  const router = express.Router();

  router.post("/push/register-token", async (req, res) => {
    try {
      res.json({ ok: true, ...(await registerDeviceToken(req.body || {})) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "Unable to register push token." });
    }
  });

  router.post("/push/send-test", async (req, res) => {
    try {
      const { section = "crunzzo", role, uid, regionId = "", title = "Test notification", body = "Push is working.", targetPath, targetTab = "notifications" } = req.body || {};
      if (!role && !uid) throw new Error("Provide role or uid.");
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
        dedupeKey: `test_push:${section}:${role || uid}:${Date.now()}`,
        pushEnabled: true,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "Unable to send test notification." });
    }
  });

  router.post("/app-notifications", async (req, res) => {
    try {
      res.json({ ok: true, ...(await createAppNotification(req.body || {})) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "Unable to create notification." });
    }
  });

  return router;
}
```

## Mount In Your Server

```js
import express from "express";
import { createNotificationRouter } from "./pushRoutes.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api", createNotificationRouter());
```

## Test Request

```bash
curl -X POST https://YOUR_BACKEND_DOMAIN/api/push/send-test \
  -H 'Content-Type: application/json' \
  -d '{
    "section": "crunzzo",
    "role": "admin",
    "title": "Test notification",
    "body": "Push notifications are working",
    "targetPath": "/crunzzo/admin/notifications"
  }'
```
