import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 3000);
const token = process.env.TELEMETRY_TOKEN || "";
const vaultRoot = process.env.VAULT_LOG_DIR || "/vault/logs";
const n8nWebhook = process.env.N8N_WEBHOOK_URL_INTERNAL || "";
const rateWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 240);
const rateBuckets = new Map();

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store"
  });
  next();
});

app.use((req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + rateWindowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rateWindowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (bucket.count > rateLimitMax) {
    return res.status(429).json({ ok: false, error: "rate limit exceeded" });
  }
  next();
});

app.use(express.json({ limit: "512kb" }));

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function cleanSegment(value, fallback) {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return normalized || fallback;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "carbonflow-telemetry-api" });
});

app.post("/v1/logs", asyncRoute(async (req, res) => {
  const auth = req.get("authorization") || "";
  if (!token || auth !== `Bearer ${token}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const appName = cleanSegment(req.body.appName, "unknown_app");
  const clientId = cleanSegment(req.body.clientId, "unknown_client");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(vaultRoot, appName, clientId);
  const file = path.join(dir, `${day}.log`);

  const record = {
    receivedAt: now.toISOString(),
    severity: ["debug", "info", "warn", "error", "fatal"].includes(req.body.severity) ? req.body.severity : "error",
    version: String(req.body.version || "").slice(0, 64) || null,
    platform: String(req.body.platform || "").slice(0, 64) || null,
    message: String(req.body.message || "").slice(0, 4_000),
    stack: String(req.body.stack || "").slice(0, 12_000),
    context: typeof req.body.context === "object" && req.body.context !== null ? req.body.context : {}
  };

  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o640 });

  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appName, clientId, file, record })
    }).catch(() => {});
  }

  res.status(202).json({ ok: true });
}));

app.use((error, _req, res, _next) => {
  const badJson = error instanceof SyntaxError && "body" in error;
  res.status(badJson ? 400 : 500).json({
    ok: false,
    error: badJson ? "invalid json" : "internal server error"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CarbonFlow telemetry API listening on ${port}`);
});
