// metrics.js
//
// Metrics collector. Calls Google's PageSpeed Insights (PSI) API for a public store
// URL and normalizes the (large, messy) Lighthouse response into the few numbers we
// actually monitor: Core Web Vitals, total page weight, request count, and the list of
// network resources (which the attribution layer maps back to specific Shopify apps).
//
// PSI is free. It works without an API key at low volume (rate-limited); pass a key for
// production cadence. No theme access, no OAuth — it just loads the public page like a
// real visitor, which is exactly what makes the free scan tool possible.

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function runPageSpeed(url, { strategy = "mobile", apiKey, timeoutMs = 60000 } = {}) {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (apiKey) params.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PSI ${res.status}: ${body.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function audit(lh, id) {
  return lh?.audits?.[id]?.numericValue ?? null;
}

// Pull real-user (CrUX field) metrics when Google has enough traffic data for the URL.
function fieldMetrics(psi) {
  const m = psi?.loadingExperience?.metrics;
  if (!m) return null;
  const pick = (k) => (m[k]?.percentile ?? null);
  return {
    lcp: pick("LARGEST_CONTENTFUL_PAINT_MS"),
    cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null
      ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
      : null,
    inp: pick("INTERACTION_TO_NEXT_PAINT") ?? pick("EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT"),
    fcp: pick("FIRST_CONTENTFUL_PAINT_MS"),
    overall: psi.loadingExperience.overall_category ?? null, // FAST | AVERAGE | SLOW
  };
}

/**
 * Normalize a raw PSI response into the metric snapshot we store and compare over time.
 */
export function normalize(psi) {
  const lh = psi?.lighthouseResult;
  const score = lh?.categories?.performance?.score; // 0..1 or null

  const requests = lh?.audits?.["network-requests"]?.details?.items ?? [];
  const resources = requests.map((r) => ({
    url: r.url,
    type: r.resourceType ?? null,
    bytes: r.transferSize ?? 0,
  }));

  const thirdPartyItems = lh?.audits?.["third-party-summary"]?.details?.items ?? [];
  const thirdParty = thirdPartyItems.map((it) => ({
    entity: typeof it.entity === "string" ? it.entity : it.entity?.text ?? "Unknown",
    bytes: it.transferSize ?? 0,
    blockingMs: Math.round(it.blockingTime ?? 0),
  }));

  return {
    fetchedAt: new Date().toISOString(),
    finalUrl: lh?.finalUrl ?? lh?.requestedUrl ?? null,
    score: score == null ? null : Math.round(score * 100), // 0..100
    lab: {
      lcp: audit(lh, "largest-contentful-paint"),
      cls: audit(lh, "cumulative-layout-shift"),
      tbt: audit(lh, "total-blocking-time"),
      fcp: audit(lh, "first-contentful-paint"),
      speedIndex: audit(lh, "speed-index"),
      tti: audit(lh, "interactive"),
    },
    field: fieldMetrics(psi),
    totalBytes: audit(lh, "total-byte-weight"),
    requestCount: resources.length,
    resources,
    thirdParty,
  };
}

// Convenience: fetch + normalize in one call.
export async function collectMetrics(url, opts) {
  const psi = await runPageSpeed(url, opts);
  return normalize(psi);
}
