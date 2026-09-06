#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\raw\\metafield_definitions\\by-owner.json";
const OUT = "e:\\work videos projects\\UD revamp\\shopify-forensic-audit\\analysis";
const src = JSON.parse(await readFile(RAW, "utf8"));
const byOwner = src.data || src;
const rows = [];
for (const [ownerType, block] of Object.entries(byOwner)) {
  for (const n of block.nodes || []) {
    rows.push({
      ownerType,
      name: n.name,
      namespace: n.namespace,
      key: n.key,
      type: n.type?.name,
      description: n.description || "",
      metafieldsCount: n.metafieldsCount ?? 0,
      pinnedPosition: n.pinnedPosition,
      validations: (n.validations || []).map((v) => ({
        name: v.name,
        value: v.value,
      })),
      access: n.access,
      preserve: true,
    });
  }
}
rows.sort((a, b) => b.metafieldsCount - a.metafieldsCount);
const counts = {};
for (const r of rows) counts[r.ownerType] = (counts[r.ownerType] || 0) + 1;
await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, "metafield-definitions.json"),
  JSON.stringify({ fetchedAt: src.fetchedAt, definitionCount: rows.length, byOwnerCounts: counts, rows }, null, 2),
);
console.log(JSON.stringify({ definitionCount: rows.length, byOwnerCounts: counts }, null, 2));
for (const r of rows) {
  console.log(`${r.ownerType}\t${r.metafieldsCount}\t${r.namespace}.${r.key}\t${r.name}\t${r.type}`);
}
