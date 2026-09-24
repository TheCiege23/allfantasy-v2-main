// @vitest-environment node
/**
 * Every IP-keyed decision must key on the CLIENT, and there must be one rule
 * for finding it.
 *
 * Why this file exists. Production is Cloudflare -> Railway. Measured
 * 2026-09-24 via /api/af-debug/headers, `x-forwarded-for` held a Cloudflare
 * `172.69.x` hop and a relay, NEITHER of them the client. `getClientIp` read
 * that header first, so:
 *
 *   - every rate limit collapsed strangers who share a Cloudflare hop into one
 *     in-process bucket (lib/rate-limit.ts is a per-process Map), so one
 *     person's signups throttled everyone else on that hop, and
 *   - where no Cloudflare hop was present, `x-forwarded-for[0]` is whatever the
 *     CLIENT sent, so rotating a fake header bought unlimited attempts — the
 *     admin password lockout in /api/auth/login was keyed on nothing else.
 *
 * `lib/geo/detectUserState.ts` had already been fixed to read
 * `cf-connecting-ip` first. Twelve other readers had their own copies of the
 * old rule, which is why the last block below guards the census, not a value.
 *
 * All addresses are RFC 5737 documentation addresses. This repo is public.
 */

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { clientIpFromHeaders } from "@/lib/http/clientIp"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

const CLOUDFLARE_HOP = "203.0.113.50"
const RELAY = "192.0.2.77"
const ALICE = "198.51.100.10"
const BOB = "198.51.100.20"

/** A request exactly as production receives it. */
function viaCloudflare(clientIp: string): Request {
  return new Request("https://www.allfantasy.ai/api/auth/register", {
    method: "POST",
    headers: {
      "cf-connecting-ip": clientIp,
      "x-forwarded-for": `${CLOUDFLARE_HOP}, ${RELAY}`,
      "x-real-ip": CLOUDFLARE_HOP,
    },
  })
}

describe("getClientIp names the client, not the proxy chain", () => {
  it("returns cf-connecting-ip on a production-shaped request", () => {
    expect(getClientIp(viaCloudflare(ALICE))).toBe(ALICE)
  })

  it("gives two strangers on the same Cloudflare hop two different keys", () => {
    expect(getClientIp(viaCloudflare(ALICE))).not.toBe(getClientIp(viaCloudflare(BOB)))
  })

  it("prefers the platform-set x-real-ip over a client-supplied x-forwarded-for", () => {
    // No Cloudflare in front (preview, a direct origin hit): x-forwarded-for[0]
    // is whatever the caller typed, x-real-ip is what the platform edge saw.
    const spoofed = new Request("https://example.test/", {
      headers: { "x-forwarded-for": "192.0.2.1", "x-real-ip": BOB },
    })
    expect(getClientIp(spoofed)).toBe(BOB)
  })

  it("still reads x-forwarded-for when it is the only header, and says unknown when there is none", () => {
    expect(getClientIp(new Request("https://example.test/", { headers: { "x-forwarded-for": `${ALICE}, ${RELAY}` } }))).toBe(ALICE)
    expect(getClientIp(new Request("https://example.test/"))).toBe("unknown")
  })
})

describe("the signup limit throttles the person, not the hop", () => {
  it("does not refuse Bob because Alice used up her attempts", () => {
    const key = (req: Request) => `signup-test:${getClientIp(req)}`
    const limit = 2

    expect(rateLimit(key(viaCloudflare(ALICE)), limit, 60_000).success).toBe(true)
    expect(rateLimit(key(viaCloudflare(ALICE)), limit, 60_000).success).toBe(true)
    expect(rateLimit(key(viaCloudflare(ALICE)), limit, 60_000).success).toBe(false)

    expect(rateLimit(key(viaCloudflare(BOB)), limit, 60_000).success).toBe(true)
  })
})

describe("clientIpFromHeaders accepts what each caller actually has", () => {
  it("reads a plain Headers and a header-getter alike (next/headers returns the latter)", () => {
    const h = viaCloudflare(ALICE).headers
    expect(clientIpFromHeaders(h)).toBe(ALICE)
    expect(clientIpFromHeaders({ get: (n: string) => h.get(n) })).toBe(ALICE)
  })

  it("returns null, not a sentinel, when there is nothing to read", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull()
  })
})

describe("there is one rule, and nothing grows a second copy", () => {
  /**
   * Files allowed to name the raw headers. Each for a reason that is not
   * "choose the client IP":
   *   - lib/http/clientIp.ts       — the rule itself
   *   - lib/api/proxy-adapter.ts   — FORWARDS the headers to a self-call
   *   - app/api/af-debug/headers   — echoes headers for diagnosis
   *   - lib/meta-capi.ts           — deliberately untouched: switching it would
   *                                  start sending users' real IPs to Meta,
   *                                  which is a data-sharing decision, not a fix
   */
  const ALLOWED = new Set([
    "lib/http/clientIp.ts",
    "lib/api/proxy-adapter.ts",
    "app/api/af-debug/headers/route.ts",
    "lib/meta-capi.ts",
  ])

  it("finds no other reader of x-forwarded-for / x-real-ip in app, lib, server or middleware", () => {
    const root = resolve(__dirname, "..")
    let out = ""
    try {
      out = execFileSync(
        "git",
        ["grep", "-l", "-i", "-E", "x-forwarded-for|x-real-ip", "--", "app", "lib", "server", "middleware.ts"],
        { cwd: root, encoding: "utf8" },
      )
    } catch (e) {
      // git grep exits 1 for "no matches", which is a real (and passing) answer.
      const status = (e as { status?: number }).status
      if (status !== 1) throw e
    }
    const offenders = out.split(/\r?\n/).filter(Boolean).filter((f) => !ALLOWED.has(f))
    expect(offenders).toEqual([])
  })

  it("control: the census really can see a reader (the allow-listed rule file is found)", () => {
    // A guard that cannot fail reads as a pass. Prove the grep sees a file we
    // know contains the header before trusting its empty answer above.
    const src = readFileSync(resolve(__dirname, "../lib/rate-limit.ts"), "utf8")
    expect(src).toMatch(/clientIpFromHeaders/)
    const found = execFileSync("git", ["grep", "-l", "-i", "x-forwarded-for", "--", "lib/api/proxy-adapter.ts"], {
      cwd: resolve(__dirname, ".."),
      encoding: "utf8",
    })
    expect(found.trim()).toBe("lib/api/proxy-adapter.ts")
  })
})
