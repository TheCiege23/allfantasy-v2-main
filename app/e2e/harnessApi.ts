/**
 * One `/api/` answer a DB-free harness page needs, served by `scripts/e2e-harness-capture.mjs`.
 *
 * A route matches when the request's pathname equals `path` and every `query` entry is present with that exact
 * value; the first match in a harness's list wins, so put the narrower entry first. Anything under /api/ that
 * matches nothing gets a 503 — a screen the harness forgot to feed renders its own error state, which is what a
 * capture should show rather than hide.
 *
 * Harness-only. Each list must stay JSON-serialisable: the capture script reads it through
 * `scripts/e2e-harness-api.ts`, which prints it as JSON.
 */
export type HarnessApiRoute = {
  path: string
  query?: Record<string, string>
  body: unknown
}
