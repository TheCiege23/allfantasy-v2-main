/**
 * The Vercel Blob read-write token, resolved from either name Vercel may have created.
 *
 * 🛑 THIS IS DEBT, DELIBERATELY TAKEN, AND IT SHOULD BE REMOVED. It exists because a
 * Vercel Blob connection names its variables after a PREFIX chosen in the connect dialog:
 * `<PREFIX>_READ_WRITE_TOKEN`. The prefix `BLOB` was already occupied by a previous
 * connection's leftover `BLOB_STORE_ID` / `BLOB_WEBHOOK_PUBLIC_KEY`, so the working store
 * had to be connected as `BLOB1` — producing a correct, integration-managed token under a
 * name no code reads.
 *
 * Copying that value by hand into `BLOB_READ_WRITE_TOKEN` failed three times in a row
 * (quotes captured with the paste, a store id pasted instead of a token, and one case that
 * still returned "Access denied" with a value that tested clean locally). Reading the
 * integration-created variable directly removes the human step that kept failing.
 *
 * ⚠ THE REAL FIX IS ONE STORE AND ONE VARIABLE. Delete the orphaned `BLOB_*` variables
 * from the dead connection, reconnect the live store with the `BLOB` prefix, and then
 * delete this file and inline `process.env.BLOB_READ_WRITE_TOKEN` again. This repo already
 * carries the cost of exactly this pattern elsewhere — `CLAUDE.md` records FOUR spellings
 * of one Rolling Insights credential, and the wrong conclusions that drift produced twice.
 * One fallback with an expiry note is acceptable; a family of them is how that happened.
 *
 * ⚠ ORDER MATTERS. `BLOB_READ_WRITE_TOKEN` is checked first so that fixing the config
 * properly takes effect immediately and silently retires the fallback, rather than the
 * fallback continuing to win after the underlying problem is solved.
 */

/**
 * ⚠ WARN ONCE PER PROCESS WHEN THE FALLBACK IS CARRYING PRODUCTION.
 *
 * Silent debt is permanent debt. Without this, the day someone tidies the Vercel variables
 * is indistinguishable from any other day, and the only signal that this file is still
 * load-bearing would be someone reading it. A line in the server log means the removal
 * condition is observable: when it stops appearing, this module can be deleted.
 *
 * Once per process, not per call — every avatar and chat upload passes through here, and a
 * warning that floods is a warning nobody reads.
 */
let warnedAboutFallback = false

export function getBlobReadWriteToken(): string | undefined {
  const primary = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (primary) return primary
  // Created by the Vercel Blob connection that used the `BLOB1` prefix.
  const prefixed = process.env.BLOB1_READ_WRITE_TOKEN?.trim()
  if (prefixed && !warnedAboutFallback) {
    warnedAboutFallback = true
    console.warn(
      "[blob] Using BLOB1_READ_WRITE_TOKEN — BLOB_READ_WRITE_TOKEN is unset. " +
        "This fallback is temporary debt: reconnect the Blob store with the BLOB prefix, " +
        "then delete lib/blob/readWriteToken.ts. See that file's header.",
    )
  }
  return prefixed || undefined
}

/**
 * Which variable actually supplied the token. For diagnostics and error messages only —
 * it returns a NAME, never a value, so it is safe to log or surface.
 */
export function blobTokenSource(): "BLOB_READ_WRITE_TOKEN" | "BLOB1_READ_WRITE_TOKEN" | "none" {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "BLOB_READ_WRITE_TOKEN"
  if (process.env.BLOB1_READ_WRITE_TOKEN?.trim()) return "BLOB1_READ_WRITE_TOKEN"
  return "none"
}
