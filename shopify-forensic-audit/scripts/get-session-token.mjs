/**
 * Obtain an Admin API token for the already-installed UD Sales Portal.
 * Uses client-credentials grant. Never logs the token.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const STORE = "c906ff-0a.myshopify.com";
const CLIENT_ID = "73722df23b9961b28c25bfcea5299104";
const APP_PATH = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\ud-sales-portal";
const TOKEN_FILE = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\raw\\.session-token.json";

function runShopify(args) {
  return new Promise((resolve) => {
    const child = spawn("shopify", args, {
      env: {
        ...process.env,
        SHOPIFY_CLI_AGENT_INFO: "n:cursor|v:none|p:xai|m:cursor-grok-4.6",
        SHOPIFY_FLAG_NO_UPDATE_NOTIFIER: "1",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function getClientSecret() {
  const { stdout, stderr, code } = await runShopify([
    "app",
    "env",
    "show",
    "--path",
    APP_PATH,
  ]);
  const text = `${stdout}\n${stderr}`;
  const match = text.match(/SHOPIFY_API_SECRET=(\S+)/);
  if (!match) {
    throw new Error(`Could not read app secret from CLI env show (exit ${code})`);
  }
  return match[1];
}

async function clientCredentials(secret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: secret,
  });
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  return { status: res.status, json };
}

const secret = await getClientSecret();
const result = await clientCredentials(secret);
await mkdir(path.dirname(TOKEN_FILE), { recursive: true });

if (result.json?.access_token) {
  await writeFile(
    TOKEN_FILE,
    JSON.stringify(
      {
        store: STORE,
        clientId: CLIENT_ID,
        obtainedAt: new Date().toISOString(),
        expiresIn: result.json.expires_in ?? null,
        scope: result.json.scope ?? null,
        access_token: result.json.access_token,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    JSON.stringify({
      ok: true,
      status: result.status,
      expiresIn: result.json.expires_in ?? null,
      scopeCount: result.json.scope ? String(result.json.scope).split(",").length : 0,
      tokenPrefix: String(result.json.access_token).slice(0, 6),
    }),
  );
} else {
  const safe = JSON.stringify(result.json).replaceAll(
    /shpss_[a-z0-9]+|shpat_[a-z0-9]+|shpca_[a-z0-9]+/gi,
    "[redacted]",
  );
  console.log(JSON.stringify({ ok: false, status: result.status, body: JSON.parse(safe) }));
}
