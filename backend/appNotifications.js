import crypto from "node:crypto";
import { admin, getFirebaseAdmin } from "./firebaseAdmin.js";

const APP_NOTIFICATIONS_COLLECTION = "app_notifications";
const DEVICE_TOKENS_COLLECTION = "device_tokens";
const VALID_SECTIONS = new Set(["crunzzo", "bounce", "valencia"]);
const VALID_ROLES = new Set(["admin", "super_stockist", "distributor", "retailer"]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "danger"]);
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeData(data = {}) {
  return Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

function validateNotificationPayload(payload) {
  const section = normalizeString(payload.section || "crunzzo");
  const type = normalizeString(payload.type);
  const title = normalizeString(payload.title);
  const body = normalizeString(payload.body);
  const severity = VALID_SEVERITIES.has(payload.severity) ? payload.severity : "info";
  const targetRoles = normalizeArray(payload.targetRoles).filter((role) => VALID_ROLES.has(role));
  const targetUids = normalizeArray(payload.targetUids);

  if (!VALID_SECTIONS.has(section)) {
    throw new Error("Invalid notification section.");
  }
  if (!type || !title || !body) {
    throw new Error("Notification section, type, title, and body are required.");
  }
  if (!targetRoles.length && !targetUids.length) {
    throw new Error("Notification targetRoles or targetUids are required.");
  }

  return {
    section,
    type,
    title,
    body,
    severity,
    targetRoles,
    targetUids,
    regionId: normalizeString(payload.regionId),
    entityType: normalizeString(payload.entityType),
    entityId: normalizeString(payload.entityId),
    targetPath: normalizeString(payload.targetPath),
    targetTab: normalizeString(payload.targetTab),
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
    detail: normalizeString(payload.detail || payload.data?.detail),
    sourceId: normalizeString(payload.sourceId || payload.data?.sourceId),
    dedupeKey: normalizeString(payload.dedupeKey),
    createdBy: normalizeString(payload.createdBy),
    pushEnabled: payload.pushEnabled !== false,
    createdAtMs: Number(payload.createdAtMs || 0) || Date.now(),
  };
}

function tokenMatchesNotification(tokenDoc, notification) {
  const token = tokenDoc.data();
  if (!token.active || token.section !== notification.section) return false;
  if (notification.regionId && token.regionId !== notification.regionId) return false;

  const roleMatch = notification.targetRoles.includes(token.role);
  const uidMatch = notification.targetUids.includes(token.uid);
  return roleMatch || uidMatch;
}

function buildFcmData(notificationId, notification) {
  return normalizeData({
    ...notification.data,
    type: notification.type,
    section: notification.section,
    notificationId,
    targetPath: notification.targetPath,
    targetTab: notification.targetTab,
    entityType: notification.entityType,
    entityId: notification.entityId,
  });
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function getExistingDedupeNotification(db, section, dedupeKey) {
  if (!dedupeKey) return null;

  const snapshot = await db
    .collection(APP_NOTIFICATIONS_COLLECTION)
    .where("dedupeKey", "==", dedupeKey)
    .limit(1)
    .get();

  const existing = snapshot.docs.find((docSnap) => docSnap.data().section === section);
  return existing || null;
}

async function removeInvalidTokens(db, invalidTokenDocs) {
  if (!invalidTokenDocs.length) return;

  const batch = db.batch();
  invalidTokenDocs.forEach((docSnap) => {
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

async function getMatchingTokenDocs({ section, role = "", uid = "", regionId = "" }) {
  const { db } = getFirebaseAdmin(section);
  const tokenSnapshot = await db
    .collection(DEVICE_TOKENS_COLLECTION)
    .where("active", "==", true)
    .get();

  return tokenSnapshot.docs.filter((docSnap) => {
    const token = docSnap.data();
    if (token.section !== section) return false;
    if (role && token.role !== role) return false;
    if (uid && token.uid !== uid) return false;
    if (regionId && token.regionId !== regionId) return false;
    return true;
  });
}

export async function sendPushToTokens({
  section = "crunzzo",
  tokens = [],
  tokenDocs = [],
  title,
  body,
  data = {},
}) {
  const { db, messaging } = getFirebaseAdmin(section);
  const uniqueEntries = Array.from(
    new Map(
      tokens
        .map((token, index) => ({
          token: normalizeString(token),
          docSnap: tokenDocs[index] || null,
        }))
        .filter((entry) => entry.token)
        .map((entry) => [entry.token, entry])
    ).values()
  );

  if (!uniqueEntries.length) {
    return {
      status: "no_tokens",
      successCount: 0,
      failureCount: 0,
      tokenCount: 0,
      removedTokenCount: 0,
    };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokenDocs = [];
  const fcmData = normalizeData(data);

  for (const batchEntries of chunk(uniqueEntries, 500)) {
    const result = await messaging.sendEachForMulticast({
      tokens: batchEntries.map((entry) => entry.token),
      notification: {
        title: normalizeString(title),
        body: normalizeString(body),
      },
      data: fcmData,
      android: {
        priority: "high",
        notification: {
          channelId: "high_importance",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    successCount += result.successCount;
    failureCount += result.failureCount;

    result.responses.forEach((response, index) => {
      if (response.success) return;
      if (INVALID_TOKEN_CODES.has(response.error?.code) && batchEntries[index].docSnap) {
        invalidTokenDocs.push(batchEntries[index].docSnap);
      }
    });
  }

  await removeInvalidTokens(db, invalidTokenDocs);

  return {
    status: failureCount ? "partial_failure" : "sent",
    successCount,
    failureCount,
    tokenCount: uniqueEntries.length,
    removedTokenCount: invalidTokenDocs.length,
  };
}

export async function sendPushToRole({ section = "crunzzo", role, regionId = "", title, body, data = {} }) {
  const tokenDocs = await getMatchingTokenDocs({ section, role, regionId });
  return sendPushToTokens({
    section,
    tokens: tokenDocs.map((docSnap) => docSnap.data().token),
    tokenDocs,
    title,
    body,
    data,
  });
}

export async function sendPushToUser({ section = "crunzzo", uid, title, body, data = {} }) {
  const tokenDocs = await getMatchingTokenDocs({ section, uid });
  return sendPushToTokens({
    section,
    tokens: tokenDocs.map((docSnap) => docSnap.data().token),
    tokenDocs,
    title,
    body,
    data,
  });
}

export async function sendPushForNotification(notificationId, notification) {
  const { db } = getFirebaseAdmin(notification.section);
  const tokenSnapshot = await db
    .collection(DEVICE_TOKENS_COLLECTION)
    .where("active", "==", true)
    .get();

  const matchingTokenDocs = tokenSnapshot.docs.filter((docSnap) =>
    tokenMatchesNotification(docSnap, notification)
  );

  return sendPushToTokens({
    section: notification.section,
    tokens: matchingTokenDocs.map((docSnap) => docSnap.data().token),
    tokenDocs: matchingTokenDocs,
    title: notification.title,
    body: notification.body,
    data: buildFcmData(notificationId, notification),
  });
}

export async function createAppNotification(payload) {
  const notification = validateNotificationPayload(payload);
  const { db } = getFirebaseAdmin(notification.section);

  const existing = await getExistingDedupeNotification(
    db,
    notification.section,
    notification.dedupeKey
  );
  if (existing) {
    return {
      id: existing.id,
      duplicate: true,
      pushStatus: existing.data().pushStatus || "deduped",
    };
  }

  const notificationRef = db.collection(APP_NOTIFICATIONS_COLLECTION).doc();
  const notificationDoc = {
    section: notification.section,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    severity: notification.severity,
    targetRoles: notification.targetRoles,
    ...(notification.targetUids.length ? { targetUids: notification.targetUids } : {}),
    ...(notification.regionId ? { regionId: notification.regionId } : {}),
    ...(notification.entityType ? { entityType: notification.entityType } : {}),
    ...(notification.entityId ? { entityId: notification.entityId } : {}),
    ...(notification.targetPath ? { targetPath: notification.targetPath } : {}),
    ...(notification.targetTab ? { targetTab: notification.targetTab } : {}),
    ...(notification.dedupeKey ? { dedupeKey: notification.dedupeKey } : {}),
    ...(notification.createdBy ? { createdBy: notification.createdBy } : {}),
    ...(notification.sourceId ? { sourceId: notification.sourceId } : {}),
    ...(notification.detail ? { detail: notification.detail } : {}),
    data: {
      ...notification.data,
      ...(notification.sourceId ? { sourceId: notification.sourceId } : {}),
      ...(notification.detail ? { detail: notification.detail } : {}),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs: notification.createdAtMs,
    pushEnabled: notification.pushEnabled,
    pushStatus: notification.pushEnabled ? "pending" : "disabled",
    readBy: {},
    viewedBy: {},
  };

  await notificationRef.set(notificationDoc);

  if (!notification.pushEnabled) {
    return { id: notificationRef.id, pushStatus: "disabled" };
  }

  try {
    const pushResult = await sendPushForNotification(notificationRef.id, notification);
    await notificationRef.set(
      {
        pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        pushStatus: pushResult.status,
        pushResult,
      },
      { merge: true }
    );

    return {
      id: notificationRef.id,
      pushStatus: pushResult.status,
      pushResult,
    };
  } catch (error) {
    await notificationRef.set(
      {
        pushStatus: "failed",
        pushError: error.message || String(error),
      },
      { merge: true }
    );
    throw error;
  }
}

export function buildDeviceTokenDocId({ uid, platform, token }) {
  const hash = crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 32);
  return `${uid}_${platform}_${hash}`;
}

export async function registerDeviceToken(payload) {
  const uid = normalizeString(payload.uid);
  const role = normalizeString(payload.role);
  const section = normalizeString(payload.section || "crunzzo");
  const token = normalizeString(payload.token);
  const platform = normalizeString(payload.platform);
  const regionId = normalizeString(payload.regionId);

  if (!uid || !VALID_ROLES.has(role) || !VALID_SECTIONS.has(section) || !token) {
    throw new Error("uid, role, section, and token are required.");
  }
  if (!["android", "ios"].includes(platform)) {
    throw new Error("platform must be android or ios.");
  }

  const { db } = getFirebaseAdmin(section);
  const tokenRef = db
    .collection(DEVICE_TOKENS_COLLECTION)
    .doc(buildDeviceTokenDocId({ uid, platform, token }));
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await tokenRef.get();

  await tokenRef.set(
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

  return { id: tokenRef.id, updated: existing.exists };
}
