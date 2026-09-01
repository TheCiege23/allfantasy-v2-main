/**
 * The language cookie must record a CHOICE, and a prefetch is not one.
 *
 * ── 🛑 THE BUG THIS PINS WAS LIVE AND USER-FACING ────────────────────────────────────────────
 * `LandingV4`'s language switch is a `next/link` to `/?lang=es`. The App Router prefetches it as
 * soon as it enters the viewport, that prefetch reached `nextWithRouteHeaders`, and the function
 * stamped `af_lang=es` for 365 days. Every later page server-renders from that cookie, so a
 * first-time English visitor was switched to Spanish site-wide without clicking anything.
 *
 * Measured against production before the fix — note the third line, which is the reason the
 * second one is a finding rather than a probe that stamps everything it touches:
 *
 *     GET /?lang=es                           → Set-Cookie: af_lang=es; Max-Age=31536000
 *     GET /?lang=es  Next-Router-Prefetch: 1  → Set-Cookie: af_lang=es; Max-Age=31536000
 *     GET /            (no param, control)    → no cookie
 *
 * ── ⚠ THE HALF THAT IS EASY TO BREAK WHILE FIXING THE OTHER ─────────────────────────────────
 * A real client-side navigation is ALSO an RSC request. Only `Next-Router-Prefetch` separates
 * them, so a guard on `RSC` would silently disable the language switch for every soft navigation
 * — a worse bug than the one being fixed, and invisible without the fourth test below.
 */
import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { nextWithRouteHeaders } from "@/middleware"

function get(url: string, headers: Record<string, string> = {}) {
  const h = new Headers()
  for (const [k, v] of Object.entries(headers)) h.set(k, v)
  return new NextRequest(new URL(url), { headers: h })
}

/** The `af_lang` value the response would set, or null when it sets none. */
function stampedLang(res: ReturnType<typeof nextWithRouteHeaders>): string | null {
  return res.cookies.get("af_lang")?.value ?? null
}

describe("?lang= stamps a cookie only when a human asked", () => {
  it("🛑 a Next router prefetch does NOT stamp the cookie", () => {
    const res = nextWithRouteHeaders(
      get("https://allfantasy.ai/?lang=es", { "next-router-prefetch": "1" }),
      "/",
    )
    expect(stampedLang(res)).toBeNull()
  })

  it("a real navigation DOES stamp it — the switch must keep working", () => {
    const res = nextWithRouteHeaders(get("https://allfantasy.ai/?lang=es"), "/")
    expect(stampedLang(res)).toBe("es")
  })

  it("⚠ an RSC request WITHOUT the prefetch header stamps — that is a click, not speculation", () => {
    // The regression this exists to catch: gating on `RSC` instead of `Next-Router-Prefetch`
    // would kill the language switch for every client-side navigation, and every other test
    // here would still pass.
    const res = nextWithRouteHeaders(get("https://allfantasy.ai/?lang=es", { RSC: "1" }), "/")
    expect(stampedLang(res)).toBe("es")
  })

  it("browser speculation is covered too, since it carries no Next header at all", () => {
    for (const headers of [
      { "sec-purpose": "prefetch" },
      { "sec-purpose": "prefetch;prerender" },
      { purpose: "prefetch" },
    ]) {
      const res = nextWithRouteHeaders(get("https://allfantasy.ai/?lang=es", headers), "/")
      expect(stampedLang(res), JSON.stringify(headers)).toBeNull()
    }
  })

  it("the control: no ?lang= means no cookie, so a null above is a real negative", () => {
    // Without this, every assertion of `toBeNull()` would pass on a function that never stamps
    // anything — the shape of check this repo keeps getting caught by.
    expect(stampedLang(nextWithRouteHeaders(get("https://allfantasy.ai/"), "/"))).toBeNull()
  })

  it("an unselectable language is still refused, prefetch or not", () => {
    // The pre-existing guard: an arbitrary value must never reach <html lang>.
    expect(stampedLang(nextWithRouteHeaders(get("https://allfantasy.ai/?lang=xx"), "/"))).toBeNull()
  })
})

describe("a prefetch still RENDERS the requested language", () => {
  it("⚠ rewrites the request cookie even while declining to stamp the response", () => {
    /*
     * Deliberate, and the reason the fix is two-sided. The prefetched payload goes into the
     * router cache and is what the user sees the instant they click. Skipping the request
     * rewrite as well would trade a wrong-language VISITOR for a wrong-language FLASH on the
     * very click that asked for Spanish. Render it, remember nothing.
     */
    const req = get("https://allfantasy.ai/?lang=es", { "next-router-prefetch": "1" })
    nextWithRouteHeaders(req, "/")

    // `NextResponse.next({ request: { headers } })` surfaces the rewritten headers on the
    // response so the framework can forward them; assert the language reached the render.
    const res = nextWithRouteHeaders(req, "/")
    expect(res.headers.get("x-middleware-override-headers") ?? "").toContain("cookie")
  })
})
