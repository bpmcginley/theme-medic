// test/scan-live.js
//
// Live M1 proof: run the metrics collector + attribution against a REAL public Shopify
// storefront and print the report a merchant would see in the free scan tool.
//
// Usage:  node test/scan-live.js [url] [--key=PSI_API_KEY]
// Default target is a well-known Shopify store.

import "dotenv/config";
import { collectMetrics } from "../src/metrics.js";
import { attributeResources } from "../src/attribute.js";

const arg = process.argv.find((a) => a.startsWith("http"));
const keyArg = process.argv.find((a) => a.startsWith("--key="));
const url = arg ?? "https://www.allbirds.com";
const apiKey = keyArg ? keyArg.slice("--key=".length) : process.env.PSI_API_KEY;

const ms = (n) => (n == null ? "n/a" : Math.round(n) + "ms");
const kb = (n) => (n == null ? "n/a" : (n / 1024).toFixed(0) + " KB");

console.log(`\nScanning ${url} (mobile)…  this can take 20–60s\n`);

try {
  const snap = await collectMetrics(url, { strategy: "mobile", apiKey, timeoutMs: 120000 });
  const attr = attributeResources(snap);

  console.log("═".repeat(60));
  console.log("  THEME MEDIC — Free Store Scan");
  console.log("═".repeat(60));
  console.log(`  URL:            ${snap.finalUrl}`);
  console.log(`  Perf score:     ${snap.score ?? "n/a"}/100`);
  console.log(`  Page weight:    ${kb(snap.totalBytes)}  (${snap.requestCount} requests)`);
  console.log("");
  console.log("  Lab Core Web Vitals:");
  console.log(`    LCP ${ms(snap.lab.lcp)}   CLS ${snap.lab.cls?.toFixed(3) ?? "n/a"}   TBT ${ms(snap.lab.tbt)}`);
  console.log(`    FCP ${ms(snap.lab.fcp)}   SpeedIndex ${ms(snap.lab.speedIndex)}`);
  if (snap.field) {
    console.log("");
    console.log(`  Real-user (CrUX) — overall: ${snap.field.overall ?? "n/a"}`);
    console.log(`    LCP ${ms(snap.field.lcp)}   CLS ${snap.field.cls?.toFixed(3) ?? "n/a"}   INP ${ms(snap.field.inp)}`);
  }
  console.log("═".repeat(60));
  console.log("");
  console.log("  Apps detected on this page (heaviest first):");
  if (!attr.apps.length) {
    console.log("    (no known app signatures matched the loaded resources)");
  }
  for (const a of attr.apps) {
    const block = a.blockingMs ? ` · ${a.blockingMs}ms blocking` : "";
    console.log(`    • ${a.app}  [${a.category}] — ${kb(a.bytes)}, ${a.requests} req${block}`);
  }
  if (attr.unattributed.bytes > 0) {
    console.log(`    • Other third-party scripts — ${kb(attr.unattributed.bytes)}`);
  }
  console.log("");
  console.log("─".repeat(60));
  console.log("  This is the FREE scan. The paid app re-runs this daily, tracks");
  console.log("  drift over time, and alerts you when an app update slows you down.");
  console.log("─".repeat(60));
} catch (err) {
  console.error("Scan failed:", err.message);
  console.error("\nIf this is a network/sandbox restriction, run it locally:");
  console.error("  node test/scan-live.js https://www.yourstore.com");
  process.exit(1);
}
