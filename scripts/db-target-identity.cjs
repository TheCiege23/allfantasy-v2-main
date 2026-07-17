/**
 * Single source of truth for "which database is this URL pointing at, and is it production?"
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The previous design was a single `PROD_HOST_MARKER` string compared with
 * `host.includes(marker)`, copy-pasted into ~20 scripts. It failed twice, and the
 * second failure was dangerous: on 2026-07-14 the marker was set to the WRONG
 * endpoint, so every guard refused the dev clone and *permitted real production*.
 *
 * The copy-paste was not the root cause. The root cause is that
 * `refuse if host === PROD` FAILS OPEN: any host the marker does not match is
 * permitted, so one wrong string silently converts every guard into a no-op
 * against the one database it exists to protect.
 *
 * This module inverts that. A target is permitted only if it is explicitly
 * recognised as non-production; anything unrecognised is treated as production
 * and refused. Getting the table wrong now fails SAFE (dev gets refused — noisy
 * and obvious) instead of fatally (prod gets written — silent).
 *
 * ── WHY host ALONE IS NOT ENOUGH ─────────────────────────────────────────────
 * Local dev runs on the SAME COMPUTE as production and is isolated only by
 * DATABASE NAME:
 *   ep-curly-block-ad0dlt9o / neondb       -> PRODUCTION      (1075 MB, 26.8M commits)
 *   ep-curly-block-ad0dlt9o / mydb_shadow  -> safe local dev  (56 MB, same compute)
 * A host-only guard must therefore either permit production or break local dev.
 * It cannot do both. Every classification here is keyed on (endpoint, database).
 *
 * ── VERIFIED 2026-07-17 (Neon project icy-field-51189449) ────────────────────
 * Not from the console UI — that is what was misread on 07-14. Three independent
 * signals, all agreeing:
 *   ep-curly-block-ad0dlt9o  -> br-withered-shadow-adur64u9
 *                               name "production", primary:true, default:true, no parent
 *                               pg_stat_database(neondb): 26,873,733 xact_commit / 3.18B tup_returned
 *   ep-spring-tooth-adaoi9x1 -> br-restless-unit-adhut4n4
 *                               name "claude-dashboard-local-dev", primary:false, default:false
 *                               forked off production 2026-07-07
 *                               pg_stat_database(neondb): 126,892 xact_commit / 22.2M tup_returned
 *
 * `npm run db:verify-prod-identity` re-checks this table against the live Neon API
 * (primary/default branch flags) so the table cannot drift a third time unnoticed.
 *
 * CommonJS with no dependencies on purpose: `prisma-cli-guard.cjs` and
 * `prisma-migrate-deploy.cjs` run under bare `node` (no tsx) and must not be able
 * to fail to load. TypeScript callers use the typed facade in db-target-identity.ts.
 */

/**
 * Databases that ARE production. Matching one of these is absolute — no
 * acknowledgement env var can downgrade it.
 */
const PRODUCTION_TARGETS = [
  { endpoint: "ep-curly-block-ad0dlt9o", database: "neondb", note: "Neon branch 'production' (primary, default)" },
];

/**
 * Databases explicitly known to be safe. Anything NOT listed here (and not a
 * local host) is treated as production, so add entries deliberately.
 */
const NONPRODUCTION_TARGETS = [
  {
    endpoint: "ep-curly-block-ad0dlt9o",
    database: "mydb_shadow",
    note: "local dev — SAME COMPUTE as production, isolated only by database name",
  },
  {
    endpoint: "ep-spring-tooth-adaoi9x1",
    database: "neondb",
    note: "Neon branch 'claude-dashboard-local-dev' — a fork of production, not production",
  },
];

/** Hostnames that can never be a managed production database. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * Escape hatch for disposable Neon verification branches, which get a fresh random
 * endpoint id every time and so can never be pre-listed. Deliberately NOT a blanket
 * "skip the guard" flag: it must name the exact endpoint id being permitted, and it
 * is ignored for known production targets.
 */
const NONPROD_ACK_ENV = "AF_NONPROD_ENDPOINT_ACK";

/** @typedef {'production' | 'non-production' | 'unknown'} DbTargetClassification */

