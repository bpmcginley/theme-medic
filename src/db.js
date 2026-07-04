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

// ---- Per-app attribution stats (Postgres or in-memory fallback) -----------
// Aggregated across every real (non-cached) scan, so the "measured impact" shown
// on /apps/:id pages is real data, not a guess — it just starts at n=0 and grows.
const memAppStats = new Map(); // appId -> { sampleCount, totalWeightKb, totalRequests, totalBlockingMs }

if (pool) {
  pool
    .query(
      `CREATE TABLE IF NOT EXISTS app_stats (
         app_id             TEXT PRIMARY KEY,
         sample_count       INTEGER NOT NULL DEFAULT 0,
         total_weight_kb    BIGINT NOT NULL DEFAULT 0,
         total_requests     BIGINT NOT NULL DEFAULT 0,
         total_blocking_ms  BIGINT NOT NULL DEFAULT 0,
         updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .catch((e) => console.error("app_stats table init failed:", e.message));
}

export async function recordAppStat({ appId, weightKb, requests, blockingMs }) {
  if (pool) {
    await pool.query(
      `INSERT INTO app_stats (app_id, sample_count, total_weight_kb, total_requests, total_blocking_ms)
       VALUES ($1, 1, $2, $3, $4)
       ON CONFLICT (app_id) DO UPDATE SET
         sample_count = app_stats.sample_count + 1,
         total_weight_kb = app_stats.total_weight_kb + $2,
         total_requests = app_stats.total_requests + $3,
         total_blocking_ms = app_stats.total_blocking_ms + $4,
         updated_at = now()`,
      [appId, weightKb ?? 0, requests ?? 0, blockingMs ?? 0],
    );
    return;
  }
  const cur = memAppStats.get(appId) ?? {
    sampleCount: 0,
    totalWeightKb: 0,
    totalRequests: 0,
    totalBlockingMs: 0,
  };
  cur.sampleCount += 1;
  cur.totalWeightKb += weightKb ?? 0;
  cur.totalRequests += requests ?? 0;
  cur.totalBlockingMs += blockingMs ?? 0;
  memAppStats.set(appId, cur);
}

export async function getAppStat(appId) {
  let row;
  if (pool) {
    const { rows } = await pool.query(
      "SELECT sample_count, total_weight_kb, total_requests, total_blocking_ms FROM app_stats WHERE app_id = $1",
      [appId],
    );
    if (!rows.length) return null;
    row = {
      sampleCount: rows[0].sample_count,
      totalWeightKb: Number(rows[0].total_weight_kb),
      totalRequests: Number(rows[0].total_requests),
      totalBlockingMs: Number(rows[0].total_blocking_ms),
    };
  } else {
    row = memAppStats.get(appId) ?? null;
  }
  if (!row || row.sampleCount === 0) return null;
  return {
    sampleCount: row.sampleCount,
    avgWeightKb: Math.round(row.totalWeightKb / row.sampleCount),
    avgRequests: Math.round(row.totalRequests / row.sampleCount),
    avgBlockingMs: Math.round(row.totalBlockingMs / row.sampleCount),
  };
}
