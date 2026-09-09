/**
 * Decide whether a source file can end up in a CLIENT bundle.
 *
 * Split out of `secret-scan.mjs` so the decision can be tested without a
 * repository, exactly as `db-first-diff-lines.mjs` is. This is worth testing
 * for the same reason that one is: it decides which files get scanned at all,
 * and both of its failure modes are silent.
 *
 * 🛑 `'use server'` IS NOT THE MARKER FOR A SERVER COMPONENT, AND TREATING IT
 * AS ONE MADE THE ESCAPE HATCH UNREACHABLE.
 *
 * The original rule skipped a file only when it was not a `"use client"` file
 * AND it contained `'use server'`. But that directive declares Server Actions.
 * A React Server Component carries NO directive at all, because server is the
 * App Router default — so no `page.tsx` could ever satisfy the skip, and every
 * server component reading a server-only secret earned a permanent WARN with
 * no way to clear it.
 *
 * Measured 2026-09-09: the repo's only hit was `app/admin/bootstrap/page.tsx`,
 * a server component that coerces `ADMIN_SESSION_SECRET` and `ADMIN_PASSWORD`
 * to a boolean and passes no props to its client child. Nothing leaked, and
 * nothing could be done about the warning either.
 *
 * ⚠ THE FIX IS NARROW ON PURPOSE. Only Next.js RESERVED entry files earn the
 * server verdict, because Next resolves those names itself and application code
 * cannot import them — so the module genuinely cannot be pulled into a client
 * bundle. A bare helper under `app/` gets no exemption: a `"use client"` file
 * importing it drags it across the boundary, and that is a real leak the WARN
 * is right about.
 */

/**
 * ⚠ `error` and `global-error` are deliberately ABSENT. Next REQUIRES them to
 * be client components, so one lacking `"use client"` is a broken error
 * boundary rather than a server component, and it must keep earning a finding.
 */
export const APP_ROUTER_SERVER_ENTRIES = new Set([
  'page',
  'layout',
  'template',
  'default',
  'route',
  'not-found',
  'loading',
])

/**
 * Is `rel` a reserved App Router entry file? `rel` is repo-relative and may use
 * either separator — `relative()` yields backslashes on Windows, which is where
 * this runs.
 */
export function isAppRouterServerEntry(rel) {
  if (typeof rel !== 'string' || rel === '') return false
  const norm = rel.split('\\').join('/')
  if (!norm.startsWith('app/')) return false
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return APP_ROUTER_SERVER_ENTRIES.has(base.slice(0, dot))
}

/**
 * How a file reaches the browser, if at all.
 *
 *   'client'  — a `"use client"` module. A secret here is an ERROR: the value
 *               is read in code that ships to the browser.
 *   'server'  — cannot enter a client bundle. No finding.
 *   'unknown' — might be imported BY a client module. Still a WARN, because
 *               that is exactly how a server-only value gets dragged across.
 */
export function classifyBundling({ rel, content }) {
  const src = typeof content === 'string' ? content : ''
  if (src.includes("'use client'") || src.includes('"use client"')) return 'client'
  if (src.includes("'use server'") || src.includes('"use server"')) return 'server'
  if (isAppRouterServerEntry(rel)) return 'server'
  return 'unknown'
}
