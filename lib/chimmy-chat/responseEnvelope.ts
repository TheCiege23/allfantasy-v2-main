/**
 * The shared Chimmy structured-response envelope. Every completed Chimmy answer — whether produced by the
 * default Anthropic pipeline or the PECR delegate — returns `{ content/response, meta }` where `meta`
 * carries a `schemaVersion`. The client validates that version and fails SAFE (renders text-only) when it
 * is unsupported or the meta is malformed, so a contract change can never make the chat unusable.
 *
 * SECURITY / trust boundary: `schemaVersion` and every evidence field (confidence, freshness, provider
 * status, source URLs, timestamps, entitlement/token results, league identity) are authored by
 * deterministic SERVER code. The model may write prose; it is never authoritative for these. This module
 * only stamps/validates the version — it never invents evidence.
 */
import type { ChimmyMessageMeta } from './types'

/** Current envelope version. Bump ONLY on a breaking `meta` shape change (older clients then fail safe). */
export const CHIMMY_SCHEMA_VERSION = '1'

/** Versions this client build knows how to render. */
const SUPPORTED_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([CHIMMY_SCHEMA_VERSION])

export function isSupportedChimmySchemaVersion(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_SCHEMA_VERSIONS.has(value)
}

/**
 * SERVER-ONLY: stamp the current schema version onto a server-built meta object. Returns the same shape
 * plus `schemaVersion`; adds/fabricates no evidence field. Idempotent (won't overwrite an existing
 * version). Safe on any meta-like object (the routes carry extra fields beyond `ChimmyMessageMeta`).
 */
export function stampChimmyMeta<T extends Record<string, unknown>>(
  meta: T | null | undefined,
): T & { schemaVersion: string } {
  const base = (meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : ({} as T))
  const existing = (base as Record<string, unknown>).schemaVersion
  return {
    ...base,
    schemaVersion: typeof existing === 'string' && existing.length > 0 ? existing : CHIMMY_SCHEMA_VERSION,
  }
}

/**
 * CLIENT-SIDE gate: whether an incoming meta envelope may be rendered as structured content.
 *  - `null`/absent meta → true (there's simply nothing structured to render; text-only is correct).
 *  - present WITH a `schemaVersion` → must be a SUPPORTED version, else false (fail safe → text-only).
 *  - present WITHOUT a `schemaVersion` → true (legacy meta; render best-effort for back-compat).
 *  - non-object (malformed) → false.
 */
export function isRenderableChimmyEnvelope(meta: unknown): boolean {
  if (meta == null) return true
  if (typeof meta !== 'object' || Array.isArray(meta)) return false
  const version = (meta as Record<string, unknown>).schemaVersion
  if (version === undefined) return true
  return isSupportedChimmySchemaVersion(version)
}

/**
 * CLIENT-SIDE: normalize a `missingInformation` value off an untrusted payload into a clean string[] (or
 * undefined). Used to distinguish "metadata omitted" from a "verified empty" list.
 */
export function normalizeMissingInformation(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
  return items.length > 0 ? items : undefined
}

export type { ChimmyMessageMeta }
