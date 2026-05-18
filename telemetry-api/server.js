import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 3000);
const token = process.env.TELEMETRY_TOKEN || "";
const vaultRoot = process.env.VAULT_LOG_DIR || "/vault/logs";
const n8nWebhook = process.env.N8N_WEBHOOK_URL_INTERNAL || "";

app.use(express.json({ limit: "512kb" }));

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

app.post("/v1/logs", async (req, res) => {
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
    severity: req.body.severity || "error",
    version: req.body.version || null,
    platform: req.body.platform || null,
    message: req.body.message || "",
    stack: req.body.stack || "",
    context: req.body.context || {}
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
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CarbonFlow telemetry API listening on ${port}`);
});
