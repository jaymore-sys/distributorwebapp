import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const crunzzoConfig = {
  apiKey: "AIzaSyDkv65vuBnEuQM9Le-ShUCi51RndE2mWkU",
  authDomain: "crunzzo.firebaseapp.com",
  projectId: "crunzzo",
  storageBucket: "crunzzo.firebasestorage.app",
  messagingSenderId: "402128755022",
  appId: "1:402128755022:web:94ed503314ca2a58f3261f",
  measurementId: "G-CH39W4WZ45",
};

const bounceConfig = {
  apiKey: "AIzaSyDIvlheTTeVk80mZ8u4af347VKsao2TDDk",
  authDomain: "bounce-a86f0.firebaseapp.com",
  projectId: "bounce-a86f0",
  storageBucket: "bounce-a86f0.firebasestorage.app",
  messagingSenderId: "352732007976",
  appId: "1:352732007976:web:73f02c451c35272494af1d",
  measurementId: "G-L7VY7JV1SR",
};

const valenciaConfig = {
  apiKey: "AIzaSyBFJFnThxDIDR582TCr8JYVWzJL3J5vyo8",
  authDomain: "drink-valencia.firebaseapp.com",
  projectId: "drink-valencia",
  storageBucket: "drink-valencia.firebasestorage.app",
  messagingSenderId: "788375444532",
  appId: "1:788375444532:web:70375fdb2fe1c5cf5bbe61",
  measurementId: "G-BJXPG3W89Z",
};

function ensureNamedApp(name, config) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;
  return initializeApp(config, name);
}

const crunzzoApp = ensureNamedApp("crunzzo", crunzzoConfig);
const bounceApp = ensureNamedApp("bounce", bounceConfig);
const valenciaApp = ensureNamedApp("valencia", valenciaConfig);

const services = {
  crunzzo: {
    app: crunzzoApp,
    auth: getAuth(crunzzoApp),
    db: getFirestore(crunzzoApp),
    storage: getStorage(crunzzoApp),
  },
  bounce: {
    app: bounceApp,
    auth: getAuth(bounceApp),
    db: getFirestore(bounceApp),
    storage: getStorage(bounceApp),
  },
  valencia: {
    app: valenciaApp,
    auth: getAuth(valenciaApp),
    db: getFirestore(valenciaApp),
    storage: getStorage(valenciaApp),
  },
};

export function getBackendKey(section = "crunzzo") {
  if (section === "bounce") return "bounce";
  if (section === "valencia") return "valencia";
  return "crunzzo";
}

export function setSelectedBackend(section = "crunzzo") {
  const backendKey = getBackendKey(section);

  if (typeof window !== "undefined") {
    localStorage.setItem("selected_backend", backendKey);
  }

  return backendKey;
}

export function getSelectedBackend() {
  if (typeof window === "undefined") return "crunzzo";
  return localStorage.getItem("selected_backend") || "crunzzo";
}

export function getFirebaseServices(section = "crunzzo") {
  return services[getBackendKey(section)] || services.crunzzo;
}