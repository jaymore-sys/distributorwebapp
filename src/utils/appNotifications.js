import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const APP_NOTIFICATIONS_COLLECTION = "app_notifications";

const SEVERITY_TONES = {
  info: "#2563eb",
  success: "#27944e",
  warning: "#b45309",
  danger: "#e51f28",
};

const syncedDedupeKeys = new Set();

function getApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  return configured.replace(/\/$/, "");
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashString(value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getFallbackNotificationId(dedupeKey) {
  return `client_${hashString(dedupeKey)}_${String(dedupeKey || "").length}`;
}

export function formatAppNotificationTime(notification) {
  const ms =
    Number(notification?.createdAtMs || 0) ||
    getTimestampMs(notification?.createdAt) ||
    getTimestampMs(notification?.pushSentAt);

  if (!ms) return notification?.time || "-";

  try {
    return new Date(ms).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return notification?.time || "-";
  }
}

export function buildNotificationBody(parts) {
  return parts.filter(Boolean).join("\n");
}

export function toAppNotificationItem(docSnap) {
  const data = docSnap.data();
  const createdAtMs = Number(data.createdAtMs || 0) || getTimestampMs(data.createdAt);
  const detail = data.detail || data.data?.detail || data.body || "";
  const sourceId = data.sourceId || data.data?.sourceId || data.entityId || docSnap.id;

  return {
    id: docSnap.id,
    notificationId: docSnap.id,
    sourceId,
    dedupeKey: data.dedupeKey || "",
    tone: data.tone || SEVERITY_TONES[data.severity] || SEVERITY_TONES.info,
    title: data.title || "Notification",
    message: data.body || data.message || "",
    body: data.body || data.message || "",
    detail,
    time: formatAppNotificationTime({ ...data, createdAtMs }),
    createdAtMs,
    severity: data.severity || "info",
    type: data.type || "",
    section: data.section || "",
    targetPath: data.targetPath || "",
    targetTab: data.targetTab || "",
    entityType: data.entityType || "",
    entityId: data.entityId || "",
    data: data.data || {},
    readBy: data.readBy || {},
    viewedBy: data.viewedBy || {},
  };
}

export function notificationMatchesUser(notification, { section, role, uid, regionId }) {
  if (!notification || notification.section !== section) return false;

  const targetRoles = normalizeArray(notification.targetRoles);
  const targetUids = normalizeArray(notification.targetUids);
  const directUidMatch = uid && targetUids.includes(uid);
  const roleMatch = role && targetRoles.includes(role);

  if (targetUids.length && !directUidMatch && !roleMatch) return false;
  if (!targetUids.length && targetRoles.length && !roleMatch) return false;

  if (notification.regionId && regionId && notification.regionId !== regionId) return false;
  if (notification.regionId && !regionId && role !== "admin") return false;

  return true;
}

export function subscribeToAppNotifications({
  db,
  section,
  role,
  uid,
  regionId = "",
  limit = 60,
  onChange,
  onError,
}) {
  if (!db || !section || (!role && !uid)) return () => {};

  const appNotificationsQuery = query(
    collection(db, APP_NOTIFICATIONS_COLLECTION),
    where("section", "==", section)
  );

  return onSnapshot(
    appNotificationsQuery,
    (snapshot) => {
      const items = snapshot.docs
        .map((docSnap) => {
          const raw = docSnap.data();
          return {
            docSnap,
            raw,
            item: toAppNotificationItem(docSnap),
          };
        })
        .filter(({ raw }) => notificationMatchesUser(raw, { section, role, uid, regionId }))
        .map(({ item }) => item)
        .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
        .slice(0, limit);

      onChange(items);
    },
    (error) => {
      console.warn("App notifications subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function getUserNotifications({
  db,
  section,
  role,
  uid,
  regionId = "",
  limit = 60,
}) {
  if (!db || !section || (!role && !uid)) return [];

  const appNotificationsQuery = query(
    collection(db, APP_NOTIFICATIONS_COLLECTION),
    where("section", "==", section)
  );
  const snapshot = await getDocs(appNotificationsQuery);

  return snapshot.docs
    .map((docSnap) => {
      const raw = docSnap.data();
      return { raw, item: toAppNotificationItem(docSnap) };
    })
    .filter(({ raw }) => notificationMatchesUser(raw, { section, role, uid, regionId }))
    .map(({ item }) => item)
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    .slice(0, limit);
}

export const subscribeToUserNotifications = subscribeToAppNotifications;

export function mergeAppNotifications(remoteItems, computedItems) {
  const seen = new Set();
  const merged = [];

  remoteItems.forEach((item) => {
    [item.id, item.sourceId, item.dedupeKey].filter(Boolean).forEach((key) => seen.add(key));
    merged.push(item);
  });

  computedItems.forEach((item) => {
    const keys = [item.id, item.sourceId, item.dedupeKey].filter(Boolean);
    if (keys.some((key) => seen.has(key))) return;
    keys.forEach((key) => seen.add(key));
    merged.push({ ...item, localOnly: true });
  });

  return merged.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
}

export function isAppNotificationViewed(item, uid, localViewed = {}) {
  return Boolean(
    (uid && item?.readBy?.[uid]) ||
      (uid && item?.viewedBy?.[uid]) ||
      localViewed[item?.id] ||
      localViewed[item?.sourceId] ||
      localViewed[item?.dedupeKey]
  );
}

function getNotificationDocRef(db, notification) {
  const notificationId =
    typeof notification === "string"
      ? notification
      : notification?.notificationId || notification?.id || "";
  if (!db || !notificationId || notification?.localOnly) return null;
  return doc(db, APP_NOTIFICATIONS_COLLECTION, notificationId);
}

export async function markNotificationRead(db, notification, uid) {
  const notificationRef = getNotificationDocRef(db, notification);
  if (!notificationRef || !uid) return;

  await updateDoc(notificationRef, {
    [`readBy.${uid}`]: serverTimestamp(),
  });
}

export async function markNotificationViewed(db, notification, uid) {
  const notificationRef = getNotificationDocRef(db, notification);
  if (!notificationRef || !uid) return;

  await updateDoc(notificationRef, {
    [`viewedBy.${uid}`]: serverTimestamp(),
  });
}

export async function markAppNotificationViewed(db, item, uid) {
  const notificationRef = getNotificationDocRef(db, item);
  if (!notificationRef || !uid) return;

  await updateDoc(notificationRef, {
    [`readBy.${uid}`]: serverTimestamp(),
    [`viewedBy.${uid}`]: serverTimestamp(),
  });
}

function normalizePayload(payload) {
  const section = String(payload.section || "crunzzo").trim();
  const type = String(payload.type || "").trim();
  const title = String(payload.title || "").trim();
  const body = String(payload.body || payload.message || "").trim();
  const severity = ["info", "success", "warning", "danger"].includes(payload.severity)
    ? payload.severity
    : "info";
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  return {
    section,
    type,
    title,
    body,
    severity,
    targetRoles: normalizeArray(payload.targetRoles),
    targetUids: normalizeArray(payload.targetUids),
    regionId: payload.regionId ? String(payload.regionId) : "",
    entityType: payload.entityType ? String(payload.entityType) : "",
    entityId: payload.entityId ? String(payload.entityId) : "",
    targetPath: payload.targetPath ? String(payload.targetPath) : "",
    targetTab: payload.targetTab ? String(payload.targetTab) : "",
    data,
    sourceId: payload.sourceId || data.sourceId || "",
    detail: payload.detail || data.detail || "",
    dedupeKey: payload.dedupeKey ? String(payload.dedupeKey) : "",
    createdAtMs: Number(payload.createdAtMs || 0) || Date.now(),
    pushEnabled: payload.pushEnabled !== false,
  };
}

async function createClientFallbackNotification(db, payload) {
  if (!db || !payload.dedupeKey) return null;

  const notificationRef = doc(
    db,
    APP_NOTIFICATIONS_COLLECTION,
    getFallbackNotificationId(payload.dedupeKey)
  );
  const existing = await getDoc(notificationRef);
  if (existing.exists()) return { id: existing.id, fallback: true, duplicate: true };

  await setDoc(notificationRef, {
    ...payload,
    createdAt: serverTimestamp(),
    createdAtMs: payload.createdAtMs,
    readBy: {},
    viewedBy: {},
    pushEnabled: Boolean(payload.pushEnabled),
    pushStatus: "client_fallback_not_sent",
  });

  return { id: notificationRef.id, fallback: true };
}

export async function createAppNotification(payload, { db, allowClientFallback = true } = {}) {
  const normalized = normalizePayload(payload);

  if (!normalized.type || !normalized.title || !normalized.body) {
    throw new Error("Notification type, title, and body are required.");
  }

  const apiBaseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${apiBaseUrl}/api/app-notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(normalized),
    });

    if (!response.ok) {
      throw new Error(`Notification API returned ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (!allowClientFallback) throw error;

    try {
      return await createClientFallbackNotification(db, normalized);
    } catch (fallbackError) {
      console.warn("Notification API and Firestore fallback failed:", error, fallbackError);
      return null;
    }
  }
}

export function syncComputedAppNotifications(db, notifications) {
  if (!db || !Array.isArray(notifications) || !notifications.length) return;

  notifications.forEach((notification) => {
    if (!notification?.dedupeKey || syncedDedupeKeys.has(notification.dedupeKey)) return;
    syncedDedupeKeys.add(notification.dedupeKey);

    createAppNotification(notification, { db, allowClientFallback: true }).catch((error) => {
      syncedDedupeKeys.delete(notification.dedupeKey);
      console.warn("Computed notification sync failed:", error);
    });
  });
}
