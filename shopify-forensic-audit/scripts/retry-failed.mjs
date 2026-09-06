#!/usr/bin/env node
/**
 * Retry failed forensic phases after removing denied fields.
 */
import { spawn } from "node:child_process";

const phases = ["catalog", "customers", "orders", "drafts"];
for (const phase of phases) {
  console.error(`\n######## retry ${phase} ########`);
  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\scripts\\fetch-all.mjs", "--phase", phase],
      { stdio: "inherit", windowsHide: true },
    );
    child.on("close", resolve);
  });
  if (code !== 0) console.error(`[retry] ${phase} exited ${code}`);
}

const loc = await import("./shopify-exec.mjs");
await loc.ensureDirs();
try {
  const { data } = await loc.executeQuery({
    queryFile: "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\queries\\03-locations-markets.graphql",
  });
  await loc.writeJson("shop/locations-markets.json", data);
  console.error("[locations] ok");
} catch (err) {
  console.error("[locations] failed:", err.message.slice(0, 300));
}
