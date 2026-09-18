import { createHash } from 'node:crypto'

/**
 * Content validator for the `/live` payload, so an unchanged slate costs no body.
 *
 * The live screens poll every 20 seconds while a game is on and every 2 minutes
 * when none is. Before this, every one of those polls re-sent the entire payload
 * — every team name, logo URL, record, and every tie-in's player name, headshot
 * URL and league name — whether or not a single number had moved. This turns the
 * unchanged case into a 304 with no body at all.
 *
 * ⚠ IT SAVES BANDWIDTH, NOT SERVER WORK, AND THE DISTINCTION IS NOT PEDANTIC.
 * The payload has to be BUILT before it can be hashed, so the database reads and
 * the provider refresh happen either way. Anyone reading a 304 as "we skipped the
 * work" will draw the wrong conclusion from the next latency graph.
 *
 * ⚠ `fetchedAt` IS DELIBERATELY INSIDE THE HASH, NOT STRIPPED OUT OF IT. Stripping
 * it would make the validator match on a payload whose feed HAD been re-read, and
 * the client would then be holding fresh scores under a stale age label — or we
 * would have to shuttle the new timestamp out through a side-channel header to
 * repair it. Including it means a 304 asserts something simple and true: nothing
 * differs, the feed was not re-read, so the reader's "updated Ns ago" should keep
 * climbing. That is exactly what that label is documented to mean.
 */

/**
 * Key-sorted deep copy, so two payloads that say the same thing hash the same.
 *
 * ⚠ WITHOUT THIS THE VALIDATOR IS AT THE MERCY OF PROPERTY ORDER. `JSON.stringify`
 * emits keys in insertion order, so a refactor that moves one field up an object
 * literal changes every hash and silently retires the 304 — no error, no test
 * failure, just the full payload on every poll again and nobody any the wiser.
 *
 * Arrays keep their order: on this payload the order IS content. `games` is sorted
 * by leagues affected and `lockAlerts` by kickoff, and a reordered slate is a
 * different screen.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key]
      // `JSON.stringify` drops an undefined property, so counting it here would
      // make the hash disagree with the body it is supposed to validate.
      if (inner === undefined) continue
      out[key] = canonical(inner)
    }
    return out
  }
  return value
}

/**
 * A strong ETag for this payload, quoted per RFC 9110.
 *
 * Strong rather than weak (`W/`) because it is derived from the payload's full
 * content: two payloads sharing a validator are the same screen, not merely an
 * acceptable substitute for one another.
 */
export function livePayloadEtag(payload: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('base64url')
  return `"${digest}"`
}

/**
 * Whether the client already holds this exact payload.
 *
 * ⚠ HANDLES A LIST, BECAUSE `If-None-Match` IS ALLOWED TO BE ONE. A client may
 * send several validators, and a proxy may add its own; matching the raw header
 * against our tag with `===` fails the moment anything but our own single value
 * arrives, which turns every poll back into a full payload with nothing to show
 * that it happened.
 *
 * `*` matches any existing representation, which this always is.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const candidates = ifNoneMatch.split(',').map((part) => part.trim())
  if (candidates.includes('*')) return true
  return candidates.some((candidate) =>
    // A cache may downgrade ours to weak on the way back; the content it stands
    // for is identical either way, so compare on the opaque value.
    candidate.replace(/^W\//, '') === etag.replace(/^W\//, ''),
  )
}
