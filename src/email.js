// email.js
//
// Lead report email via Resend's HTTP API (no SDK dependency — just fetch). Gated on
// RESEND_API_KEY: when unset (no account created yet), it logs instead of sending, so
// the funnel is fully testable offline and starts sending the moment a key is added —
// mirrors the pattern already used in theme-medic-app/app/medic/email.server.js.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function reportHtml({ url, score, apps }) {
  const top = (apps || [])
    .slice()
    .sort((a, b) => b.weightKb - a.weightKb)
    .slice(0, 5);
  const rows = top
    .map((a) => `<li><strong>${a.name}</strong> — ${a.weightKb} KB, ${a.requests} request(s)</li>`)
    .join("");
  const scoreLine =
    score != null
      ? `<p>Your speed score: <strong>${score}/100</strong>.</p>`
      : "";
  const appsBlock = top.length
    ? `<p>Heaviest apps we found on your store:</p><ul>${rows}</ul>`
    : "<p>No known app signatures matched on this scan.</p>";

  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">Your Theme Medic scan results</h2>
      <p style="color:#555;margin:0 0 16px">${url}</p>
      ${scoreLine}
      ${appsBlock}
      <p style="margin-top:20px">Re-scan any time at <a href="https://theme-medic-scan.onrender.com">theme-medic-scan.onrender.com</a>. The Shopify app re-runs this automatically every day and emails you the moment a new app leaves dead code behind — we'll let you know the day it's live.</p>
      <p style="color:#999;font-size:12px">You're getting this because you requested your scan results at Theme Medic.</p>
    </div>`;
}

export function buildReportEmail({ url, score, apps }) {
  return {
    subject: score != null ? `Your store scored ${score}/100 — Theme Medic` : "Your Theme Medic scan results",
    html: reportHtml({ url, score, apps }),
    text: `${url}\n\nSpeed score: ${score ?? "n/a"}/100\n\nFull results: https://theme-medic-scan.onrender.com`,
  };
}

/**
 * Send a one-time "here's your scan report" email to a captured lead.
 * Returns { sent: boolean, reason?, id? }. No-ops (logs) when RESEND_API_KEY or a
 * from-address isn't configured yet.
 */
export async function sendReportEmail(to, { url, score, apps }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL; // e.g. "Theme Medic <hello@thememedic.app>"
  const msg = buildReportEmail({ url, score, apps });

  if (!key || !from) {
    console.log(`[email] (not configured) would send to ${to}: ${msg.subject}`);
    return { sent: false, reason: "email not configured" };
  }
  if (!to) return { sent: false, reason: "no recipient" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] send failed ${res.status}: ${body.slice(0, 200)}`);
      return { sent: false, reason: `resend ${res.status}` };
    }
    const json = await res.json().catch(() => ({}));
    return { sent: true, id: json.id };
  } catch (err) {
    console.error("[email] error:", err.message);
    return { sent: false, reason: err.message };
  }
}
