// drift.js
//
// The recurring core. Given the previous and current scan records for a store page,
// detect meaningful regressions ("drift") and attribute them to specific apps. This is
// what the daily monitor runs, and what the alert email is built from.
//
// Incumbent uptime monitors answer "is it up?" — this answers "is it quietly getting
// slower/heavier, and which app did it?"

export const DEFAULT_THRESHOLDS = {
  weightPctUp: 0.10, // page weight grew >10%
  weightKbUp: 100, // ...or >100 KB absolute
  lcpPctUp: 0.15, // LCP got >15% worse
  lcpMsUp: 300, // ...or >300 ms absolute
  tbtMsUp: 100, // total blocking time grew >100 ms
  clsUp: 0.05, // CLS got >0.05 worse
  scoreDown: 5, // performance score dropped >5 points
};

const kb = (b) => Math.round((b || 0) / 1024);

// A regression in either relative OR absolute terms (both must be "worse" by enough).
function worse(prev, curr, pctThresh, absThresh) {
  if (prev == null || curr == null) return false;
  const delta = curr - prev;
  if (delta <= 0) return false;
  const pct = prev > 0 ? delta / prev : Infinity;
  return pct >= pctThresh || delta >= absThresh;
}

/**
 * @param {object} prev  Previous scan record (from buildScanRecord).
 * @param {object} curr  Current scan record.
 * @param {object} [thresholds]
 * @returns {{changed:boolean, severity:string, findings:Array, summary:string,
 *           appsAdded:Array, appsRemoved:Array, deltas:object}}
 */
export function detectDrift(prev, curr, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const findings = [];

  // --- Metric regressions -------------------------------------------------
  if (worse(prev.totalBytes, curr.totalBytes, t.weightPctUp, t.weightKbUp * 1024)) {
    findings.push({
      type: "page_weight",
      severity: "high",
      message: `Page weight grew ${kb(curr.totalBytes - prev.totalBytes)} KB (${kb(prev.totalBytes)} → ${kb(curr.totalBytes)} KB).`,
    });
  }
  if (worse(prev.lab?.lcp, curr.lab?.lcp, t.lcpPctUp, t.lcpMsUp)) {
    findings.push({
      type: "lcp",
      severity: "high",
      message: `LCP got ${Math.round(curr.lab.lcp - prev.lab.lcp)} ms slower (${Math.round(prev.lab.lcp)} → ${Math.round(curr.lab.lcp)} ms).`,
    });
  }
  if (worse(prev.lab?.tbt, curr.lab?.tbt, Infinity, t.tbtMsUp)) {
    findings.push({
      type: "tbt",
      severity: "medium",
      message: `Main-thread blocking grew ${Math.round(curr.lab.tbt - prev.lab.tbt)} ms (${Math.round(prev.lab.tbt)} → ${Math.round(curr.lab.tbt)} ms).`,
    });
  }
  if (worse(prev.lab?.cls, curr.lab?.cls, Infinity, t.clsUp)) {
    findings.push({
      type: "cls",
      severity: "medium",
      message: `Layout shift (CLS) worsened ${(curr.lab.cls - prev.lab.cls).toFixed(3)} (${prev.lab.cls.toFixed(3)} → ${curr.lab.cls.toFixed(3)}).`,
    });
  }
  if (prev.score != null && curr.score != null && prev.score - curr.score >= t.scoreDown) {
    findings.push({
      type: "score",
      severity: "high",
      message: `Performance score dropped ${prev.score - curr.score} points (${prev.score} → ${curr.score}).`,
    });
  }

  // --- App / third-party changes (the attribution edge) -------------------
  const prevApps = new Map((prev.apps ?? []).map((a) => [a.appId, a]));
  const currApps = new Map((curr.apps ?? []).map((a) => [a.appId, a]));

  const appsAdded = [...currApps.values()].filter((a) => !prevApps.has(a.appId));
  const appsRemoved = [...prevApps.values()].filter((a) => !currApps.has(a.appId));

  for (const a of appsAdded) {
    findings.push({
      type: "app_added",
      severity: "high",
      appId: a.appId,
      message: `New app loading: ${a.name} (+${kb(a.bytes)} KB, ${a.requests} request(s)${a.blockingMs ? `, ${a.blockingMs} ms blocking` : ""}).`,
    });
  }
  // An app that got materially heavier between scans (silent auto-update).
  for (const a of currApps.values()) {
    const before = prevApps.get(a.appId);
    if (before && worse(before.bytes, a.bytes, 0.2, 60 * 1024)) {
      findings.push({
        type: "app_heavier",
        severity: "medium",
        appId: a.appId,
        message: `${a.name} got heavier: +${kb(a.bytes - before.bytes)} KB (likely an auto-update).`,
      });
    }
  }

  // New third-party hosts that aren't already explained by a named app.
  const prevHosts = new Set(prev.hosts ?? []);
  const newHosts = (curr.hosts ?? []).filter((h) => !prevHosts.has(h));
  if (newHosts.length) {
    findings.push({
      type: "new_hosts",
      severity: "low",
      message: `New third-party domain(s) appeared: ${newHosts.slice(0, 5).join(", ")}${newHosts.length > 5 ? ` +${newHosts.length - 5} more` : ""}.`,
    });
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const severity = findings.reduce(
    (s, f) => (severityRank[f.severity] > severityRank[s] ? f.severity : s),
    "low",
  );

  const summary = findings.length
    ? `${findings.length} change(s) detected on ${curr.url} — ${findings.filter((f) => f.severity === "high").length} high priority.`
    : `No significant drift on ${curr.url}.`;

  return {
    changed: findings.length > 0,
    severity: findings.length ? severity : "none",
    findings,
    appsAdded,
    appsRemoved,
    deltas: {
      scoreDelta: prev.score != null && curr.score != null ? curr.score - prev.score : null,
      weightKbDelta: kb(curr.totalBytes) - kb(prev.totalBytes),
      lcpMsDelta:
        prev.lab?.lcp != null && curr.lab?.lcp != null
          ? Math.round(curr.lab.lcp - prev.lab.lcp)
          : null,
    },
    summary,
  };
}
