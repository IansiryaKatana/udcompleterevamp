#!/usr/bin/env node
/**
 * Finish remaining forensic fetches after denied nested fields were stripped.
 * Does not mutate Shopify.
 */
import { spawn } from "node:child_process";
import { executeQuery, writeJson, ensureDirs } from "./shopify-exec.mjs";

const FETCH = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\scripts\\fetch-all.mjs";

function runPhase(phase) {
  return new Promise((resolve) => {
    console.error(`\n######## phase ${phase} ########`);
    const child = spawn(process.execPath, [FETCH, "--phase", phase], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("close", resolve);
  });
}

await ensureDirs();
try {
  const { data } = await executeQuery({
    queryFile:
      "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\queries\\03-locations-markets.graphql",
  });
  await writeJson("shop/locations-markets.json", data);
  console.error("[locations] ok");
} catch (err) {
  console.error("[locations] failed:", String(err.message).slice(0, 400));
}

for (const phase of ["customers", "orders", "drafts", "remaining"]) {
  const code = await runPhase(phase);
  if (code !== 0) console.error(`[complete] ${phase} exited ${code}`);
}

console.error("\n[complete] remaining fetch finished");
