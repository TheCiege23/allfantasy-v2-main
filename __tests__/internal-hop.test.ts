// @vitest-environment node
/**
 * The signed marker that lets our own server call itself back through
 * Cloudflare without the VPN gate judging the hop by Railway's data-centre
 * address. It is a pass through a security gate, so what it must REFUSE is the
 * point of this file — the repo is public and the header name is in it.
 */

import { describe, expect, it } from "vitest"

import { INTERNAL_HOP_HEADER, signInternalHop, verifyInternalHop } from "@/lib/http/internalHop"

const SECRET = "test-nextauth-secret-not-a-real-credential"
const NOW = 1_790_000_000_000

function headersWith(token: string | null) {
  return new Headers(token ? { [INTERNAL_HOP_HEADER]: token } : {})
}

async function signed(method = "POST", path = "/api/league/create", at = NOW) {
  const token = await signInternalHop(method, path, SECRET, at)
  if (!token) throw new Error("expected a token")
  return token
}

describe("verifyInternalHop", () => {
  it("accepts a fresh token for the same method and path", async () => {
    expect(await verifyInternalHop(headersWith(await signed()), "POST", "/api/league/create", SECRET, NOW + 1_000)).toBe(true)
  })

  it("treats the method case-insensitively, as HTTP does", async () => {
    expect(await verifyInternalHop(headersWith(await signed("post")), "POST", "/api/league/create", SECRET, NOW)).toBe(true)
  })

  it("refuses a different path", async () => {
    expect(await verifyInternalHop(headersWith(await signed()), "POST", "/api/league/delete", SECRET, NOW)).toBe(false)
  })

  it("refuses a different method", async () => {
    expect(await verifyInternalHop(headersWith(await signed()), "GET", "/api/league/create", SECRET, NOW)).toBe(false)
  })

  it("refuses a token signed with another secret", async () => {
    const token = await signInternalHop("POST", "/api/league/create", "not-the-secret", NOW)
    expect(await verifyInternalHop(headersWith(token), "POST", "/api/league/create", SECRET, NOW)).toBe(false)
  })

  it("refuses a token older than a minute", async () => {
    expect(await verifyInternalHop(headersWith(await signed()), "POST", "/api/league/create", SECRET, NOW + 61_000)).toBe(false)
  })

  it("refuses a token from the future beyond clock skew", async () => {
    expect(await verifyInternalHop(headersWith(await signed()), "POST", "/api/league/create", SECRET, NOW - 10_000)).toBe(false)
  })

  it("refuses a token whose timestamp was edited to look fresh", async () => {
    const [, mac] = (await signed("POST", "/api/league/create", NOW - 5 * 60_000)).split(".")
    expect(await verifyInternalHop(headersWith(`${NOW}.${mac}`), "POST", "/api/league/create", SECRET, NOW)).toBe(false)
  })

  it("refuses garbage, an empty header and a missing one", async () => {
    for (const token of ["yes", "internal", ".", `${NOW}.`, `.${"a".repeat(64)}`, "abc.def", ""]) {
      expect(await verifyInternalHop(headersWith(token), "POST", "/api/league/create", SECRET, NOW), token).toBe(false)
    }
    expect(await verifyInternalHop(headersWith(null), "POST", "/api/league/create", SECRET, NOW)).toBe(false)
  })

  it("refuses everything when no secret is configured, rather than accepting everything", async () => {
    // `undefined` falls back to the environment, so the environment has to be empty too.
    const saved = { a: process.env.NEXTAUTH_SECRET, b: process.env.AUTH_SECRET }
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
    try {
      expect(await verifyInternalHop(headersWith(await signed()), "POST", "/api/league/create", undefined, NOW)).toBe(false)
      expect(await signInternalHop("POST", "/api/league/create", undefined, NOW)).toBeNull()
    } finally {
      if (saved.a !== undefined) process.env.NEXTAUTH_SECRET = saved.a
      if (saved.b !== undefined) process.env.AUTH_SECRET = saved.b
    }
  })
})
