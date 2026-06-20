import express from "express";
import createNotificationRouter from "./pushRoutes.js";

const app = express();
const DEFAULT_ALLOWED_ORIGINS = [
  "https://sienna-walrus-972530.hostingersite.com",
  "http://localhost:5173",
  "http://localhost:4173",
];

function getAllowedOrigins() {
  return String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.length) return DEFAULT_ALLOWED_ORIGINS.includes(origin);
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.use("/api", createNotificationRouter());

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Notification API listening on ${port}`);
});
