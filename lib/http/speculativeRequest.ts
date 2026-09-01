/**
 * Is this a request the user did not ask for?
 *
 * ── ⚠ EXTRACTED SO THERE IS ONE COPY, NOT TWO ────────────────────────────────────────────────
 *
 * This lived inside `middleware.ts` as a private function taking a `NextRequest`. A second
 * caller now needs it — a server component, which has `headers()` from `next/headers` and no
 * `NextRequest` at all — and the obvious move was to write a small copy there.
 *
 * Two implementations of one rule is the bug. The root CLAUDE.md records a day lost to a SQL
 * re-implementation of `normalizePlayerName` that disagreed with the JS original on 7.2% of
 * rows; the shape here is identical and cheaper to avoid than to detect. So this takes the
 * narrowest thing both callers have: something with a `get(name)`.
 *
 * ── 🛑 WHY IT MATTERS TWICE OVER ─────────────────────────────────────────────────────────────
 *
 * The first caller learned this the expensive way. `LandingV4`'s language switch is a
 * `next/link` to `/?lang=es`; the App Router prefetched it the moment it entered the viewport,
 * and the middleware stamped `af_lang=es` for a year. First-time English visitors were switched
 * to Spanish site-wide without clicking anything. Verified against production: the prefetch and
 * a real navigation produced byte-identical `Set-Cookie` headers.
 *
 * The second caller has the same shape with a different cost. `League.lastViewedAt` is the
 * DEMAND signal for the historical-refresh rotation, and Next prefetches every league link that
 * scrolls into view. Writing on a prefetch would mark a whole league list as "viewed" while the
 * user was merely scrolling past it — turning the signal into a restatement of what is on
 * screen, which is not what anyone asked for.
 *
 * ── DELIBERATELY NARROW ──────────────────────────────────────────────────────────────────────
 *
 * Anything not POSITIVELY identified as speculative counts as real. The failure modes are
 * asymmetric and this picks the cheap one: over-counting a view costs one row update, while
 * under-counting a language switch silently breaks a feature the user just used.
 *
 * ⚠ In particular, `RSC: 1` alone is NOT speculative — a genuine client-side navigation is also
 * an RSC request, and only `Next-Router-Prefetch` separates them. Gating on `RSC` would disable
 * the language switch for every soft navigation, which is a worse bug than the one it fixes and
 * is pinned by a test in `__tests__/middleware-lang-prefetch.test.ts`.
 */

/** The narrowest thing both `NextRequest.headers` and `next/headers` satisfy. */
export type HeaderReader = { get(name: string): string | null | undefined }

export function isSpeculativeRequestHeaders(headers: HeaderReader): boolean {
  if (headers.get("next-router-prefetch") === "1") return true
  // Chrome's Speculation Rules: "prefetch" or "prefetch;prerender".
  if ((headers.get("sec-purpose") ?? "").includes("prefetch")) return true
  // Legacy header still sent by some browsers and link-scanning proxies.
  if ((headers.get("purpose") ?? "").toLowerCase() === "prefetch") return true
  return false
}
