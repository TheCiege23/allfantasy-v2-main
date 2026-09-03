/**
 * One place that answers "which country and state is this request from",
 * whichever edge happens to be in front of us.
 *
 * This logic used to exist twice — the same two `x-vercel-ip-*` reads in
 * `middleware.ts` and in `detectUserState.ts`. When production moved off Vercel
 * on 2026-09-02 both went blind in the same instant, every geo gate fell through
 * its `country === "US"` guard, and nothing anywhere said so. Two copies of one
 * rule is the bug; this module is the fix for that half.
 *
 * ⚠ The other half is not code. A header only exists if an edge sets it:
 *
 *   - Cloudflare sets `cf-ipcountry` on any proxied hostname. The region headers
 *     (`cf-region-code`) come from the "Add visitor location headers" managed
 *     transform, which has to be switched on separately.
 *   - A hostname pointed straight at the origin (grey-cloud / DNS-only) gets
 *     NOTHING, no matter what this file does.
 *
 * So `source: "unknown"` is a real and expected answer, and callers must decide
 * what it means for them rather than assuming it means "not restricted".
 *
 * Header-only and synchronous on purpose. This runs in middleware, on every
 * request; it must never make a network call.
 */

export type GeoHeaderSource = "cloudflare" | "vercel" | "unknown";

export interface EdgeGeo {
  /** ISO 3166-1 alpha-2, uppercased. `null` when no edge told us. */
  country: string | null;
  /** Subdivision code, uppercased — "WA", never "Washington". */
  regionCode: string | null;
  /** Which edge answered. "unknown" means no geo header was present at all. */
  source: GeoHeaderSource;
}

export const UNKNOWN_GEO: EdgeGeo = { country: null, regionCode: null, source: "unknown" };

/**
 * Cloudflare uses these in `cf-ipcountry` for "we could not place this client":
 * `XX` for unknown and `T1` for Tor. Both are present-but-meaningless, and
 * treating them as a country makes an unknown client look like a known one.
 */
const NON_COUNTRIES = new Set(["XX", "T1"]);

function read(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function normaliseCountry(value: string | null): string | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return NON_COUNTRIES.has(upper) ? null : upper;
}

/**
 * Some edges send the full subdivision path ("US-WA") rather than the bare
 * code. Keep the last segment so both spellings land on "WA".
 */
function normaliseRegion(value: string | null): string | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  const tail = upper.includes("-") ? upper.slice(upper.lastIndexOf("-") + 1) : upper;
  return tail === "" ? null : tail;
}

let warnedUnresolvable = false;

/**
 * Say once, per process, that geo enforcement has no signal to act on. Silence
 * is what let this run unnoticed; a line in the deploy log is what breaks that.
 * Deliberately not per-request — that would be one log line per hit.
 */
function warnOnce(): void {
  if (warnedUnresolvable) return;
  warnedUnresolvable = true;
  console.warn(
    "[geo] No edge geolocation header on this request " +
      "(looked for cf-ipcountry and x-vercel-ip-country). State restrictions " +
      "cannot be enforced until the serving hostname is proxied through an edge " +
      "that sets one. This is logged once per process.",
  );
}

/** Test seam. Nothing in production should need to reset this. */
export function __resetGeoHeaderWarning(): void {
  warnedUnresolvable = false;
}

/**
 * Resolve country and subdivision from whatever the current edge provides.
 *
 * Cloudflare is checked before Vercel because Cloudflare is where production
 * lives now; the Vercel branch is kept so a Vercel preview deployment still
 * enforces the same rules rather than quietly becoming an unrestricted mirror.
 */
export function resolveEdgeGeo(input: Request | Headers): EdgeGeo {
  const headers = input instanceof Headers ? input : input.headers;

  const cfCountry = normaliseCountry(read(headers, "cf-ipcountry"));
  if (cfCountry) {
    return {
      country: cfCountry,
      regionCode: normaliseRegion(read(headers, "cf-region-code")),
      source: "cloudflare",
    };
  }

  const vercelCountry = normaliseCountry(read(headers, "x-vercel-ip-country"));
  if (vercelCountry) {
    return {
      country: vercelCountry,
      regionCode: normaliseRegion(read(headers, "x-vercel-ip-country-region")),
      source: "vercel",
    };
  }

  warnOnce();
  return UNKNOWN_GEO;
}

/**
 * The one question every geo gate actually asks: which US state is this, if any?
 *
 * Returns `null` when the client is outside the US, or when no edge placed them.
 * Callers that care about the difference should read `resolveEdgeGeo().source`.
 */
export function resolveUsStateCode(input: Request | Headers): string | null {
  const geo = resolveEdgeGeo(input);
  if (geo.country !== "US") return null;
  return geo.regionCode;
}
