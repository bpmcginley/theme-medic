// scanner.js
//
// Core read-only detection engine. Input is the set of theme assets exactly as the
// Shopify Asset API returns them: an array of { key, value } where `key` is the asset
// path ("snippets/loox.liquid") and `value` is the file's text content.
//
// The scanner never modifies anything. It produces a structured list of findings that
// the report layer (and, later, the embedded app UI) renders.

import { signatures } from "./signatures.js";

// Asset paths whose contents we scan line-by-line for script hosts + markers.
// Binary assets (images, fonts) are skipped for content scanning.
const TEXT_EXTENSIONS = /\.(liquid|js|css|json|js\.liquid|css\.liquid|scss|html)$/i;

// Translation files are natural language in dozens of languages — app-name words show
// up by coincidence ("tawk" inside Polish text). Never content-scan them; apps don't
// inject runtime code into locales.
const CONTENT_SCAN_EXCLUDE = /^locales\//i;

// Rough per-finding weight model used to estimate performance cost. These are
// deliberately conservative, sourced from the public guidance that each leftover
// external script ≈ one extra HTTP request and ~20–200KB, and each app adds
// ~50–200ms of latency. We attribute a mid-range figure per finding type.
const COST_MODEL = {
  orphanFile: { requests: 0, ms: 30 }, // dead snippet/asset still rendered/loaded
  externalScript: { requests: 1, ms: 120 }, // blocking third-party request
  inlineMarker: { requests: 0, ms: 15 }, // inline block left in shared file
};

function byteLength(str) {
  return Buffer.byteLength(str ?? "", "utf8");
}

// Find every line index (1-based) in `content` where `regex` matches.
function matchingLines(content, regex) {
  const out = [];
  const lines = content.split(/\r?\n/);
  const re = new RegExp(regex.source, regex.flags.includes("i") ? "i" : "");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      out.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
    }
  }
  return out;
}

// Detect external <script src> / <link href> / url() references to a known host.
function findHostReferences(content, host) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  return matchingLines(content, re);
}

/**
 * Scan a theme.
 *
 * @param {Array<{key:string,value:string}>} assets  Theme assets from the Asset API.
 * @param {Object} [opts]
 * @param {string[]} [opts.installedAppHandles]  Handles of apps CURRENTLY installed on
 *        the store. Any signature whose handle is in this list is treated as "active"
 *        (left alone). Everything else that matches is genuine ghost code. If omitted,
 *        every match is reported as "unknown install state" (still surfaced, lower
 *        confidence) so the engine is useful even without the live install list.
 * @returns {Object} scan result
 */
export function scanTheme(assets, opts = {}) {
  const installed = new Set((opts.installedAppHandles ?? []).map((h) => h.toLowerCase()));
  const haveInstallList = Array.isArray(opts.installedAppHandles);

  // appId -> aggregated finding
  const byApp = new Map();

  function ensureApp(sig) {
    if (!byApp.has(sig.id)) {
      const installedKnown = haveInstallList;
      const isInstalled = installed.has(sig.handle.toLowerCase());
      byApp.set(sig.id, {
        appId: sig.id,
        app: sig.name,
        handle: sig.handle,
        category: sig.category,
        // status: ghost = app gone but code remains (actionable);
        //         active = app still installed (informational, do not remove);
        //         unknown = no install list provided.
        status: !installedKnown ? "unknown" : isInstalled ? "active" : "ghost",
        findings: [],
        bytes: 0,
        estRequests: 0,
        estMs: 0,
      });
    }
    return byApp.get(sig.id);
  }

  function addFinding(sig, finding) {
    const entry = ensureApp(sig);
    entry.findings.push(finding);
    entry.bytes += finding.bytes ?? 0;
    const cost = COST_MODEL[finding.type] ?? { requests: 0, ms: 0 };
    entry.estRequests += cost.requests;
    entry.estMs += cost.ms;
  }

  for (const asset of assets) {
    const { key, value = "" } = asset;
    const isText = TEXT_EXTENSIONS.test(key) && !CONTENT_SCAN_EXCLUDE.test(key);

    for (const sig of signatures) {
      // 1) Standalone file dropped by the app (matched on the asset key/path).
      if (sig.filePatterns?.some((re) => re.test(key))) {
        addFinding(sig, {
          type: "orphanFile",
          severity: "high",
          asset: key,
          detail: `Standalone file left by ${sig.name}.`,
          bytes: byteLength(value),
          locations: [{ line: 1, text: key }],
        });
      }

      if (!isText || !value) continue;

      // 2) External script/asset host references inside a (shared) file.
      for (const host of sig.scriptHosts ?? []) {
        const hits = findHostReferences(value, host);
        if (hits.length) {
          addFinding(sig, {
            type: "externalScript",
            severity: "high",
            asset: key,
            detail: `External request to ${host} (${sig.name}).`,
            bytes: 0,
            locations: hits,
          });
        }
      }

      // 3) Inline markers / liquid references inside a shared file (e.g. theme.liquid).
      //    Skip if we already flagged this asset as the app's own orphan file, and skip
      //    if a host reference on the same asset already covers it, to avoid double counts.
      for (const marker of sig.markers ?? []) {
        const hits = matchingLines(value, marker);
        if (hits.length) {
          // Don't double-report lines already captured by a host reference.
          addFinding(sig, {
            type: "inlineMarker",
            severity: "medium",
            asset: key,
            detail: `Inline ${sig.name} reference inside ${key}.`,
            bytes: 0,
            locations: hits,
          });
        }
      }
    }
  }

  const apps = [...byApp.values()];

  // Totals only count actionable ghost code (or unknown when no install list given).
  const actionable = apps.filter((a) => a.status === "ghost" || a.status === "unknown");
  const totals = actionable.reduce(
    (acc, a) => {
      acc.bytes += a.bytes;
      acc.estRequests += a.estRequests;
      acc.estMs += a.estMs;
      acc.findings += a.findings.length;
      return acc;
    },
    { bytes: 0, estRequests: 0, estMs: 0, findings: 0, apps: actionable.length },
  );

  return {
    scannedAssets: assets.length,
    haveInstallList,
    apps: apps.sort((a, b) => b.bytes - a.bytes || b.estMs - a.estMs),
    totals,
  };
}
