/**
 * Single source of truth for "which database does this connection string point at".
 *
 * WHY THIS EXISTS
 * The previous guard keyed on a single host substring, `PROD_HOST_MARKER =
 * "ep-spring-tooth"`. That endpoint is the `claude-dashboard-local-dev` FORK; production
 * is `ep-curly-block-ad0dlt9o`. The guard therefore refused a safe target and permitted
 * the dangerous one — it failed OPEN against real production while looking like a
 * working safety check.
 *
 * WHY HOST ALONE CANNOT WORK HERE
 * Production and the dev shadow share the SAME Neon compute:
 *   ep-curly-block-ad0dlt9o / neondb        -> PRODUCTION
 *   ep-curly-block-ad0dlt9o / mydb_shadow   -> safe dev
 * Only the database NAME separates them.
 *
 * WHY DATABASE NAME ALONE CANNOT WORK EITHER
 * `neondb` is not unique to production — staging, test and redraft-test all use it:
 *   ep-winter-salad-ad34lce8 / neondb        -> staging
 *   ep-muddy-leaf-adigvvph / neondb          -> test
 *   ep-sparkling-mountain-ads99f9t / neondb  -> redraft-test
 * Refusing on the name alone would block all three and still not identify production.
 *
 * So identity is the (endpoint, database) PAIR, and anything not recognised is treated
 * as UNKNOWN and refused — the failure mode that bit us was a guard that allowed what it
 * did not recognise.
 */

/** Production is this endpoint AND this database. Neither half identifies it alone. */
const PRODUCTION_ENDPOINT = "ep-curly-block-ad0dlt9o";
const PRODUCTION_DATABASE = "neondb";

/**
 * Positive allowlist. Only what has been verified against a real env file belongs here —
 * an entry added from memory rather than evidence is how a guard silently goes stale, which
 * is the exact bug this module replaces. Unlisted targets fail closed; add them deliberately.
 */
const KNOWN_SAFE_TARGETS = [
  { endpoint: "ep-curly-block-ad0dlt9o", database: "mydb_shadow", label: "dev shadow (shares production's compute)" },
  { endpoint: "ep-winter-salad-ad34lce8", database: "neondb", label: "staging" },
  { endpoint: "ep-muddy-leaf-adigvvph", database: "neondb", label: "test" },
  { endpoint: "ep-sparkling-mountain-ads99f9t", database: "neondb", label: "redraft-test" },
];

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Normalise a Neon host to its endpoint id: both
 * `ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech` and its `-pooler` variant
 * resolve to `ep-curly-block-ad0dlt9o`, because pooled and direct URLs are the same
 * database and must not be classified differently.
 */
function endpointOf(hostname) {
  const first = String(hostname || "").split(".")[0] || "";
  return first.replace(/-pooler$/, "");
}

/** Parse a Postgres URL into { hostname, endpoint, database } without exposing credentials. */
function parseTarget(url) {
  if (!url || typeof url !== "string") return null;
  try {
    // The URL class does not understand the postgres: scheme's defaults; swap to http:
    // purely for parsing. Nothing is ever connected to.
    const parsed = new URL(url.trim().replace(/^postgres(ql)?:\/\//i, "http://"));
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("?")[0];
    return {
      hostname: parsed.hostname,
      endpoint: endpointOf(parsed.hostname),
      database: database || "",
    };
  } catch {
    return null;
  }
}

/**
 * Classify a connection string.
 *
 * @returns {{kind: "production"|"safe"|"unknown"|"unparseable", label: string,
 *            endpoint: string|null, database: string|null, hostname: string|null}}
 */
function identifyTarget(url) {
  const parsed = parseTarget(url);
  if (!parsed) {
    return { kind: "unparseable", label: "unparseable connection string", endpoint: null, database: null, hostname: null };
  }

  const base = { endpoint: parsed.endpoint, database: parsed.database, hostname: parsed.hostname };

  if (parsed.endpoint === PRODUCTION_ENDPOINT && parsed.database === PRODUCTION_DATABASE) {
    return { kind: "production", label: "PRODUCTION", ...base };
  }

  if (LOCAL_HOSTNAMES.has(parsed.hostname)) {
    return { kind: "safe", label: "local database", ...base };
  }

  const match = KNOWN_SAFE_TARGETS.find(
    (t) => t.endpoint === parsed.endpoint && t.database === parsed.database,
  );
  if (match) {
    return { kind: "safe", label: match.label, ...base };
  }

  return { kind: "unknown", label: "unrecognised target", ...base };
}

/** True only for a target positively identified as production. */
function isProductionTarget(url) {
  return identifyTarget(url).kind === "production";
}

/** Human-readable, credential-free description for log lines and refusal messages. */
function describeTarget(url) {
  const t = identifyTarget(url);
  if (t.kind === "unparseable") return t.label;
  return `${t.endpoint}/${t.database} (${t.label})`;
}

module.exports = {
  PRODUCTION_ENDPOINT,
  PRODUCTION_DATABASE,
  KNOWN_SAFE_TARGETS,
  endpointOf,
  parseTarget,
  identifyTarget,
  isProductionTarget,
  describeTarget,
};

// CLI: `node scripts/db-target-identity.cjs` reports what the CURRENT env resolves to,
// without connecting to anything. Run it before any migration — this entire bug class is
// someone not knowing which database they were pointed at.
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");

  const envPath = path.join(process.cwd(), ".env");
  const fromFile = (key) => {
    if (!fs.existsSync(envPath)) return null;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.startsWith(`${key}=`)) continue;
      return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    }
    return null;
  };

  // Same precedence the Prisma CLI uses, so this reports what Prisma would actually hit.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || fromFile("DIRECT_URL") || fromFile("DATABASE_URL");
  const target = identifyTarget(url);

  console.log(`Resolved target: ${describeTarget(url)}`);
  console.log(`Classification : ${target.kind}`);

  if (target.kind === "production") {
    console.log("\n🛑 This is PRODUCTION. Interactive Prisma commands are refused unless ALLOW_PROD_MIGRATION=1.");
  } else if (target.kind === "safe") {
    console.log("\n✅ Safe target — migrations here do not touch production data.");
  } else {
    console.log("\n⚠️  Unrecognised target. Guards fail closed on this; add it to KNOWN_SAFE_TARGETS if it is safe.");
  }

  process.exit(target.kind === "production" ? 2 : 0);
}
