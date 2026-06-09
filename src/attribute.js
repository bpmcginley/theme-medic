// attribute.js
//
// Bridges the metrics collector and the signature engine. PSI tells us WHICH resources
// loaded and how heavy/blocking they were; the signature DB tells us WHICH Shopify app
// each resource belongs to. Together: "Loox is loading 142KB and blocking the main
// thread for 310ms on your product page."
//
// This is the attribution that the incumbent uptime monitors don't do — they tell you
// the page is up, not which app is quietly dragging it down.

import { signatures } from "./signatures.js";

function hostMatches(url, host) {
  try {
    const h = new URL(url).hostname;
    return h === host || h.endsWith("." + host) || h.includes(host);
  } catch {
    return url.includes(host);
  }
}

/**
 * Attribute a metric snapshot's resources to known Shopify apps.
 *
 * @param {object} snapshot  Output of metrics.normalize().
 * @returns {{apps: Array, unattributed: object}}  Per-app weight/blocking + the leftover
 *          third-party total we couldn't map to a known app.
 */
export function attributeResources(snapshot) {
  const byApp = new Map();

  for (const res of snapshot.resources ?? []) {
    for (const sig of signatures) {
      if (!sig.scriptHosts?.length) continue;
      if (sig.scriptHosts.some((host) => hostMatches(res.url, host))) {
        if (!byApp.has(sig.id)) {
          byApp.set(sig.id, {
            appId: sig.id,
            app: sig.name,
            handle: sig.handle,
            category: sig.category,
            bytes: 0,
            requests: 0,
            sampleUrls: [],
          });
        }
        const e = byApp.get(sig.id);
        e.bytes += res.bytes ?? 0;
        e.requests += 1;
        if (e.sampleUrls.length < 3) e.sampleUrls.push(res.url);
        break; // a resource belongs to one app
      }
    }
  }

  // Fold in blocking time from PSI's third-party-summary where the entity name matches.
  for (const tp of snapshot.thirdParty ?? []) {
    for (const e of byApp.values()) {
      const appWord = e.app.split(/[\s:.‑-]/)[0].toLowerCase(); // e.g. "loox", "judge"
      if (appWord.length > 2 && tp.entity.toLowerCase().includes(appWord)) {
        e.blockingMs = (e.blockingMs ?? 0) + tp.blockingMs;
      }
    }
  }

  const apps = [...byApp.values()].sort((a, b) => b.bytes - a.bytes);
  const attributedBytes = apps.reduce((s, a) => s + a.bytes, 0);
  const totalThirdPartyBytes = (snapshot.thirdParty ?? []).reduce((s, t) => s + t.bytes, 0);

  return {
    apps,
    unattributed: {
      // third-party weight PSI saw that we couldn't map to a known app in our DB
      bytes: Math.max(0, totalThirdPartyBytes - attributedBytes),
      knownApps: apps.length,
    },
  };
}
