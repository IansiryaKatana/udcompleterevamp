/**
 * List org apps via Shopify CLI session. Never prints tokens.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CONFIG = path.join(
  process.env.APPDATA,
  "shopify-cli-kit-nodejs",
  "Config",
  "config.json",
);

const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
const sessions = JSON.parse(cfg.sessionStore);
const account = sessions["accounts.shopify.com"][cfg.currentSessionId];
const identityToken = account.identity.accessToken;
const appTokens = Object.values(account.applications).map((a) => a.accessToken);
const tokens = [identityToken, ...appTokens];

const queries = [
  {
    name: "appsConnectionSearch",
    query: `query listApps($query: String) {
      appsConnection(query: $query, first: 50) {
        edges { node { id key activeRelease { version { name } } } }
      }
    }`,
    variables: { query: "title:Portal" },
  },
  {
    name: "appsConnectionAll",
    query: `query listApps {
      appsConnection(first: 50) {
        edges { node { id key activeRelease { version { name } } } }
      }
    }`,
    variables: {},
  },
  {
    name: "findOrgApps",
    query: `query FindOrganization($id: ID!, $title: String) {
      organizations(id: $id, first: 1) {
        nodes {
          id
          businessName
          apps(first: 50, title: $title) {
            nodes { id title apiKey }
          }
        }
      }
    }`,
    variables: { id: "124441422", title: "UD Sales Portal" },
  },
];

const endpoints = [
  "https://app.shopify.com/app_management/unstable/graphql.json",
  "https://partners.shopify.com/api/cli/graphql",
];

function sanitize(value) {
  return JSON.parse(
    JSON.stringify(value).replaceAll(
      /shpat_[a-zA-Z0-9]+|shprt_[a-zA-Z0-9]+|shpss_[a-zA-Z0-9]+|atkn_[^"\\]+/g,
      "[redacted]",
    ),
  );
}

const results = [];
for (const url of endpoints) {
  for (const [ti, token] of tokens.entries()) {
    for (const q of queries) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query: q.query, variables: q.variables }),
        });
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = { parseError: true, preview: text.slice(0, 240) };
        }
        results.push({
          url,
          tokenIndex: ti,
          query: q.name,
          status: res.status,
          body: sanitize(json),
        });
      } catch (err) {
        results.push({ url, tokenIndex: ti, query: q.name, error: err.message });
      }
    }
  }
}

const outDir = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\raw";
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, "app-discovery.json");
await writeFile(out, JSON.stringify(results, null, 2));

const hits = [];
for (const r of results) {
  const blob = JSON.stringify(r.body || {});
  if (/Sales|Portal|UD /i.test(blob) && !/parseError|errors/i.test(blob.slice(0, 80))) {
    hits.push(r);
  }
  const snippet = blob.slice(0, 120).replaceAll(/\s+/g, " ");
  console.log(`${r.status ?? r.error} ${r.query} ${r.url.replace("https://", "")} :: ${snippet}`);
}
console.log(`hits=${hits.length}`);
