// report.js
//
// Turns a scan result into a human-readable summary. The embedded app UI will render
// this data as React/Polaris components later; this plain-text formatter is for the
// engine demo and for any CLI / email-digest use.

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + " KB";
}

const STATUS_LABEL = {
  ghost: "GHOST CODE (app uninstalled — safe to remove)",
  active: "active (app still installed — leave it)",
  unknown: "detected (install state unknown)",
};

export function formatReport(result) {
  const lines = [];
  const { totals } = result;

  lines.push("═".repeat(64));
  lines.push("  THEME MEDIC — Ghost Code Scan");
  lines.push("═".repeat(64));
  lines.push(`  Assets scanned:        ${result.scannedAssets}`);
  lines.push(`  Install list provided: ${result.haveInstallList ? "yes" : "no"}`);
  lines.push("");
  lines.push("  RECOVERABLE (ghost code):");
  lines.push(`    Apps with leftovers: ${totals.apps}`);
  lines.push(`    Total findings:      ${totals.findings}`);
  lines.push(`    Dead file weight:    ${kb(totals.bytes)}`);
  lines.push(`    Extra requests:      ~${totals.estRequests} per page load`);
  lines.push(`    Est. load time cost: ~${(totals.estMs / 1000).toFixed(2)}s`);
  lines.push("═".repeat(64));
  lines.push("");

  if (!result.apps.length) {
    lines.push("  No known app footprints found. Theme looks clean. ✓");
    return lines.join("\n");
  }

  for (const app of result.apps) {
    const tag =
      app.status === "ghost" ? "🗑️ " : app.status === "active" ? "✓ " : "? ";
    lines.push(`${tag}${app.app}  [${app.category}]`);
    lines.push(`    Status:   ${STATUS_LABEL[app.status]}`);
    lines.push(
      `    Impact:   ${kb(app.bytes)} dead weight · ~${app.estRequests} request(s) · ~${app.estMs}ms`,
    );
    for (const f of app.findings) {
      const where =
        f.locations && f.locations.length
          ? f.locations
              .slice(0, 3)
              .map((l) => `line ${l.line}`)
              .join(", ") + (f.locations.length > 3 ? `, +${f.locations.length - 3} more` : "")
          : "";
      lines.push(`      • [${f.severity}] ${f.detail}`);
      lines.push(`          ${f.asset}${where ? ` (${where})` : ""}`);
    }
    lines.push("");
  }

  lines.push("─".repeat(64));
  lines.push("  Next: Theme Medic duplicates your theme, then removes flagged");
  lines.push("  ghost code on the copy so you can preview before publishing.");
  lines.push("─".repeat(64));
  return lines.join("\n");
}
