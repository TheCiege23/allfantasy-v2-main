/**
 * READ-ONLY. Reports the recent `sync_job_runs` rows for the Decision OS activity-ingest cron.
 *
 * Exists because the obvious way to check this — pasting SQL into a shell — silently does the
 * wrong thing twice on Windows: PowerShell parses a bare `SELECT` as its `Select-Object` alias,
 * and `psql "$DIRECT_URL"` does not expand the way it does in bash, so psql falls back to
 * localhost and "connects" to something that is not production at all.
 *
 * Usage (from the repo root):
 *   node scripts/check-activity-ingest-runs.cjs
 *
 * It prints which database it resolved BEFORE connecting, via the same
 * `db-target-identity.cjs` used by the write guards, so there is never any doubt about which
 * environment the numbers came from. It issues a single SELECT and nothing else.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { describeTarget, isProductionTarget } = require("./db-target-identity.cjs");

const JOB_NAME = "cron-decision-os-activity-ingest";

/**
 * `started_at` / `completed_at` are `timestamp WITHOUT time zone` holding UTC. node-pg hands
 * those back as JS Dates interpreted in the LOCAL zone, so calling `.toISOString()` on one
 * silently shifts it by the machine's offset — on a UTC-4 box a 07:00 UTC cron renders as
 * "11:00Z" and looks like it runs on a schedule it does not have. Format the parts directly
 * instead of round-tripping through the local zone.
 */
function fmt(value) {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}Z`
  );
}

/** Minimal .env reader — avoids pulling dotenv in and avoids merging multiple env files. */
function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

async function main() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, "..", ".env.local");
  const url =
    readEnvValue(envFile, "DIRECT_URL") || readEnvValue(envFile, "DATABASE_URL");

  if (!url) {
    console.error(`No DIRECT_URL or DATABASE_URL found in ${envFile}`);
    process.exit(1);
  }

  // Say what we are about to touch before touching it. Never print the URL itself — it carries
  // the credential.
  console.log(`env file : ${envFile}`);
  console.log(`target   : ${describeTarget(url)}`);
  console.log(`production? ${isProductionTarget(url) ? "YES" : "no"}`);
  console.log("mode     : READ-ONLY (single SELECT)\n");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT status, rows_read, rows_written, started_at, completed_at, duration_ms, error_message
         FROM sync_job_runs
        WHERE job_name = $1
        ORDER BY started_at DESC
        LIMIT 12`,
      [JOB_NAME],
    );

    if (rows.length === 0) {
      console.log(`No runs recorded for ${JOB_NAME}.`);
      return;
    }

    for (const r of rows) {
      const done = r.completed_at ? fmt(r.completed_at) : "— never completed —";
      console.log(
        `${String(r.status).padEnd(8)} read=${String(r.rows_read).padStart(5)} ` +
          `written=${String(r.rows_written).padStart(6)} ` +
          `started=${fmt(r.started_at)} done=${done}` +
          (r.duration_ms == null ? "" : ` (${r.duration_ms}ms)`),
      );
      if (r.error_message) console.log(`         └─ ${String(r.error_message).slice(0, 160)}`);
    }

    const stuck = rows.filter((r) => r.status === "running" && r.completed_at === null).length;
    console.log(`\n${stuck} of the ${rows.length} shown are still 'running' with no completed_at.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Never surface the connection string on failure — it embeds the password.
  console.error(`Query failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
