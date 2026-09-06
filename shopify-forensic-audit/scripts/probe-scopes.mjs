import { readFile } from "node:fs/promises";

const t = JSON.parse(
  await readFile(
    "e:/work videos projects/UD revamp/shopify-forensic-audit/raw/.session-token.json",
    "utf8",
  ),
);

async function gql(query, variables) {
  const res = await fetch("https://c906ff-0a.myshopify.com/admin/api/2026-07/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": t.access_token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const install = await gql(`query {
  currentAppInstallation {
    id
    accessScopes { handle }
  }
}`);
const handles = (install.data?.currentAppInstallation?.accessScopes || [])
  .map((s) => s.handle)
  .sort();
console.log("INSTALLATION_SCOPES", handles.length);
console.log(handles.join("\n"));
if (install.errors) console.log("INSTALL_ERRORS", JSON.stringify(install.errors, null, 2));

const needed = [
  "read_publications",
  "read_payment_terms",
  "read_discounts",
  "read_files",
  "read_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
  "read_third_party_fulfillment_orders",
  "read_companies",
  "read_all_orders",
];
for (const s of needed) {
  console.log(`${s}=${handles.includes(s)}`);
}

const probes = {
  files: `query { files(first:1){ nodes { id } } }`,
  discounts: `query { discountNodes(first:1){ nodes { id } } }`,
  publications: `query { publications(first:1){ nodes { id } } }`,
  companies: `query { companies(first:1){ nodes { id } } }`,
  paymentTerms: `query { orders(first:1){ nodes { id paymentTerms { id paymentTermsName } } } }`,
  fulfillmentOrders: `query { orders(first:1){ nodes { id fulfillmentOrders(first:1){ nodes { id status } } } } }`,
  resourcePublications: `query { products(first:1){ nodes { id resourcePublications(first:1){ nodes { isPublished } } } } }`,
};
for (const [name, query] of Object.entries(probes)) {
  const json = await gql(query);
  const err = json.errors?.[0]?.message || null;
  console.log(`\n[${name}] ${err ? "DENIED: " + err.slice(0, 180) : "OK"}`);
}
