import fs from "node:fs";
import path from "node:path";
import { publicDataPath } from "./paths";

/**
 * Writes catalog to a KV bulk upload JSON for: wrangler kv bulk put --binding=CATALOG
 */
async function main() {
  const catalogPath = publicDataPath("catalog.json");
  if (!fs.existsSync(catalogPath)) {
    throw new Error("Missing public/data/catalog.json — run pipeline first");
  }

  const catalog = fs.readFileSync(catalogPath, "utf-8");
  const bulk = [
    { key: "catalog:v1", value: catalog },
    {
      key: "meta:v1",
      value: JSON.stringify({
        publishedAt: new Date().toISOString(),
        version: "1.0.0",
      }),
    },
  ];

  // EPG (now/next guide) is optional — include it if the pipeline produced one
  const epgPath = publicDataPath("epg.json");
  if (fs.existsSync(epgPath)) {
    bulk.push({ key: "epg:v1", value: fs.readFileSync(epgPath, "utf-8") });
    console.log("[publish-kv] including epg:v1");
  }

  const out = path.join(publicDataPath(), "kv-bulk.json");
  fs.writeFileSync(out, JSON.stringify(bulk), "utf-8");
  console.log(`[publish-kv] Wrote ${out}`);
  console.log("[publish-kv] Deploy: npx wrangler kv bulk put public/data/kv-bulk.json --binding=CATALOG");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
