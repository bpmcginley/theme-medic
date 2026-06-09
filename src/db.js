// db.js
//
// Persistence for the free scan tool, designed to run on a $0 host with NO disk.
//
//   • Scan cache  → in-memory (PSI results; losing them on restart is harmless).
//   • Leads       → Postgres when DATABASE_URL is set (free Neon tier persists across
//                   restarts/redeploys); otherwise an in-memory fallback so local dev
//                   and a key-only first deploy still work (leads just aren't durable
//                   until you point DATABASE_URL at a real DB).
//
// No native dependencies — deploys cleanly on any free tier.

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

// ---- Scan cache (in-memory, 1h TTL) ----------------------------------------
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // url -> { at, data }

export function getCachedScan(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.data;
}

export function putCachedScan(url, data) {
  cache.set(url, { at: Date.now(), data });
}

// ---- Leads (Postgres or in-memory fallback) --------------------------------
let pool = null;
const memLeads = [];

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  // Ensure schema once on startup.
  pool
    .query(
      `CREATE TABLE IF NOT EXISTS leads (
         id          SERIAL PRIMARY KEY,
         email       TEXT NOT NULL,
         store_url   TEXT,
         perf_score  INTEGER,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .catch((e) => console.error("Lead table init failed:", e.message));
} else {
  console.warn("[db] DATABASE_URL not set — leads kept in memory only (not durable).");
}

export async function saveLead({ email, storeUrl, perfScore }) {
  if (pool) {
    const { rows } = await pool.query(
      "INSERT INTO leads (email, store_url, perf_score) VALUES ($1, $2, $3) RETURNING id",
      [email, storeUrl ?? null, perfScore ?? null],
    );
    return rows[0].id;
  }
  memLeads.push({ email, storeUrl, perfScore, at: new Date().toISOString() });
  return memLeads.length;
}

export function leadsDurable() {
  return Boolean(pool);
}

export async function leadCount() {
  if (pool) {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM leads");
    return rows[0].n;
  }
  return memLeads.length;
}
