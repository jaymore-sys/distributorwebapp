import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const PUSH_CHANNEL_ID = "high_importance";
const PENDING_PUSH_ROUTE_KEY = "pending_push_notification_route_v1";
const PUSH_PROFILE_KEY = "mobile_push_profile_v1";

let activeRegistrationKey = "";
let listenersAttached = false;
let navigateHandler = null;

function getApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  return configured.replace(/\/$/, "");
}

function isNativeCapacitor() {
  if (typeof window === "undefined") return false;
  if (typeof Capacitor?.isNativePlatform === "function") {
    return Capacitor.isNativePlatform();
  }
  return Capacitor?.getPlatform?.() !== "web";
}

function getNativePlatform() {
  const platform = typeof Capacitor?.getPlatform === "function" ? Capacitor.getPlatform() : "web";

  if (platform === "ios") return "ios";
  return "android";
}

function normalizeRoute(path) {
  const value = String(path || "").trim();
  if (!value || !value.startsWith("/")) return "";
  return value;
}

function getSavedPushProfile() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PUSH_PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePendingRoute(route) {
  if (typeof window === "undefined" || !route) return;
  try {
    window.sessionStorage.setItem(PENDING_PUSH_ROUTE_KEY, route);
  } catch {
    // A missed tap route should never break app startup.
  }
}

function resolveRouteFromNotificationData(data = {}) {
  const targetPath = normalizeRoute(data.targetPath);
  if (targetPath) return targetPath;

  const section = String(data.section || "").trim();
  const targetTab = String(data.targetTab || "").trim();
  if (!section) return "";

  const profile = getSavedPushProfile();
  const role = String(profile.role || "").trim();
  const rolePath = role === "super_stockist" ? "super-stockist" : role || "distributor";

  return normalizeRoute(`/${section}/${rolePath}${targetTab ? `/${targetTab}` : ""}`);
}

function navigateToNotification(data = {}) {
  const route = resolveRouteFromNotificationData(data);
  if (!route) return;

  if (navigateHandler) {
    navigateHandler(route);
    return;
  }

  savePendingRoute(route);
}

async function registerTokenWithBackend({ uid, role, section, regionId, token, platform }) {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/api/push/register-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      role,
      section,
      regionId,
      token,
      platform,
    }),
  });

  if (!response.ok) {
    throw new Error(`Push token registration failed with ${response.status}`);
  }

  return response.json();
}

async function createAndroidChannel() {
  if (getNativePlatform() !== "android" || typeof PushNotifications?.createChannel !== "function") {
    return;
  }

  await PushNotifications.createChannel({
    id: PUSH_CHANNEL_ID,
    name: "High Importance Notifications",
    description: "Order, stock, and account alerts",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
  });
}

export function setMobilePushNavigator(navigate) {
  navigateHandler = typeof navigate === "function" ? navigate : null;
}

export function consumePendingPushRoute() {
  if (typeof window === "undefined") return "";
  try {
    const route = window.sessionStorage.getItem(PENDING_PUSH_ROUTE_KEY) || "";
    if (route) window.sessionStorage.removeItem(PENDING_PUSH_ROUTE_KEY);
    return route;
  } catch {
    return "";
  }
}

export async function registerMobilePushToken({
  uid,
  role,
  section,
  regionId = "",
} = {}) {
  if (!uid || !role || !section || !isNativeCapacitor()) return { skipped: true };

  const platform = getNativePlatform();
  const registrationKey = `${uid}:${role}:${section}:${regionId}:${platform}`;
  if (activeRegistrationKey === registrationKey) return { skipped: true, reason: "already-registered" };

  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        PUSH_PROFILE_KEY,
        JSON.stringify({ uid, role, section, regionId, platform })
      );
    }

    await createAndroidChannel();

    const permission = await PushNotifications.requestPermissions();
    if (permission?.receive && permission.receive !== "granted") {
      return { skipped: true, reason: "permission-denied" };
    }

    if (!listenersAttached) {
      await PushNotifications.addListener("registration", async ({ value }) => {
        try {
          const savedProfile = getSavedPushProfile();
          if (!value || !savedProfile.uid) return;
          await registerTokenWithBackend({
            ...savedProfile,
            token: value,
          });
        } catch (error) {
          console.warn("Push registration token save failed:", error);
        }
      });

      await PushNotifications.addListener("registrationError", (error) => {
        console.warn("Push registration error:", error);
      });

      await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        console.info("Push notification received:", notification?.data || notification);
      });

      await PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
        navigateToNotification(event?.notification?.data || {});
      });

      listenersAttached = true;
    }

    activeRegistrationKey = registrationKey;
    await PushNotifications.register();
    return { registered: true };
  } catch (error) {
    console.warn("Mobile push setup skipped:", error);
    return { skipped: true, error };
  }
}

export const registerMobilePushNotifications = registerMobilePushToken;
