import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 3010);
const productsRoot = process.env.PRODUCTS_ROOT || "/vault/products";
const webhookSecret = process.env.RELEASE_WEBHOOK_SECRET || "";
const apiToken = process.env.RELEASE_API_TOKEN || "";
const publicBaseUrl = (process.env.RELEASE_PUBLIC_BASE_URL || "https://carbonflows.store").replace(/\/$/, "");
const n8nReleaseWebhook = process.env.N8N_RELEASE_WEBHOOK_INTERNAL || "";

function cleanSegment(value, fallback) {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 96);
  return normalized || fallback;
}

function timingSafeEqualText(a, b) {
  const ab = Buffer.from(a || "");
  const bb = Buffer.from(b || "");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function verifySignature(req, rawBody) {
  if (!webhookSecret) return false;
  const given = req.get("x-carbonflow-signature") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return timingSafeEqualText(given, expected);
}

function requireToken(req, res, next) {
  if (!apiToken) return res.status(503).json({ ok: false, error: "release api token is not configured" });
  const auth = req.get("authorization") || "";
  if (auth !== `Bearer ${apiToken}`) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
}

async function persistRelease(payload) {
  const appName = cleanSegment(payload.appName || payload.repository?.name, "app");
  const version = cleanSegment(payload.version || payload.release?.tag_name, "0.0.0");
  const platform = cleanSegment(payload.platform || "any", "any");
  const fileName = cleanSegment(payload.fileName || `${appName}-${version}.zip`, "artifact.zip");
  const status = payload.status === "draft" ? "draft" : "published";
  const releaseDir = path.join(productsRoot, appName, version);
  const artifactPath = path.join(releaseDir, fileName);

  await fs.mkdir(releaseDir, { recursive: true, mode: 0o750 });
  if (payload.artifactBase64) {
    await fs.writeFile(artifactPath, Buffer.from(payload.artifactBase64, "base64"), { mode: 0o640 });
  }

  const sha256 = payload.artifactBase64
    ? crypto.createHash("sha256").update(Buffer.from(payload.artifactBase64, "base64")).digest("hex")
    : payload.sha256 || "";
  const downloadUrl = `${publicBaseUrl}/release-api/v1/download/${encodeURIComponent(appName)}/${encodeURIComponent(version)}/${encodeURIComponent(fileName)}`;
  const release = {
    appName,
    version,
    platform,
    fileName,
    sha256,
    status,
    notes: payload.notes || payload.release?.body || "",
    downloadUrl,
    receivedAt: new Date().toISOString()
  };

  const releasesFile = path.join(productsRoot, appName, "releases.json");
  const releases = await readJson(releasesFile, []);
  const next = [release, ...releases.filter((item) => item.version !== version || item.platform !== platform)]
    .sort((a, b) => compareSemver(b.version, a.version));
  await writeJson(releasesFile, next);
  await writeJson(path.join(releaseDir, "release.json"), release);

  if (n8nReleaseWebhook) {
    fetch(n8nReleaseWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(release)
    }).catch(() => {});
  }

  return release;
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "carbonflow-release-api" });
});

app.post("/webhooks/github", express.raw({ type: "application/json", limit: "50mb" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  if (!verifySignature(req, rawBody)) {
    return res.status(401).json({ ok: false, error: "invalid signature" });
  }
  const release = await persistRelease(JSON.parse(rawBody.toString("utf8")));
  res.status(202).json({ ok: true, release });
});

app.use(express.json({ limit: "50mb" }));

app.get("/v1/apps/:appName/versions", async (req, res) => {
  const appName = cleanSegment(req.params.appName, "app");
  const releasesFile = path.join(productsRoot, appName, "releases.json");
  const releases = await readJson(releasesFile, []);
  res.json({ ok: true, appName, releases });
});

app.get("/v1/apps/:appName/latest", async (req, res) => {
  const appName = cleanSegment(req.params.appName, "app");
  const platform = req.query.platform ? cleanSegment(req.query.platform, "any") : "";
  const currentVersion = req.query.version || "0.0.0";
  const releasesFile = path.join(productsRoot, appName, "releases.json");
  const releases = await readJson(releasesFile, []);
  const candidates = releases
    .filter((release) => release.status !== "draft")
    .filter((release) => !platform || !release.platform || release.platform === platform || release.platform === "any")
    .sort((a, b) => compareSemver(b.version, a.version));
  const latest = candidates[0] || null;
  res.json({
    ok: true,
    appName,
    currentVersion,
    updateAvailable: Boolean(latest && compareSemver(latest.version, currentVersion) > 0),
    latest
  });
});

app.get("/v1/download/:appName/:version/:fileName", async (req, res) => {
  const appName = cleanSegment(req.params.appName, "app");
  const version = cleanSegment(req.params.version, "0.0.0");
  const fileName = cleanSegment(req.params.fileName, "artifact.bin");
  const artifact = path.join(productsRoot, appName, version, fileName);
  res.download(artifact);
});

app.post("/v1/releases", requireToken, async (req, res) => {
  const release = await persistRelease(req.body);
  res.status(202).json({ ok: true, release });
});

app.listen(port, "0.0.0.0");