function stripQuotes(value) {
  const trimmed = String(value).trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Neon exposes one endpoint under several hostnames — the plain endpoint id, a
 * `-pooler` variant, and per-compute binding variants like `-llc` / `-g2g`. They are
 * all the same compute, so the endpoint id is the first host label with any of those
 * suffixes removed.
 */
function endpointIdFromHost(host) {
  const label = String(host).split(".")[0] || "";
  const match = label.match(/^(ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+)(?:-.*)?$/i);
  return match ? match[1].toLowerCase() : label.toLowerCase();
}

/**
 * Prefix match on a label boundary, never a bare `startsWith`: `ep-foo-bar-abc123`
 * must not match the distinct endpoint `ep-foo-bar-abc1234`.
 */
function endpointMatches(actualEndpoint, knownEndpoint) {
  if (!actualEndpoint) return false;
  const a = actualEndpoint.toLowerCase();
  const k = knownEndpoint.toLowerCase();
  return a === k || a.startsWith(`${k}-`);
}

/**
 * Parse a Postgres URL into the two things that identify a database.
 * Returns nulls rather than throwing — callers decide what an unparseable URL means
 * (every caller here treats it as "unknown", i.e. refuse).
 */
function parseTarget(url) {
  if (!url) return { host: null, endpointId: null, database: null };
  try {
    const parsed = new URL(stripQuotes(url).replace(/^postgres(ql)?:\/\//i, "http://"));
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || null;
    return {
      host: parsed.host.toLowerCase(),
      hostname: parsed.hostname.toLowerCase(),
      endpointId: endpointIdFromHost(parsed.hostname),
      database,
    };
  } catch {
    return { host: null, endpointId: null, database: null };
  }
}

/** Stable `endpoint/database` label for logs and error messages. Never includes credentials. */
function describeTarget(url) {
  const t = parseTarget(url);
  if (!t.host) return "<unparseable database url>";
  return `${t.endpointId || t.host}/${t.database || "?"}`;
}

/**
 * Classify a database URL.
 *
 * Order matters: production is checked FIRST and wins outright, so neither the
 * non-prod table nor the ack env var can ever downgrade a real production target.
 *
 * @param {string|null|undefined} url
 * @param {Record<string,string|undefined>} [env]
 * @returns {{classification: DbTargetClassification, host: string|null, endpointId: string|null, database: string|null, reason: string}}
 */
function classifyDatabaseTarget(url, env = process.env) {
  const { host, hostname, endpointId, database } = parseTarget(url);

  if (!url || !String(url).trim()) {
    return { classification: "unknown", host, endpointId, database, reason: "no database URL was provided" };
  }
  if (!host) {
    return { classification: "unknown", host, endpointId, database, reason: "database URL could not be parsed" };
  }

  for (const target of PRODUCTION_TARGETS) {
    if (endpointMatches(endpointId, target.endpoint) && database === target.database) {
      return {
        classification: "production",
        host,
        endpointId,
        database,
        reason: `${target.endpoint}/${target.database} is PRODUCTION — ${target.note}`,
      };
    }
  }

  if (LOCAL_HOSTS.includes(hostname)) {
    return { classification: "non-production", host, endpointId, database, reason: `${hostname} is a local host` };
  }

  for (const target of NONPRODUCTION_TARGETS) {
    if (endpointMatches(endpointId, target.endpoint) && database === target.database) {
      return {
        classification: "non-production",
        host,
        endpointId,
        database,
        reason: `${target.endpoint}/${target.database} is known non-production — ${target.note}`,
      };
    }
  }

  const ack = env && env[NONPROD_ACK_ENV] ? stripQuotes(env[NONPROD_ACK_ENV]) : null;
  if (ack && endpointId && endpointMatches(endpointId, ack)) {
    return {
      classification: "non-production",
      host,
      endpointId,
      database,
      reason: `${NONPROD_ACK_ENV} explicitly acknowledges endpoint ${endpointId} as non-production`,
    };
  }

  // Fail closed. An endpoint nobody listed is an endpoint nobody has verified.
  return {
    classification: "unknown",
    host,
    endpointId,
    database,
    reason:
      `${endpointId || host}/${database || "?"} is not a recognised target. ` +
      `Treating it as PRODUCTION because this guard fails closed. If it really is a disposable ` +
      `non-prod branch, set ${NONPROD_ACK_ENV}=${endpointId || "<endpoint-id>"} for this run, or add it ` +
      `to NONPRODUCTION_TARGETS in scripts/db-target-identity.cjs if it is permanent.`,
  };
}

/** True only for a verified production target. Do not use to decide whether writing is safe. */
function isProductionTarget(url, env = process.env) {
  return classifyDatabaseTarget(url, env).classification === "production";
}

/**
 * The predicate destructive callers should gate on: everything that is not
 * positively known to be safe, including unparseable and unrecognised targets.
 */
function isProductionOrUnknownTarget(url, env = process.env) {
  return classifyDatabaseTarget(url, env).classification !== "non-production";
}

/**
 * Throw unless `url` is a verified non-production database.
 * @returns {{host: string, endpointId: string|null, database: string|null}}
 */
function assertNonProductionTarget(url, options = {}) {
  const { env = process.env, action = "This command writes data and must never touch production." } = options;
  const result = classifyDatabaseTarget(url, env);
  if (result.classification === "non-production") {
    return { host: result.host, endpointId: result.endpointId, database: result.database };
  }
  const label = result.classification === "production" ? "PRODUCTION" : "an UNRECOGNISED database";
  throw new Error(`REFUSING to run against ${label}: ${result.reason}\n${action}`);
}

module.exports = {
  PRODUCTION_TARGETS,
  NONPRODUCTION_TARGETS,
  LOCAL_HOSTS,
  NONPROD_ACK_ENV,
  parseTarget,
  describeTarget,
  endpointIdFromHost,
  endpointMatches,
  classifyDatabaseTarget,
  isProductionTarget,
  isProductionOrUnknownTarget,
  assertNonProductionTarget,
};
