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
    projectId: [`FIREBASE_PROJECT_ID_${upper}`, `${upper}_FIREBASE_PROJECT_ID`],
  };
}

function parseServiceAccount(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  return JSON.parse(decoded);
}

function loadServiceAccount(section) {
  const envNames = getEnvNames(section);

  for (const name of envNames.json) {
    if (process.env[name]) return parseServiceAccount(process.env[name]);
  }

  for (const name of envNames.path) {
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
    return {
      admin,
      app: existing,
      db: admin.firestore(existing),
      messaging: admin.messaging(existing),
    };
  }

  const serviceAccount = loadServiceAccount(sectionKey);
  const projectId =
    getEnvNames(sectionKey).projectId.map((name) => process.env[name]).find(Boolean) ||
    serviceAccount?.project_id;

  const app = admin.initializeApp(
    {
      credential: serviceAccount
        ? admin.credential.cert(serviceAccount)
        : admin.credential.applicationDefault(),
      ...(projectId ? { projectId } : {}),
    },
    appName
  );

  return {
    admin,
    app,
    db: admin.firestore(app),
    messaging: admin.messaging(app),
  };
}

export { admin };
