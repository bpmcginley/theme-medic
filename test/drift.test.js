// test/drift.test.js — drift detection correctness (no network).
// Run with: node test/drift.test.js

import { detectDrift } from "../src/drift.js";
import { buildScanRecord } from "../src/scan.js";

const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

// --- Case 1: a silent regression after an app install + auto-update ---------
const prev = {
  url: "https://store.com/",
  fetchedAt: "2026-06-01T00:00:00Z",
  score: 78,
  totalBytes: 1_800_000,
  requestCount: 90,
  lab: { lcp: 2200, cls: 0.02, tbt: 150, fcp: 1400 },
  field: null,
  apps: [
    { appId: "klaviyo", name: "Klaviyo", category: "email", bytes: 120_000, requests: 3, blockingMs: 40 },
    { appId: "loox", name: "Loox", category: "reviews", bytes: 90_000, requests: 2, blockingMs: 30 },
  ],
  hosts: ["static.klaviyo.com", "cdn.loox.io"],
};

const curr = {
  url: "https://store.com/",
  fetchedAt: "2026-06-08T00:00:00Z",
  score: 64, // -14
  totalBytes: 2_300_000, // +~490 KB
  requestCount: 110,
  lab: { lcp: 3100, cls: 0.09, tbt: 280, fcp: 1600 }, // LCP +900ms, CLS +0.07, TBT +130
  field: null,
  apps: [
    { appId: "klaviyo", name: "Klaviyo", category: "email", bytes: 120_000, requests: 3, blockingMs: 40 },
    { appId: "loox", name: "Loox", category: "reviews", bytes: 230_000, requests: 4, blockingMs: 90 }, // heavier
    { appId: "vitals", name: "Vitals", category: "all-in-one", bytes: 180_000, requests: 5, blockingMs: 120 }, // NEW
  ],
  hosts: ["static.klaviyo.com", "cdn.loox.io", "cdn.vitals.co"], // new host
};

const d = detectDrift(prev, curr);
const types = d.findings.map((f) => f.type);

ok(d.changed === true, "should detect drift");
ok(types.includes("page_weight"), "should flag page weight growth");
ok(types.includes("lcp"), "should flag LCP regression");
ok(types.includes("cls"), "should flag CLS regression");
ok(types.includes("tbt"), "should flag TBT regression");
ok(types.includes("score"), "should flag score drop");
ok(types.includes("app_added"), "should flag the new Vitals app");
ok(types.includes("app_heavier"), "should flag Loox getting heavier");
ok(types.includes("new_hosts"), "should flag the new cdn.vitals.co host");
ok(d.appsAdded.some((a) => a.appId === "vitals"), "appsAdded should include vitals");
ok(d.severity === "high", "overall severity should be high");
ok(d.deltas.scoreDelta === -14, "scoreDelta should be -14");
ok(d.deltas.lcpMsDelta === 900, "lcpMsDelta should be 900");

// --- Case 2: stable store, no meaningful drift ------------------------------
const stable = detectDrift(prev, {
  ...prev,
  fetchedAt: "2026-06-08T00:00:00Z",
  score: 77, // -1 (under threshold)
  totalBytes: 1_810_000, // +10 KB (under threshold)
  lab: { lcp: 2250, cls: 0.02, tbt: 155, fcp: 1410 },
});
ok(stable.changed === false, "stable store should report no drift");
ok(stable.severity === "none", "stable severity should be none");

// --- Case 3: buildScanRecord shape from a minimal snapshot ------------------
const rec = buildScanRecord(
  {
    finalUrl: "https://store.com/",
    fetchedAt: "2026-06-08T00:00:00Z",
    score: 80,
    totalBytes: 1000,
    requestCount: 5,
    lab: { lcp: 1000, cls: 0.01, tbt: 50, fcp: 800 },
    field: null,
    resources: [
      { url: "https://store.com/theme.js", bytes: 500 },
      { url: "https://cdn.loox.io/widget.js", bytes: 300 },
      { url: "https://cdn.shopify.com/s/files/x.js", bytes: 200 },
    ],
    thirdParty: [],
  },
  { apps: [{ appId: "loox", app: "Loox", category: "reviews", bytes: 300, requests: 1 }], unattributed: { bytes: 0 } },
);
ok(rec.hosts.includes("cdn.loox.io"), "record should capture third-party host cdn.loox.io");
ok(!rec.hosts.some((h) => h.includes("shopify")), "record should exclude Shopify first-party hosts");
ok(!rec.hosts.includes("store.com"), "record should exclude the store's own host");

// --- Report ----------------------------------------------------------------
console.log("Case 1 drift summary:", d.summary);
for (const f of d.findings) console.log(`  • [${f.severity}] ${f.message}`);
console.log("");
if (errors.length) {
  console.log("❌ DRIFT TESTS FAILED:");
  for (const e of errors) console.log("   - " + e);
  process.exit(1);
} else {
  console.log("✅ All drift tests passed.");
}
